-- ============================================================================
-- RLS smoke test — run in Supabase Dashboard → SQL Editor
--
-- HOW TO USE:
--   1. Get a real test user's UUID:  select id, email from auth.users limit 5;
--   2. Replace the UUID in the two `set_config` lines below.
--   3. Run the whole script. It runs inside a transaction that is ROLLED BACK,
--      so it changes nothing. ALL checks come back in ONE result table.
--
-- NOTE: the SQL Editor runs as a privileged role that bypasses RLS and only
-- shows the LAST statement's rows, so we impersonate the authenticated role
-- and return every check as a single UNION-ed result set.
-- ============================================================================

BEGIN;

-- Impersonate a normal signed-in user. <<< PASTE YOUR TEST USER ID IN BOTH LINES >>>
select set_config('request.jwt.claim.sub', 'd91287f8-3a22-429a-9e93-9b8509fdc714', true);
select set_config('request.jwt.claims',
    json_build_object('sub', 'd91287f8-3a22-429a-9e93-9b8509fdc714', 'role', 'authenticated')::text, true);
set local role authenticated;

-- Attempt the two exploits (the triggers should silently revert them).
update profiles set subscription_tier   = 'vip'      where id = current_setting('request.jwt.claim.sub')::uuid;
update profiles set verification_status = 'verified' where id = current_setting('request.jwt.claim.sub')::uuid;

-- One combined result table: each row is a check with its PASS/FAIL verdict.
select * from (
    select 1 as ord, 'profiles visible (feed)' as check,
           (select count(*)::text from profiles) as value,
           case when (select count(*) from profiles) > 0 then '✅ PASS' else '❌ FAIL — feed empty' end as verdict
    union all
    select 2, 'own matches readable',
           (select count(*)::text from matches), 'ℹ️ info'
    union all
    select 3, 'own notifications readable',
           (select count(*)::text from notifications), 'ℹ️ info'
    union all
    select 4, 'own shortlists readable',
           (select count(*)::text from profile_shortlists), 'ℹ️ info'
    union all
    select 5, 'tier self-upgrade blocked',
           (select subscription_tier from profiles where id = current_setting('request.jwt.claim.sub')::uuid),
           case when (select subscription_tier from profiles where id = current_setting('request.jwt.claim.sub')::uuid) is distinct from 'vip'
                then '✅ PASS' else '❌ FAIL — tier changed to vip' end
    union all
    select 6, 'verification self-set blocked',
           (select verification_status from profiles where id = current_setting('request.jwt.claim.sub')::uuid),
           case when (select verification_status from profiles where id = current_setting('request.jwt.claim.sub')::uuid) is distinct from 'verified'
                then '✅ PASS' else '⚠️ CHECK — verification=verified (fail only if it was not before)' end
) t
order by ord;

reset role;
ROLLBACK;
-- ============================================================================
-- Expected: row 1 value > 0; rows 5 & 6 show ✅ PASS.
-- ============================================================================
