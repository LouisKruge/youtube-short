-- Moment intelligence: scenes, scored candidates, hook analysis, dead time,
-- crop tracking, caption presets, cover frames, library workflow, metadata,
-- transcript search, scheduling, performance and style learning.

-- ---------------------------------------------------------------------------
-- Source-level analysis
-- ---------------------------------------------------------------------------
alter table source_videos
  add column if not exists transcript jsonb,
  add column if not exists transcript_text text,
  add column if not exists analysis jsonb,
  add column if not exists scene_count integer,
  -- Progressive results: the analyze stage writes candidates here as it finds
  -- them so the UI can show a radar while the pass is still running.
  add column if not exists radar jsonb not null default '[]'::jsonb;

-- Semantic-ish search across everything ever ingested. Postgres full-text is
-- the honest tool here: it finds phrases people actually said, which is what
-- "find the scene where they talk about school" really needs.
create index if not exists source_videos_transcript_fts
  on source_videos using gin (to_tsvector('english', coalesce(transcript_text, '')));

-- ---------------------------------------------------------------------------
-- Scenes — the timeline the operator clicks to make a clip
-- ---------------------------------------------------------------------------
create table if not exists scenes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_video_id uuid not null references source_videos(id) on delete cascade,
  scene_index integer not null,
  start_seconds numeric not null,
  end_seconds numeric not null,
  label text,
  created_at timestamptz default now()
);

create index if not exists scenes_source_idx on scenes (source_video_id, scene_index);

-- ---------------------------------------------------------------------------
-- Clip intelligence
-- ---------------------------------------------------------------------------
alter table clips
  -- Relative standing within its source, 1 = strongest. Deliberately a rank
  -- and not a predicted view count.
  add column if not exists rank integer,
  -- 0-100 composite of the factors below. Comparable between clips from the
  -- same source; NOT a claim about how the clip will perform.
  add column if not exists score numeric,
  add column if not exists score_factors jsonb,
  add column if not exists rationale text,
  add column if not exists category text,
  add column if not exists hook_analysis jsonb,
  add column if not exists dead_time jsonb not null default '[]'::jsonb,
  add column if not exists dead_time_removed boolean not null default false,
  add column if not exists crop_track jsonb,
  add column if not exists caption_preset text not null default 'clean',
  add column if not exists cover_frame_path text,
  add column if not exists cover_candidates jsonb not null default '[]'::jsonb,
  -- Workflow state, independent of the processing status.
  add column if not exists library_status text not null default 'unreviewed',
  add column if not exists variant_of uuid references clips(id) on delete cascade,
  add column if not exists variant_label text,
  -- YouTube metadata, generated then editable.
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists hashtags text[];

alter table clips
  drop constraint if exists clips_library_status_check;
alter table clips
  add constraint clips_library_status_check check (
    library_status in ('unreviewed','shortlisted','edited','exported','published','rejected')
  );

alter table clips
  drop constraint if exists clips_caption_preset_check;
alter table clips
  add constraint clips_caption_preset_check check (
    caption_preset in ('clean','punch','cinematic','minimal')
  );

create index if not exists clips_library_idx on clips (owner_id, library_status);
create index if not exists clips_rank_idx on clips (source_video_id, rank);

-- Hooks table now also carries generated title alternatives.
alter table hooks
  add column if not exists kind text not null default 'hook';
alter table hooks
  drop constraint if exists hooks_kind_check;
alter table hooks
  add constraint hooks_kind_check check (kind in ('hook','title'));

-- The partial unique index must be per kind, so a clip can have one selected
-- hook and one selected title at the same time.
drop index if exists hooks_one_selected_per_clip;
create unique index if not exists hooks_one_selected_per_clip_kind
  on hooks (clip_id, kind) where is_selected;

-- ---------------------------------------------------------------------------
-- Publishing calendar
-- ---------------------------------------------------------------------------
create table if not exists schedule_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  clip_id uuid not null references clips(id) on delete cascade,
  publish_at timestamptz not null,
  status text not null default 'planned'
    check (status in ('planned','released','skipped')),
  created_at timestamptz default now()
);

create index if not exists schedule_owner_idx on schedule_entries (owner_id, publish_at);

-- ---------------------------------------------------------------------------
-- Performance, for the owner's OWN uploads.
-- YouTube Analytics does expose retention for videos you own — unlike
-- third-party video, where no such API exists.
-- ---------------------------------------------------------------------------
create table if not exists clip_analytics (
  clip_id uuid primary key references clips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  views integer,
  average_view_percentage numeric,
  likes integer,
  comments integer,
  shares integer,
  fetched_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Learned clipping style.
-- This is accumulated preference used as scoring context — not a trained
-- model. Named to match what it actually is.
-- ---------------------------------------------------------------------------
create table if not exists style_profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  sample_size integer not null default 0,
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Settings additions
-- ---------------------------------------------------------------------------
alter table app_settings
  add column if not exists shorts_per_source integer not null default 10,
  add column if not exists default_caption_preset text not null default 'clean',
  add column if not exists remove_dead_time boolean not null default true,
  add column if not exists smart_crop boolean not null default true;

alter table app_settings
  drop constraint if exists app_settings_default_caption_preset_check;
alter table app_settings
  add constraint app_settings_default_caption_preset_check check (
    default_caption_preset in ('clean','punch','cinematic','minimal')
  );

-- ---------------------------------------------------------------------------
-- RLS on the new tables
-- ---------------------------------------------------------------------------
alter table scenes enable row level security;
alter table schedule_entries enable row level security;
alter table clip_analytics enable row level security;
alter table style_profiles enable row level security;

drop policy if exists scenes_owner on scenes;
create policy scenes_owner on scenes
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists schedule_owner on schedule_entries;
create policy schedule_owner on schedule_entries
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists clip_analytics_owner on clip_analytics;
create policy clip_analytics_owner on clip_analytics
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists style_profiles_owner on style_profiles;
create policy style_profiles_owner on style_profiles
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Transcript search across every source the owner has ingested.
-- SECURITY INVOKER so RLS applies and it can only ever read the caller's rows.
-- ---------------------------------------------------------------------------
create or replace function search_transcripts(q text)
returns table (
  source_video_id uuid,
  source_title text,
  headline text,
  rank real
)
language sql
security invoker
set search_path = public
as $$
  select
    sv.id,
    sv.title,
    ts_headline('english', coalesce(sv.transcript_text, ''), websearch_to_tsquery('english', q),
                'MaxWords=24, MinWords=8, MaxFragments=3'),
    ts_rank(to_tsvector('english', coalesce(sv.transcript_text, '')),
            websearch_to_tsquery('english', q))
  from source_videos sv
  where to_tsvector('english', coalesce(sv.transcript_text, ''))
        @@ websearch_to_tsquery('english', q)
  order by 4 desc
  limit 50;
$$;
