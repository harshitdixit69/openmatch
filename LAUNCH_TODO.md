# OpenMatch — Launch Prep Runbook

_Started 2026-08-03 · Goal: live testing + ~100 users by end of month_

Legend: ✅ done · ☐ you-run step (needs your credentials/secrets)

---

## 1. ✅ RLS migration (make DB safe for real testers)
**File added:** `supabase/migrations/20260803000000_enable_core_rls.sql`

What it does:
- ✅ Locks monetised columns on `profiles` (`subscription_tier`, `subscription_expires_at`,
  `manual_unlock_credits`, `ai_call_credits`, `unlock_credits_remaining`,
  `super_interest_remaining`, `spotlights_remaining`, `spotlight_active_until`,
  `verification_status`) via a `BEFORE UPDATE` trigger — **only the service role can change
  them**, so users can no longer self-upgrade to VIP. _(This was the #1 real risk.)_
- ✅ Adds own-row `INSERT`/`UPDATE` policies for `profiles`.
- ✅ Enables RLS + participant/owner-scoped policies on `matches`, `messages`,
  `match_unlocks`, `interest_requests`, `notifications`, `profile_shortlists`, `user_blocks`.
- ✅ Correction made during work: **did NOT** add a `profiles SELECT USING(true)` policy —
  that would have defeated the existing "read unless blocked" policy.

**Important context discovered:** the authoritative migrations live in `supabase/migrations`
(85 files) — `profiles` already had RLS. The `openmatch/supabase/migrations` folder is a
stale 10-file subset (see audit #1). Column names in the policies were taken directly from
the app's own queries.

☐ **You run (against staging first!):**
```bash
supabase db push            # or: supabase migration up
# smoke test: sign in as a normal user and confirm you CANNOT do:
#   update profiles set subscription_tier='vip' where id = auth.uid();
```

---

## 2. ✅ EAS preview build (Android APK to share) — config verified
`eas.json` already has a correct `preview` profile: `distribution: internal`,
`android.buildType: apk`, Supabase + Stripe **test** keys wired in. `app.json` package =
`com.harshi6565.openmatch`.

☐ **You run:**
```bash
cd openmatch
npm i -g eas-cli          # if not installed
eas login
eas build --profile preview --platform android
# → EAS returns a shareable .apk URL. Drop it in WhatsApp/Telegram — no store review.
```
Notes:
- Preview uses `pk_test` Stripe keys → payments are sandbox. Good for free testing.
- ⚠️ `eas.json` currently commits the anon + Stripe **publishable** keys (public-safe) — fine.
  Never put the Stripe *secret* or Supabase *service-role* key here.

---

## 3. ✅ Web deploy to Vercel — config verified
`vercel.json` is correct: `buildCommand: expo export --platform web --output-dir dist`,
SPA rewrite to `index.html`. Zero-install way to let people try it.

☐ **You run:**
```bash
cd openmatch
npm i -g vercel
vercel --prod
```
☐ In Vercel project **Settings → Environment Variables**, add:
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`

Local test before deploying: `npm run build && npx serve dist`.

---

## 4. ✅ Seed data (app not empty on launch) — script reviewed
`openmatch/scripts/seedMockUsers.mjs` creates auth users + `profiles` +
`profile_reliability_scores`. Defaults to **5000** users — too many for a test; override to a
small batch. Emails use `mock.*.test` domain so they're easy to identify/clean later.

☐ **You run (start small — 40 profiles):**
```bash
cd openmatch
export SUPABASE_URL="https://oxdhkjernhpkscrideby.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"   # NEVER commit this
TOTAL_USERS=40 BATCH_SIZE=10 node ./scripts/seedMockUsers.mjs
```
Tips:
- Seed profiles matching your target testers' preferences so early users see real candidates.
- Cleanup later: delete auth users whose email matches `%mock.%.test` (they cascade to profiles).
- The service-role key bypasses RLS, so seeding still works after item 1.

---

## Recommended go-live order
1. Apply **#1** to staging → smoke test → prod.
2. Run **#4** seed (40–50 profiles) so the app looks alive.
3. Ship **#2 APK** + **#3 web URL** to your first testers.
4. During free test: keep payments in sandbox; fix the Stripe webhook duplication (audit #1)
   before charging anyone real money.
