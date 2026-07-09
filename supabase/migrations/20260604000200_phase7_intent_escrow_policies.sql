drop policy if exists "Participants view their interest requests" on public.interest_requests;
create policy "Participants view their interest requests" on public.interest_requests
  for select using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "Participants view request events" on public.interest_request_events;
create policy "Participants view request events" on public.interest_request_events
  for select using (
    exists (
      select 1
      from public.interest_requests
      where interest_requests.id = interest_request_events.request_id
        and (interest_requests.sender_id = auth.uid() or interest_requests.receiver_id = auth.uid())
    )
  );

drop policy if exists "Users view their own reliability score" on public.profile_reliability_scores;
create policy "Users view their own reliability score" on public.profile_reliability_scores
  for select using (auth.uid() = profile_id);

drop policy if exists "Participants view their followup jobs" on public.ai_followup_jobs;
create policy "Participants view their followup jobs" on public.ai_followup_jobs
  for select using (
    exists (
      select 1
      from public.interest_requests
      where interest_requests.id = ai_followup_jobs.request_id
        and (interest_requests.sender_id = auth.uid() or interest_requests.receiver_id = auth.uid())
    )
  );

create or replace function public.get_active_interest_request_count(target_profile_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.interest_requests
  where sender_id = target_profile_id
    and status in ('sent', 'accepted');
$$;

grant execute on function public.get_active_interest_request_count(uuid) to authenticated;

create or replace function public.mark_interest_request_first_reply(target_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  update public.interest_requests
  set first_reply_at = coalesce(first_reply_at, timezone('utc'::text, now())),
      updated_at = timezone('utc'::text, now())
  where id = target_request_id
    and status = 'accepted'
    and first_reply_at is null;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

grant execute on function public.mark_interest_request_first_reply(uuid) to authenticated;