-- ============================================================================
-- RLS smoke test — run in Supabase Dashboard → SQL Editor
--
-- HOW TO USE:
--   1. Get a real test user's UUID:  select id, email from auth.users limit 5;
--   2. Paste it into :test_uid below (keep the quotes).
--   3. Run the whole script. Each block prints a PASS/FAIL note.
--
-- What it does: impersonates a normal authenticated user (role = authenticated,
-- request.jwt.claim.sub = that user) and checks that RLS lets the right reads
-- through and blocks the tier self-upgrade exploit.
-- ============================================================================

\set test_uid '00000000-0000-0000-0000-000000000000'   -- <-- REPLACE with a real user id

-- ---- impersonate a normal signed-in user -----------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', :'test_uid', true);
select set_config('request.jwt.claims',
    json_build_object('sub', :'test_uid', 'role', 'authenticated')::text, true);

-- ---- 1. Can the user see candidate profiles? (should be > 0) ----------------
select 'profiles visible: ' || count(*)::text ||
       case when count(*) > 0 then '  ✅ PASS' else '  ❌ FAIL (feed will be empty)' end
from profiles;

-- ---- 2. Can the user read their own matches? --------------------------------
select 'own matches: ' || count(*)::text || '  (ok if you have matches)'
from matches;

-- ---- 3. Can the user read their own notifications? --------------------------
select 'own notifications: ' || count(*)::text
from notifications;

-- ---- 4. Can the user read their own shortlists? -----------------------------
select 'own shortlists: ' || count(*)::text
from profile_shortlists;

-- ---- 5. SECURITY: user must NOT be able to self-upgrade to VIP --------------
--        The update should affect the row but the trigger reverts the tier.
do $$
declare
    before_tier text;
    after_tier  text;
begin
    select subscription_tier into before_tier from profiles where id = current_setting('request.jwt.claim.sub')::uuid;
    begin
        update profiles set subscription_tier = 'vip'
        where id = current_setting('request.jwt.claim.sub')::uuid;
    exception when others then
        raise notice 'update raised (also fine): %', sqlerrm;
    end;
    select subscription_tier into after_tier from profiles where id = current_setting('request.jwt.claim.sub')::uuid;

    if after_tier is distinct from 'vip' then
        raise notice 'tier self-upgrade blocked (% -> %)  ✅ PASS', before_tier, after_tier;
    else
        raise notice 'tier CHANGED to vip  ❌ FAIL — trigger not protecting subscription_tier';
    end if;
end $$;

-- ---- 6. SECURITY: user must NOT change verification_status ------------------
do $$
declare
    before_v text;
    after_v  text;
begin
    select verification_status into before_v from profiles where id = current_setting('request.jwt.claim.sub')::uuid;
    begin
        update profiles set verification_status = 'verified'
        where id = current_setting('request.jwt.claim.sub')::uuid;
    exception when others then null;
    end;
    select verification_status into after_v from profiles where id = current_setting('request.jwt.claim.sub')::uuid;
    if after_v is distinct from 'verified' or before_v = 'verified' then
        raise notice 'verification_status protected (% -> %)  ✅ PASS', before_v, after_v;
    else
        raise notice 'verification_status CHANGED  ❌ FAIL', before_v, after_v;
    end if;
end $$;

reset role;
-- ============================================================================
-- Expected: blocks 1 shows > 0 profiles; blocks 5 & 6 show ✅ PASS.
-- If block 1 is 0, your discovery feed is empty under RLS — tell the assistant.
-- ============================================================================
