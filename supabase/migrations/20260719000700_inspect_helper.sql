-- Migration: Create inspect helper function to bypass RLS for debugging
create or replace function public.inspect_db_data()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profiles json;
  v_matches json;
  v_interest_requests json;
begin
  select json_agg(t) into v_profiles from (select id, full_name, user_tier from public.profiles) t;
  select json_agg(t) into v_matches from (select * from public.matches) t;
  select json_agg(t) into v_interest_requests from (select * from public.interest_requests) t;
  
  return json_build_object(
    'profiles', v_profiles,
    'matches', v_matches,
    'interest_requests', v_interest_requests
  );
end;
$$;

grant execute on function public.inspect_db_data() to anon, authenticated;
