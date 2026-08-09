-- Make a retried failure visible.
--
-- `failSource` and `failClip` hand a job back to the queue when it still has
-- attempts left, and to do that they have to clear `error_message` — the claim
-- query requires it to be null, so a row carrying an error can never be picked
-- up again. The effect was that only the *last* failure was ever recorded. A
-- source could fail twice, silently, and the dashboard would show a progress
-- bar the whole time; the reason for the first two failures existed only in the
-- worker's log, which is not somewhere the operator can see.
--
-- `last_error` is written on every failure and never gates a claim, so the two
-- concerns stop fighting: `error_message` means "parked, a human should look",
-- `last_error` means "this is what went wrong most recently".
--
-- Nullable and with no default: an untouched row is one that has not failed.

alter table public.source_videos
  add column if not exists last_error text;

alter table public.clips
  add column if not exists last_error text;

comment on column public.source_videos.last_error is
  'Most recent failure, kept across retries. Unlike error_message this does not stop the row being claimed again.';

comment on column public.clips.last_error is
  'Most recent failure, kept across retries. Unlike error_message this does not stop the row being claimed again.';
