-- Migration: harden get_activity_stats
-- Security fix: remove the p_user_id parameter and derive the caller identity
-- from auth.uid() internally. Previously any authenticated user could read
-- another user's private stats by passing an arbitrary UUID.

create or replace function public.get_activity_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id             uuid := auth.uid();
  v_total_matches       integer := 0;
  v_connected_matches   integer := 0;
  v_unlocked_matches    integer := 0;
  v_requests_received   integer := 0;
  v_requests_sent       integer := 0;
  v_requests_accepted   integer := 0;
  v_requests_ghosted    integer := 0;
  v_messages_sent       integer := 0;
  v_messages_received   integer := 0;
  v_profile_views_7d    integer := 0;
  v_unread_msgs         integer := 0;
  v_reliability_score   integer := 100;
  v_ghost_risk_score    integer := 0;
  v_active_request_limit integer := 10;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Matches
  select
    count(*)::integer,
    count(*) filter (where status = 'connected')::integer,
    count(*) filter (where is_unlocked = true)::integer
  into v_total_matches, v_connected_matches, v_unlocked_matches
  from public.matches
  where user_1_id = v_user_id or user_2_id = v_user_id;

  -- Interest requests received
  select count(*)::integer
  into v_requests_received
  from public.interest_requests
  where receiver_id = v_user_id;

  -- Interest requests sent
  select count(*)::integer
  into v_requests_sent
  from public.interest_requests
  where sender_id = v_user_id;

  -- Accepted requests (where user was sender)
  select count(*)::integer
  into v_requests_accepted
  from public.interest_requests
  where sender_id = v_user_id and status = 'accepted';

  -- Ghosted requests (where user was sender)
  select count(*)::integer
  into v_requests_ghosted
  from public.interest_requests
  where sender_id = v_user_id and status = 'ghosted';

  -- Messages sent / received
  select
    count(*) filter (where sender_id = v_user_id)::integer,
    count(*) filter (where sender_id <> v_user_id)::integer
  into v_messages_sent, v_messages_received
  from public.messages m
  join public.matches mt on mt.id = m.match_id
  where mt.user_1_id = v_user_id or mt.user_2_id = v_user_id;

  -- Profile views (last 7 days)
  select count(*)::integer
  into v_profile_views_7d
  from public.profile_views
  where viewed_id = v_user_id
    and viewed_at >= now() - interval '7 days';

  -- Unread messages
  select count(*)::integer
  into v_unread_msgs
  from public.messages m
  join public.matches mt on mt.id = m.match_id
  where (mt.user_1_id = v_user_id or mt.user_2_id = v_user_id)
    and m.sender_id <> v_user_id
    and m.read_at is null;

  -- Reliability score
  select
    coalesce(response_reliability_score, 100),
    coalesce(ghost_risk_score, 0),
    coalesce(active_request_limit, 10)
  into v_reliability_score, v_ghost_risk_score, v_active_request_limit
  from public.profile_reliability_scores
  where profile_id = v_user_id;

  return jsonb_build_object(
    'totalMatches',        v_total_matches,
    'connectedMatches',    v_connected_matches,
    'unlockedMatches',     v_unlocked_matches,
    'requestsReceived',    v_requests_received,
    'requestsSent',        v_requests_sent,
    'requestsAccepted',    v_requests_accepted,
    'requestsGhosted',     v_requests_ghosted,
    'messagesSent',        v_messages_sent,
    'messagesReceived',    v_messages_received,
    'profileViews7d',      v_profile_views_7d,
    'unreadMessages',       v_unread_msgs,
    'reliabilityScore',    v_reliability_score,
    'ghostRiskScore',      v_ghost_risk_score,
    'activeRequestLimit',  v_active_request_limit
  );
end;
$$;

-- Revoke the old parameterized version from regular users (keep the new one).
revoke execute on function public.get_activity_stats(uuid) from authenticated;
grant execute on function public.get_activity_stats() to authenticated;
