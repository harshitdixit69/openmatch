# OpenMatch — Security & Correctness Audit TODO

_Audit date: 2026-08-03_

Priority key: 🔴 Critical · 🟡 Important · 🟢 Nice-to-have

---

## 🔴 Critical

### 1. ✅ DONE — Remove duplicate / conflicting edge functions
- [x] Deleted stale `openmatch/supabase/functions/` (broken `stripe-webhook` with mismatched
      metadata keys + old `create-subscription-checkout`, `retell-webhook-handler`).
- [x] Deleted stale `openmatch/supabase/migrations/` subset (superseded by root `supabase/migrations`).
- [x] **Preserved** the only copy of `verify-identity-ai` (actively invoked by
      `profileApi.ts`) → moved to canonical `supabase/functions/verify-identity-ai/`.
- [x] **Archived** the one unique migration (`auto_generate_profile_embedding`) to
      `supabase/migrations/_archive_unapplied/` (kept out of the active apply path to avoid
      out-of-order migration issues; review before ever applying).
- Result: only the correct root `supabase/` tree remains, so the broken webhook can no longer
  be deployed. Canonical `stripe-webhook` has idempotency + matching metadata keys.
- **Why:** Stale `openmatch/supabase/functions/stripe-webhook/index.ts` reads wrong Stripe
  metadata keys (`tier`/`months`/`unlockCredits`/`aiCalls` vs actual
  `planTier`/`duration_months`/`unlock_credits`/`ai_calls`). If deployed, users pay and
  get **0 months / 0 credits** with no error. Stale copy also lacks the
  `fulfilled_payments` idempotency guard → possible double-crediting on Stripe retries.
- **Duplicated functions:** `create-subscription-checkout`, `retell-webhook-handler`, `stripe-webhook`.

### 2. Add / verify Row-Level Security (RLS) on core tables
- [ ] Add migrations that enable RLS + self-access-only policies for `profiles`, `matches`,
      and chat/message tables (none currently exist in `supabase/migrations/`).
- [ ] Make sensitive columns non-writable by users: `subscription_tier`,
      `subscription_expires_at`, `manual_unlock_credits`, `ai_call_credits`,
      `unlock_credits_remaining`, etc. (service-role writes only, via webhook).
- **Why:** Anon key ships to client. Without RLS, any user can read/modify others'
  profiles, tiers, credits, and messages directly through the Supabase REST API.

### 3. Enforce entitlements server-side (not client-only)
- [ ] Stop trusting client-read `subscription_tier` for premium gating
      (`MainTabsScreen.tsx`, `HomeScreen.tsx`, `SearchScreen.tsx`).
- [ ] Gate premium features server-side (edge function / RLS-backed).
- **Why:** If users can write their own profile row, they can self-assign `vip` and
  unlock paid features for free. Tied to #2.

### 4. ✅ DONE — Harden Retell webhook signature verification
- [x] The **root** function had **no verification at all** (worse than the stale copy) — now added.
- [x] **Fails closed**: missing `RETELL_API_KEY`/`RETELL_WEBHOOK_SECRET` → `500` (no more skip-and-accept).
- [x] Real **HMAC-SHA256 over the raw body** (matches Retell's `verify()` SDK algorithm), hex-encoded,
      compared in **constant time**; tolerates optional `sha256=` prefix.
- [x] Reads raw body once and `JSON.parse`s it (re-serializing would break the HMAC).
- **File:** `supabase/functions/retell-webhook-handler/index.ts`
- ☐ **You set** the secret: `supabase secrets set RETELL_API_KEY=<your_retell_api_key>` and configure
  the same in the Retell dashboard webhook settings.
- **Why:** Forged POSTs could fake call outcomes (e.g., `accepted_pitch: true`).

### 5. ✅ DONE — Confirm no secrets leaked in git history
- [x] `.env` / `supabase/functions/.env` were **never committed** (gitignored) ✅
- [x] **No Stripe secret keys** (`sk_live`/`sk_test`) anywhere in history ✅
- [x] **No service-role JWT** in history — decoded every `eyJ…` token across all commits;
      none decode to `role: service_role`. The `service_role` hits are just code strings
      (RPC role checks, env-var names; `phase8BrokerCheck.mjs` reads it from `process.env`). ✅
- [x] **New finding fixed:** `vip-portal-web/.next/` (114 build artifacts) was committed with
      **no `.gitignore`**. Verified the map files hold **no literal secret** (only code strings),
      but build artifacts shouldn't be tracked → added `vip-portal-web/.gitignore` and
      `git rm -r --cached vip-portal-web/.next` (kept on disk, now untracked).
- ☐ **You do:** commit these changes. (No history rewrite needed since no real secret leaked.)

---

## 🟡 Important
- [ ] Tighten CORS: replace `Access-Control-Allow-Origin: '*'` with app origins for authed functions
      (public webhooks can stay open).
- [ ] Resolve duplicate migrations directory to prevent schema drift.
- [ ] Review the `Authorization: Bearer <service_role_key>` bypass path in `stripe-webhook`
      to ensure it's unreachable by untrusted callers.

---

## 🟢 Nice-to-have
- [ ] Add automated test asserting Stripe checkout metadata keys match webhook reader keys.
- [ ] Add a CI check that fails if `openmatch/supabase/` duplicates reappear.

---

### Suggested order
1. #1 (quick, high impact) → 2. #2 → 3. #3 → 4. #4 → 5. #5
