-- Migration: Add reject_profile and clear_rejected_profiles RPCs to handle profile passing/skipping on the DB

create or replace function public.reject_profile(p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_viewer_id uuid := auth.uid();
  v_user_1_id uuid;
  v_user_2_id uuid;
begin
  if v_viewer_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Maintain consistent order: user_1_id < user_2_id
  if v_viewer_id < p_candidate_id then
    v_user_1_id := v_viewer_id;
    v_user_2_id := p_candidate_id;
  else
    v_user_1_id := p_candidate_id;
    v_user_2_id := v_viewer_id;
  end if;

  insert into public.matches (user_1_id, user_2_id, status, is_unlocked)
  values (v_user_1_id, v_user_2_id, 'rejected', false)
  on conflict (user_1_id, user_2_id)
  do update set status = 'rejected', is_unlocked = false;
end;
$$;

create or replace function public.clear_rejected_profiles()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_viewer_id uuid := auth.uid();
begin
  if v_viewer_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.matches
  where status = 'rejected'
    and (user_1_id = v_viewer_id or user_2_id = v_viewer_id);
end;
$$;

grant execute on function public.reject_profile(uuid) to authenticated;
grant execute on function public.clear_rejected_profiles() to authenticated;
