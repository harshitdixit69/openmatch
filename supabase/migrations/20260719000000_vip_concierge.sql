-- Migration: Add user_tier enum to profiles and enforce VIP data isolation

-- 1. Create the user_tier_type enum if it does not exist
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_tier_type') then
    create type public.user_tier_type as enum ('BASIC', 'PRO', 'PRO_MAX', 'PRO_SUPREME', 'VIP');
  end if;
end
$$;

-- 2. Alter the profiles table to add the user_tier column
alter table public.profiles
  add column if not exists user_tier public.user_tier_type default 'BASIC'::public.user_tier_type not null;

-- 3. Backfill user_tier based on the existing subscription_tier check
update public.profiles
set user_tier = case
  when subscription_tier = 'vip' then 'VIP'::public.user_tier_type
  when subscription_tier = 'pro' then 'PRO'::public.user_tier_type
  when subscription_tier = 'pro_max' then 'PRO_MAX'::public.user_tier_type
  when subscription_tier = 'pro_supreme' then 'PRO_SUPREME'::public.user_tier_type
  else 'BASIC'::public.user_tier_type
end;

-- 4. Recreate select policy on profiles to isolate VIP users
drop policy if exists "Allow read access to profiles unless blocked" on public.profiles;

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
      -- Standard profiles are visible to everyone
      (user_tier != 'VIP')
      or
      -- VIP profiles are only visible to the user themselves, or other VIP users
      (user_tier = 'VIP' and (
        id = auth.uid()
        or
        exists (
          select 1 from public.profiles
          where id = auth.uid() and user_tier = 'VIP'
        )
      ))
    )
  );
