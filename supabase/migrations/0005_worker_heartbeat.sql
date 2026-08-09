-- Lets a worker announce that it is alive without being publicly reachable.
--
-- The worker claims jobs by polling Supabase; the HTTP nudge from the app is a
-- latency optimisation, not the trigger. So a worker running on a laptop, or
-- behind NAT, or on a host with no inbound routing, drains the queue perfectly
-- well — the dashboard just had no way to know it existed, and reported "no
-- worker configured" while work was actively being processed.
--
-- A heartbeat is also a better signal than an HTTP probe even when a URL does
-- exist: an open port says the process is listening, whereas a recent heartbeat
-- says it is running its loop and can reach the database.

create table if not exists worker_heartbeats (
  worker_id text primary key,
  last_seen_at timestamptz not null default now(),
  -- Free-form: version, hostname, whatever helps identify which box this is.
  detail jsonb not null default '{}'::jsonb
);

create index if not exists worker_heartbeats_seen_idx
  on worker_heartbeats (last_seen_at desc);

-- Not owner-scoped: a worker serves the whole deployment, and it authenticates
-- with the service-role key rather than as a user. RLS on with no policies means
-- anon and authenticated can read nothing; service_role bypasses RLS entirely,
-- which is exactly the reach this table needs.
alter table worker_heartbeats enable row level security;
