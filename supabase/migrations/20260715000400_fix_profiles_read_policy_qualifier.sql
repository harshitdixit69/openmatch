-- Migration: Fix profiles select policy qualifier to target profiles.id explicitly
drop policy if exists "Allow read access to profiles unless blocked" on public.profiles;

create policy "Allow read access to profiles unless blocked" on public.profiles
  for select
  using (
    not exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = auth.uid() and ub.blocked_id = profiles.id)
         or (ub.blocker_id = profiles.id and ub.blocked_id = auth.uid())
    )
  );
