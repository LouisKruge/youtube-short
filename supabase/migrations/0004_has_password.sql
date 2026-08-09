-- Lets the app tell the operator whether their account has a password yet.
--
-- `auth.users` is not reachable over PostgREST, and it should not be — it holds
-- the password hash. This function returns a single boolean about the *caller's
-- own* row and nothing else, which is the whole of what the Settings page needs
-- to say "set" or "not set".
--
-- security definer is required to read auth.users at all. The body takes no
-- argument and keys strictly off auth.uid(), so there is no parameter to
-- manipulate and no way to ask about another account.
--
-- Supabase's linter warns about every security-definer function that
-- `authenticated` can call (0029_authenticated_security_definer_function_
-- executable). That warning is expected here and the function is still correct:
-- unlike reserve_quota — which took an owner id and a ceiling as arguments and
-- was reachable by anon, and was a real hole — this one has no inputs at all,
-- so the only thing a caller can learn is one boolean about themselves.

create or replace function public.current_user_has_password()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select u.encrypted_password is not null and u.encrypted_password <> ''
      from auth.users u
      where u.id = auth.uid()
    ),
    false
  );
$$;

-- Callable by a signed-in operator only. anon has no auth.uid() and would
-- always get false, but there is no reason to let it ask.
revoke execute on function public.current_user_has_password() from public, anon;
grant execute on function public.current_user_has_password() to authenticated, service_role;
