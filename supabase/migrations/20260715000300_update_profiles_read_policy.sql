-- Migration: Update profiles select policy to restrict access for blocked/blocking users
drop policy if exists "Allow public read access to profiles" on public.profiles;

create policy "Allow read access to profiles unless blocked" on public.profiles
  for select
  using (
    not exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = auth.uid() and ub.blocked_id = id)
         or (ub.blocker_id = id and ub.blocked_id = auth.uid())
    )
  );
