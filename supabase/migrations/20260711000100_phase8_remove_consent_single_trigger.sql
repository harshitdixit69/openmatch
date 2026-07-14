-- Phase 8 refactor: remove consent columns, enforce single-trigger broker calls.

-- 1. Drop consent columns from ai_broker_calls
alter table public.ai_broker_calls drop column if exists consent_required;
alter table public.ai_broker_calls drop column if exists consent_granted;
alter table public.ai_broker_calls drop column if exists consent_recorded_at;
-- 2. Drop broker consent columns from profiles (if they were added)
alter table public.profiles drop column if exists broker_consent_granted;
alter table public.profiles drop column if exists preferred_reminder_channel;
-- 3. Drop the old active-attempt unique index (was per request+target+channel)
drop index if exists ai_broker_calls_active_attempt_idx;
-- 4. New unique index: only ONE broker call per request_id (any status except terminal).
--    This enforces the single-trigger rule at the database level.
create unique index if not exists ai_broker_calls_single_trigger_idx
  on public.ai_broker_calls (request_id)
  where status in ('queued', 'consent_required', 'consent_granted', 'dialing', 'in_progress');
