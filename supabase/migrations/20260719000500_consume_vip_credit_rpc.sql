-- Migration: Add atomic function to consume VIP outreach credit safely
-- Target: hosted Supabase database

create or replace function public.consume_vip_outreach_credit()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set unlock_credits_remaining = unlock_credits_remaining - 1
  where id = auth.uid() 
    and user_tier = 'VIP'::public.user_tier_type
    and unlock_credits_remaining > 0;
  
  return found;
end;
$$;

grant execute on function public.consume_vip_outreach_credit() to authenticated;
