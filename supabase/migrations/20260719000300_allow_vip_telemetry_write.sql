-- Migration: Allow VIP users to write their own telemetry (inserts and updates)

-- 1. Update policies on vip_bot_sessions
drop policy if exists "VIP users can view their own bot session" on public.vip_bot_sessions;
drop policy if exists "VIP users can view and edit their own bot session" on public.vip_bot_sessions;
create policy "VIP users can view and edit their own bot session"
  on public.vip_bot_sessions
  for all
  using (
    vip_id = auth.uid()
    and public.is_vip(auth.uid())
  )
  with check (
    vip_id = auth.uid()
    and public.is_vip(auth.uid())
  );

-- 2. Update policies on vip_outreach_logs
drop policy if exists "VIP users can view their own outreach logs" on public.vip_outreach_logs;
drop policy if exists "VIP users can view and edit their own outreach logs" on public.vip_outreach_logs;
create policy "VIP users can view and edit their own outreach logs"
  on public.vip_outreach_logs
  for all
  using (
    vip_id = auth.uid()
    and public.is_vip(auth.uid())
  )
  with check (
    vip_id = auth.uid()
    and public.is_vip(auth.uid())
  );
