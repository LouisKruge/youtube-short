-- Nexus Clips — initial schema
--
-- Single-user (single-owner) app. Every table carries owner_id and is protected
-- by owner-only RLS. The Next.js app reads through the anon key (RLS enforced);
-- server route handlers and the worker service use the service-role key, which
-- bypasses RLS, and therefore MUST scope every query by owner_id themselves.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Source videos ingested by URL
-- ---------------------------------------------------------------------------
create table source_videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_url text not null,
  title text,
  status text not null default 'pending_download',
  -- pending_download, downloading, downloaded, analyzing, analyzed, failed
  storage_path text,
  duration_seconds numeric,
  -- Downsampled loudness envelope from the analyze stage: an array of dBFS
  -- values at ANALYSIS_HOP_SECONDS intervals. Drives the loudness ribbon in
  -- the UI and the peak picker in the worker.
  loudness_envelope jsonb,
  error_message text,
  -- Queue bookkeeping (not in the original spec, required for cron-driven
  -- claiming so two worker ticks cannot pick up the same job).
  claimed_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index source_videos_owner_status_idx on source_videos (owner_id, status);
create index source_videos_created_idx on source_videos (created_at desc);

-- ---------------------------------------------------------------------------
-- Candidate/final clips generated from a source video
-- ---------------------------------------------------------------------------
create table clips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_video_id uuid references source_videos(id) on delete cascade,
  start_seconds numeric not null,
  end_seconds numeric not null,
  -- Audio-peak detection score. This is loudness above a rolling baseline —
  -- an honest proxy for "something happens here", NOT a viewership signal.
  peak_score numeric,
  storage_path text, -- cropped 9:16 clip, before captions
  status text not null default 'pending_segment',
  -- pending_segment, segmented, cropping, transcribing, ready_for_review,
  -- rendering, queued, uploading, uploaded, failed, rejected
  transcript jsonb, -- word-level timestamps from Whisper
  caption_style text check (caption_style in ('karaoke', 'static')),
  caption_burned_path text, -- final rendered clip with captions burned in
  -- style -> storage path, populated when RENDER_BOTH_CAPTION_STYLES is on.
  caption_paths jsonb not null default '{}'::jsonb,
  error_message text,
  claimed_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index clips_owner_status_idx on clips (owner_id, status);
create index clips_source_idx on clips (source_video_id);
create index clips_score_idx on clips (owner_id, peak_score desc);

-- ---------------------------------------------------------------------------
-- AI-generated hook options per clip
-- ---------------------------------------------------------------------------
create table hooks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  clip_id uuid references clips(id) on delete cascade,
  hook_text text not null,
  is_selected boolean default false,
  created_at timestamptz default now()
);

create index hooks_clip_idx on hooks (clip_id);
-- At most one selected hook per clip.
create unique index hooks_one_selected_per_clip
  on hooks (clip_id) where is_selected;

-- ---------------------------------------------------------------------------
-- YouTube upload records
-- ---------------------------------------------------------------------------
create table uploads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  clip_id uuid references clips(id) on delete cascade,
  youtube_video_id text,
  youtube_url text,
  title text,
  description text,
  tags text[],
  -- Audit trail: why this clip was uploaded (auto vs. manual) and what the
  -- quota ledger looked like at the moment of the decision.
  decision text,
  quota_units integer not null default 0,
  uploaded_at timestamptz,
  status text not null default 'pending', -- pending, uploading, success, failed
  error_message text,
  created_at timestamptz default now()
);

create index uploads_owner_created_idx on uploads (owner_id, created_at desc);
create index uploads_clip_idx on uploads (clip_id);

-- ---------------------------------------------------------------------------
-- Daily quota tracking (YouTube Data API v3 units, reset at UTC midnight)
-- ---------------------------------------------------------------------------
create table quota_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  units_used integer not null default 0,
  primary key (owner_id, usage_date)
);

-- Atomically reserve quota. Returns true when the reservation fit under the
-- ceiling, false when it would have exceeded it. Doing this in SQL keeps two
-- concurrent cron invocations from both spending the last 1,600 units.
create or replace function reserve_quota(
  p_owner uuid,
  p_date date,
  p_units integer,
  p_ceiling integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  insert into quota_usage (owner_id, usage_date, units_used)
  values (p_owner, p_date, 0)
  on conflict (owner_id, usage_date) do nothing;

  select units_used into v_used
  from quota_usage
  where owner_id = p_owner and usage_date = p_date
  for update;

  if v_used + p_units > p_ceiling then
    return false;
  end if;

  update quota_usage
  set units_used = units_used + p_units
  where owner_id = p_owner and usage_date = p_date;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Global app settings (one row per owner)
-- ---------------------------------------------------------------------------
create table app_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  -- Safety gate. Defaults OFF: clips queue but nothing is published until the
  -- owner explicitly turns this on.
  auto_upload_enabled boolean not null default false,
  default_caption_style text not null default 'karaoke'
    check (default_caption_style in ('karaoke', 'static')),
  clip_length_seconds integer not null default 30,
  max_clips_per_source integer not null default 8,
  daily_quota_limit integer not null default 10000,
  youtube_privacy_status text not null default 'public'
    check (youtube_privacy_status in ('public', 'unlisted', 'private')),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- YouTube OAuth credentials (one channel per owner)
-- ---------------------------------------------------------------------------
create table youtube_accounts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  channel_id text,
  channel_title text,
  refresh_token text not null,
  access_token text,
  token_expires_at timestamptz,
  scope text,
  connected_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger source_videos_touch before update on source_videos
  for each row execute function touch_updated_at();
create trigger clips_touch before update on clips
  for each row execute function touch_updated_at();
create trigger app_settings_touch before update on app_settings
  for each row execute function touch_updated_at();
create trigger youtube_accounts_touch before update on youtube_accounts
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — owner-only on every table.
-- ---------------------------------------------------------------------------
alter table source_videos enable row level security;
alter table clips enable row level security;
alter table hooks enable row level security;
alter table uploads enable row level security;
alter table quota_usage enable row level security;
alter table app_settings enable row level security;
alter table youtube_accounts enable row level security;

create policy source_videos_owner on source_videos
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy clips_owner on clips
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy hooks_owner on hooks
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy uploads_owner on uploads
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy quota_usage_owner on quota_usage
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy app_settings_owner on app_settings
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- youtube_accounts holds a refresh token. Deliberately NO select policy: the
-- browser never needs to read it. Connection status is surfaced through the
-- /api/settings route handler, which reads it server-side.
create policy youtube_accounts_owner_write on youtube_accounts
  for insert with check (auth.uid() = owner_id);
create policy youtube_accounts_owner_delete on youtube_accounts
  for delete using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Storage bucket for media. Private; the app issues signed URLs for preview.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('nexus-media', 'nexus-media', false)
on conflict (id) do nothing;

create policy "owner reads own media"
  on storage.objects for select
  using (bucket_id = 'nexus-media' and owner = auth.uid());
