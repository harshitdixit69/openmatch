-- Migration: Inspect Riya's email and reset her password for login test v3
create or replace function public.inspect_riya_auth()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_policies json;
begin
  select email into v_email from auth.users where id = 'f02e3096-ca47-4067-af87-d6b6a342b090';
  
  -- Reset her password to 'TestPassword123!' using extensions schema functions
  update auth.users
  set encrypted_password = extensions.crypt('TestPassword123!', extensions.gen_salt('bf'))
  where id = 'f02e3096-ca47-4067-af87-d6b6a342b090';

  -- Select active policies on profiles table
  select json_agg(t) into v_policies from (
    select policyname, cmd, qual, with_check 
    from pg_policies 
    where schemaname = 'public' and tablename = 'profiles'
  ) t;
  
  return json_build_object('email', v_email, 'policies', v_policies);
end;
$$;

grant execute on function public.inspect_riya_auth() to anon, authenticated;
