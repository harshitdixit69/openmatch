-- Migration: Add security definer function to check mutual blocks and update profiles select policy
create or replace function public.is_blocked_mutually(user_a uuid, user_b uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = user_a and blocked_id = user_b)
       or (blocker_id = user_b and blocked_id = user_a)
  );
$$;

grant execute on function public.is_blocked_mutually(uuid, uuid) to authenticated;

drop policy if exists "Allow read access to profiles unless blocked" on public.profiles;

create policy "Allow read access to profiles unless blocked" on public.profiles
  for select
  using (
    (auth.uid() is not null and not public.is_blocked_mutually(auth.uid(), id))
    or auth.uid() is null
  );
