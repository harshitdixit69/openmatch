-- Migration: Contact unlock request credit refunds on decline/cancel

-- 1. Add payment method columns to match_unlocks to distinguish credit vs cash payments
alter table public.match_unlocks
  add column if not exists user_1_payment_method text check (user_1_payment_method in ('credit', 'stripe_direct')),
  add column if not exists user_2_payment_method text check (user_2_payment_method in ('credit', 'stripe_direct'));

-- 2. Recreate consume_unlock_credit to write 'credit' to the corresponding payment method column
create or replace function public.consume_unlock_credit(p_match_id uuid)
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

  -- Fetch match info
  select user_1_id, user_2_id, is_unlocked
  into v_match_user1, v_match_user2, v_is_unlocked
  from public.matches
  where id = p_match_id;

  if v_match_user1 is null then
    raise exception 'Match not found';
  end if;

  if v_uid <> v_match_user1 and v_uid <> v_match_user2 then
    raise exception 'Not a participant in this match';
  end if;

  if v_is_unlocked then
    return json_build_object('success', true, 'already_unlocked', true);
  end if;

  -- Fetch profile info
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

  -- Decrement credit if unlock_credits_remaining > 0
  if v_credits > 0 then
    update public.profiles
    set unlock_credits_remaining = unlock_credits_remaining - 1
    where id = v_uid;
  end if;

  -- Mark caller's half as unlocked/approved and set method to 'credit'
  insert into public.match_unlocks (
    match_id,
    requested_by,
    status,
    user_1_accepted_at,
    user_2_accepted_at,
    user_1_paid_at,
    user_2_paid_at,
    user_1_payment_method,
    user_2_payment_method
  )
  values (
    p_match_id,
    v_uid,
    'awaiting_payment',
    case when v_uid = v_match_user1 then now() else null end,
    case when v_uid = v_match_user2 then now() else null end,
    case when v_uid = v_match_user1 then now() else null end,
    case when v_uid = v_match_user2 then now() else null end,
    case when v_uid = v_match_user1 then 'credit'::text else null end,
    case when v_uid = v_match_user2 then 'credit'::text else null end
  )
  on conflict (match_id) do update
  set
    user_1_accepted_at = case when v_uid = v_match_user1 then now() else match_unlocks.user_1_accepted_at end,
    user_2_accepted_at = case when v_uid = v_match_user2 then now() else match_unlocks.user_2_accepted_at end,
    user_1_paid_at = case when v_uid = v_match_user1 then now() else match_unlocks.user_1_paid_at end,
    user_2_paid_at = case when v_uid = v_match_user2 then now() else match_unlocks.user_2_paid_at end,
    user_1_payment_method = case when v_uid = v_match_user1 then 'credit'::text else match_unlocks.user_1_payment_method end,
    user_2_payment_method = case when v_uid = v_match_user2 then 'credit'::text else match_unlocks.user_2_payment_method end;

  -- Check if both paid to set status = 'completed' and matches.is_unlocked = true
  select user_1_paid_at, user_2_paid_at
  into v_u1_paid, v_u2_paid
  from public.match_unlocks
  where match_unlocks.match_id = p_match_id;

  if v_u1_paid is not null and v_u2_paid is not null then
    update public.match_unlocks
    set status = 'completed', updated_at = now()
    where match_unlocks.match_id = p_match_id;

    update public.matches
    set is_unlocked = true
    where id = p_match_id;

    v_is_unlocked := true;
  else
    update public.match_unlocks
    set status = 'awaiting_payment', updated_at = now()
    where match_unlocks.match_id = p_match_id;
  end if;

  return json_build_object('success', true, 'unlocked', v_is_unlocked);
end;
$$;

-- 3. Create the BEFORE UPDATE trigger function to handle the credit refund
create or replace function public.handle_match_unlock_refund()
returns trigger
language plpgsql
security definer
as $$
declare
  v_match_user1 uuid;
  v_match_user2 uuid;
begin
  -- Trigger activates when status transitions to 'declined'
  if NEW.status = 'declined' and OLD.status <> 'declined' then
    -- Fetch match participants
    select user_1_id, user_2_id
    into v_match_user1, v_match_user2
    from public.matches
    where id = NEW.match_id;

    -- Check User 1: Paid and used a credit? Refund +1 credit.
    if OLD.user_1_paid_at is not null and OLD.user_1_payment_method = 'credit' then
      update public.profiles
      set unlock_credits_remaining = unlock_credits_remaining + 1
      where id = v_match_user1;
      
      -- Clear paid status in the updated row
      NEW.user_1_paid_at := null;
      NEW.user_1_payment_method := null;
      NEW.user_1_accepted_at := null;
    end if;

    -- Check User 2: Paid and used a credit? Refund +1 credit.
    if OLD.user_2_paid_at is not null and OLD.user_2_payment_method = 'credit' then
      update public.profiles
      set unlock_credits_remaining = unlock_credits_remaining + 1
      where id = v_match_user2;
      
      -- Clear paid status in the updated row
      NEW.user_2_paid_at := null;
      NEW.user_2_payment_method := null;
      NEW.user_2_accepted_at := null;
    end if;
  end if;
  return NEW;
end;
$$;

-- Recreate trigger block cleanly
drop trigger if exists refund_unlock_credits_trigger on public.match_unlocks;
create trigger refund_unlock_credits_trigger
  before update on public.match_unlocks
  for each row
  execute function public.handle_match_unlock_refund();
