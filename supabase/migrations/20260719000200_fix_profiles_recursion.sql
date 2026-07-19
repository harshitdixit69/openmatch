-- Migration: Fix profiles RLS recursion with is_vip helper function

-- 1. Create helper function to check VIP status bypassing RLS
create or replace function public.is_vip(p_uid uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = p_uid and user_tier = 'VIP'::public.user_tier_type
  );
$$;

-- 2. Drop recursion policy on profiles
drop policy if exists "Allow read access to profiles unless blocked" on public.profiles;

-- 3. Recreate policy using is_vip() to prevent recursion
create policy "Allow read access to profiles unless blocked" on public.profiles
  for select
  using (
    -- Block list check
    (not exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = auth.uid() and ub.blocked_id = id)
         or (ub.blocker_id = id and ub.blocked_id = auth.uid())
    ))
    and
    -- VIP isolation check
    (
      (user_tier != 'VIP'::public.user_tier_type)
      or
      (user_tier = 'VIP'::public.user_tier_type and (
        id = auth.uid()
        or
        public.is_vip(auth.uid())
      ))
    )
  );

-- 4. Update vip_bot_sessions policy using is_vip()
drop policy if exists "VIP users can view their own bot session" on public.vip_bot_sessions;
create policy "VIP users can view their own bot session"
  on public.vip_bot_sessions
  for select
  using (
    vip_id = auth.uid()
    and public.is_vip(auth.uid())
  );

-- 5. Update vip_outreach_logs policy using is_vip()
drop policy if exists "VIP users can view their own outreach logs" on public.vip_outreach_logs;
create policy "VIP users can view their own outreach logs"
  on public.vip_outreach_logs
  for select
  using (
    vip_id = auth.uid()
    and public.is_vip(auth.uid())
  );
