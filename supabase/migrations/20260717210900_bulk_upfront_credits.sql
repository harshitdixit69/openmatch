-- Migration: Add Bulk Upfront Credits and consume_unlock_credit RPC

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS unlock_credits_remaining INTEGER DEFAULT 0 NOT NULL
    CONSTRAINT profiles_unlock_credits_remaining_check CHECK (unlock_credits_remaining >= 0),
  ADD COLUMN IF NOT EXISTS super_interest_remaining INTEGER DEFAULT 0 NOT NULL
    CONSTRAINT profiles_super_interest_remaining_check CHECK (super_interest_remaining >= 0),
  ADD COLUMN IF NOT EXISTS spotlights_remaining INTEGER DEFAULT 0 NOT NULL
    CONSTRAINT profiles_spotlights_remaining_check CHECK (spotlights_remaining >= 0);

-- Make sure check constraint supports the new pro/max/supreme tiers
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subscription_tier_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_subscription_tier_check 
  CHECK (subscription_tier IN ('free', 'plus', 'vip', 'pro', 'pro_max', 'pro_supreme'));

-- RPC: consume_unlock_credit
create or replace function public.consume_unlock_credit(match_id uuid)
returns json
language plpgsql
security definer
as $$
declare
  v_uid uuid;
  v_tier text;
  v_expires timestamptz;
  v_credits integer;
  v_match_user1 uuid;
  v_match_user2 uuid;
  v_is_unlocked boolean;
  v_u1_paid timestamptz;
  v_u2_paid timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- 1. Fetch match info
  select user_1_id, user_2_id, is_unlocked
  into v_match_user1, v_match_user2, v_is_unlocked
  from public.matches
  where id = match_id;

  if v_match_user1 is null then
    raise exception 'Match not found';
  end if;

  if v_uid <> v_match_user1 and v_uid <> v_match_user2 then
    raise exception 'Not a participant in this match';
  end if;

  if v_is_unlocked then
    return json_build_object('success', true, 'already_unlocked', true);
  end if;

  -- 2. Fetch profile info
  select subscription_tier, subscription_expires_at, unlock_credits_remaining
  into v_tier, v_expires, v_credits
  from public.profiles
  where id = v_uid;

  -- Check if they have an active subscription or credits remaining
  if not (
    (v_tier in ('pro', 'pro_max', 'pro_supreme', 'vip', 'plus') and v_expires is not null and v_expires > now())
    or (v_credits > 0)
  ) then
    raise exception 'No active subscription or unlock credits available';
  end if;

  -- 3. Decrement credit if unlock_credits_remaining > 0
  if v_credits > 0 then
    update public.profiles
    set unlock_credits_remaining = unlock_credits_remaining - 1
    where id = v_uid;
  end if;

  -- 4. Mark caller's half of the mutual consent status as unlocked/approved
  insert into public.match_unlocks (
    match_id,
    requested_by,
    status,
    user_1_accepted_at,
    user_2_accepted_at,
    user_1_paid_at,
    user_2_paid_at
  )
  values (
    match_id,
    v_uid,
    'awaiting_payment',
    case when v_uid = v_match_user1 then now() else null end,
    case when v_uid = v_match_user2 then now() else null end,
    case when v_uid = v_match_user1 then now() else null end,
    case when v_uid = v_match_user2 then now() else null end
  )
  on conflict (match_id) do update
  set
    user_1_accepted_at = case when v_uid = v_match_user1 then now() else match_unlocks.user_1_accepted_at end,
    user_2_accepted_at = case when v_uid = v_match_user2 then now() else match_unlocks.user_2_accepted_at end,
    user_1_paid_at = case when v_uid = v_match_user1 then now() else match_unlocks.user_1_paid_at end,
    user_2_paid_at = case when v_uid = v_match_user2 then now() else match_unlocks.user_2_paid_at end;

  -- Check if both paid to set status = 'completed' and matches.is_unlocked = true
  select user_1_paid_at, user_2_paid_at
  into v_u1_paid, v_u2_paid
  from public.match_unlocks
  where match_id = match_id;

  if v_u1_paid is not null and v_u2_paid is not null then
    update public.match_unlocks
    set status = 'completed', updated_at = now()
    where match_id = match_id;

    update public.matches
    set is_unlocked = true
    where id = match_id;

    v_is_unlocked := true;
  else
    update public.match_unlocks
    set status = 'awaiting_payment', updated_at = now()
    where match_id = match_id;
  end if;

  return json_build_object('success', true, 'unlocked', v_is_unlocked);
end;
$$;

grant execute on function public.consume_unlock_credit(uuid) to authenticated;