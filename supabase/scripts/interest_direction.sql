-- ============================================================================
-- Who sent interest to whom
-- ============================================================================
--
-- IMPORTANT — read before using:
--
-- `public.matches` CANNOT tell you who initiated. Its two participant columns
-- are stored in canonical UUID order (see `reject_profile` in
-- 20260715000700_add_pass_logic.sql: "Maintain consistent order: user_1_id <
-- user_2_id"). So `user_1_id` is simply whichever UUID sorts lower — it is NOT
-- the sender. Any query that reads direction out of `matches` alone is wrong.
--
-- Direction lives in `public.interest_requests`, which has explicit
-- `sender_id` -> `receiver_id` columns. That is the table these queries use;
-- `matches` is joined only for match-level context (status, is_unlocked).
--
-- Run with:  psql "$DATABASE_URL" -f supabase/scripts/interest_direction.sql
-- or paste an individual query into the Supabase SQL editor.
--
-- These run as the table owner / service role. Under RLS as a normal user you
-- will only ever see your own rows.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Main report: every interest request, who sent it, who received it.
-- ----------------------------------------------------------------------------
select
    ir.created_at                       as sent_at,
    sender.full_name                    as sender_name,
    receiver.full_name                  as receiver_name,
    ir.status                           as request_status,
    m.status                            as match_status,
    m.is_unlocked                       as contact_unlocked,
    ir.accepted_at,
    ir.first_reply_at,
    ir.media_type,
    ir.request_quality_score,
    ir.match_id,
    ir.id                               as request_id
from public.interest_requests ir
join public.profiles sender   on sender.id   = ir.sender_id
join public.profiles receiver on receiver.id = ir.receiver_id
join public.matches  m        on m.id        = ir.match_id
order by ir.created_at desc;


-- ----------------------------------------------------------------------------
-- 2. Same thing as a single readable sentence per row.
-- ----------------------------------------------------------------------------
select
    sender.full_name || ' → ' || receiver.full_name || '  ('
        || ir.status || ', sent ' || to_char(ir.created_at, 'DD Mon YYYY HH24:MI') || ')'
        as interest
from public.interest_requests ir
join public.profiles sender   on sender.id   = ir.sender_id
join public.profiles receiver on receiver.id = ir.receiver_id
order by ir.created_at desc;


-- ----------------------------------------------------------------------------
-- 3. Requests for one specific person, in both directions.
--    Replace the UUID below.
-- ----------------------------------------------------------------------------
with target as (select '00000000-0000-0000-0000-000000000000'::uuid as id)
select
    case when ir.sender_id = t.id then 'sent' else 'received' end as direction,
    sender.full_name    as sender_name,
    receiver.full_name  as receiver_name,
    ir.status,
    ir.created_at
from public.interest_requests ir
cross join target t
join public.profiles sender   on sender.id   = ir.sender_id
join public.profiles receiver on receiver.id = ir.receiver_id
where ir.sender_id = t.id or ir.receiver_id = t.id
order by ir.created_at desc;


-- ----------------------------------------------------------------------------
-- 4. Per-user summary: how many sent vs received, and acceptance rate.
-- ----------------------------------------------------------------------------
select
    p.full_name,
    count(*) filter (where ir.sender_id   = p.id)                          as requests_sent,
    count(*) filter (where ir.receiver_id = p.id)                          as requests_received,
    count(*) filter (where ir.sender_id   = p.id and ir.status = 'accepted') as sent_accepted,
    count(*) filter (where ir.receiver_id = p.id and ir.status = 'accepted') as received_accepted,
    round(
        100.0 * count(*) filter (where ir.sender_id = p.id and ir.status = 'accepted')
        / nullif(count(*) filter (where ir.sender_id = p.id), 0)
    , 1) as sent_acceptance_pct
from public.profiles p
join public.interest_requests ir on ir.sender_id = p.id or ir.receiver_id = p.id
group by p.id, p.full_name
having count(*) > 0
order by requests_sent desc, requests_received desc;


-- ----------------------------------------------------------------------------
-- 5. Matches that have NO interest request attached.
--
--    These are rows created by swiping/passing rather than by a real request,
--    so there is genuinely no sender for them. Included because it explains
--    why the counts in query 1 will be lower than `select count(*) from matches`.
-- ----------------------------------------------------------------------------
select
    m.id as match_id,
    p1.full_name as participant_a,
    p2.full_name as participant_b,
    m.status,
    m.is_unlocked,
    m.created_at
from public.matches m
join public.profiles p1 on p1.id = m.user_1_id
join public.profiles p2 on p2.id = m.user_2_id
where not exists (
    select 1 from public.interest_requests ir where ir.match_id = m.id
)
order by m.created_at desc;
