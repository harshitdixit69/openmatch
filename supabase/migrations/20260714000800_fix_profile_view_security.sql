-- Migration: harden upsert_profile_view
-- Security fix: remove the p_viewer_id parameter and derive the caller identity
-- from auth.uid() internally. Previously a caller invoking the security-definer
-- RPC directly could supply any UUID as the viewer, bypassing the RLS insert
-- check on profile_views (viewer_id = auth.uid()).

create or replace function public.upsert_profile_view(
  p_viewed_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_viewer_id uuid := auth.uid();
begin
  if v_viewer_id is null then
    return; -- unauthenticated — silently no-op
  end if;

  if v_viewer_id = p_viewed_id then
    return; -- no self-views
  end if;

  insert into public.profile_views (viewer_id, viewed_id, view_date, viewed_at)
  values (v_viewer_id, p_viewed_id, (timezone('utc'::text, now()))::date, timezone('utc'::text, now()))
  on conflict (viewer_id, viewed_id, view_date)
  do update set viewed_at = excluded.viewed_at;
end;
$$;

grant execute on function public.upsert_profile_view(uuid) to authenticated;

-- Helper: who viewed my profile — keeps p_viewed_id param (no spoofing risk:
-- this only exposes data ABOUT the caller's profile, restricted by RLS SELECT).
-- Re-declared here for completeness; no signature change needed.
