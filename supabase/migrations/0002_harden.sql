-- Hardening for databases created from the first version of 0001_init.sql,
-- which exposed reserve_quota over the REST API and left the trigger
-- function's search_path mutable. Both are now fixed in 0001 as well, so a
-- fresh install can skip this file — it is safe to run either way.

-- reserve_quota is SECURITY DEFINER: it holds a row lock and bypasses RLS.
-- Exposed on /rest/v1/rpc/reserve_quota, any caller could pass an arbitrary
-- p_owner and p_ceiling and rewrite another account's quota ledger, defeating
-- the ceiling it exists to enforce. Only the worker needs it.
revoke execute on function public.reserve_quota(uuid, date, integer, integer)
  from public, anon, authenticated;

grant execute on function public.reserve_quota(uuid, date, integer, integer)
  to service_role;

-- Pin the trigger function's search_path.
create or replace function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
