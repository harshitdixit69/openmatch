drop policy if exists "Participants view broker calls" on public.ai_broker_calls;
create policy "Participants view broker calls" on public.ai_broker_calls
  for select using (auth.uid() = sender_profile_id or auth.uid() = receiver_profile_id);
