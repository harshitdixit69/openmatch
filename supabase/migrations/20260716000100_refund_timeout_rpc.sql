-- Migration: Add get_timed_out_unlocks RPC function to find unlocks that have timed out (> 48 hours)

create or replace function public.get_timed_out_unlocks()
returns table (
    match_id uuid,
    payer_user_id uuid,
    stripe_payment_intent_id text
)
language sql
security definer
set search_path = public
as $$
    select 
        mu.match_id,
        case 
            when mu.user_1_paid_at is not null then m.user_1_id
            else m.user_2_id
        end as payer_user_id,
        mpa.stripe_payment_intent_id
    from public.match_unlocks mu
    join public.matches m on m.id = mu.match_id
    join public.match_unlock_payment_attempts mpa on mpa.match_id = mu.match_id 
        and mpa.payer_user_id = (case when mu.user_1_paid_at is not null then m.user_1_id else m.user_2_id end)
        and mpa.status = 'succeeded'
    where mu.status = 'awaiting_payment'
      and (
          (mu.user_1_paid_at is not null and mu.user_2_paid_at is null and mu.user_1_paid_at < now() - interval '48 hours')
          or 
          (mu.user_2_paid_at is not null and mu.user_1_paid_at is null and mu.user_2_paid_at < now() - interval '48 hours')
      )
    order by mpa.created_at desc;
$$;

grant execute on function public.get_timed_out_unlocks() to authenticated;
