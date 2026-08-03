# OpenMatch — Admin Monitoring Dashboard TODO

_Created 2026-08-04 · Goal: real-time visibility for the beta (signups, activation, retention)_

**Where to build:** reuse `vip-portal-web` (Next.js) with a new `/admin` route, or a
separate Next.js app pointing at the same Supabase project.

Legend: 🟢 must-have (build first) · 🟡 should-have · 🔵 nice-to-have · ☐ todo · ✅ done

---

## ⚠️ Decide BEFORE writing code
- [ ] **Auth gate:** dashboard behind login, only your admin account(s) allowed.
- [ ] **Service-role key stays SERVER-SIDE ONLY** (Next.js server components / route
      handlers / server actions). NEVER expose it to the browser. ← #1 rule.
- [ ] **Build vs buy:** consider PostHog / Supabase built-in logs for generic metrics;
      build custom only for the app-specific activation funnel.
- [ ] Reuse existing logic from `openmatch/scripts/checkSignups.mjs` (real-vs-mock filter).

---

## 🟢 Tier 1 — MUST have (build first)
- [ ] **1. KPI cards** — total real users, new today / 7d / 30d, progress to 100 goal
- [ ] **2. Signup feed** — who signed up, when, email/phone, confirmed vs unconfirmed
      (filter out mock/test accounts using the `isMock` logic)
- [ ] **3. Activation funnel** ← most important
      signed up → profile created → onboarding complete → first interest → first match
      (shows where users drop off)
- [ ] **4. Auth event log** — signup / login / logout / account deletion
      (source: `auth.audit_log_entries`), shown as a timeline
- [ ] **5. DAU / WAU** — active users from `last_sign_in_at` + a lightweight last-active ping

## 🟡 Tier 2 — Should have
- [ ] **6. Engagement metrics** — interests sent, matches created, messages sent, unlocks/day
- [ ] **7. Retention cohorts** — % of week-1 signups still active in week 2
- [ ] **8. Payments / revenue** — checkouts started vs completed, MRR
      (source: Stripe or `fulfilled_payments`)
- [ ] **9. Moderation queue** — reports & blocks (`user_reports`, `blocked_users`)
- [ ] **10. Error / crash feed** — wire the `ErrorBoundary` TODO or Sentry into this

## 🔵 Tier 3 — Nice to have
- [ ] **11. Geographic distribution** — city/state from profiles
- [ ] **12. AI / broker call usage & cost tracking** (`ai_outreach_logs`, `ai_broker_calls`)
- [ ] **13. Push / notification delivery stats**
- [ ] **14. Per-user drill-down** — one user's full timeline

---

## Data sources (Supabase)
| Feature | Table / source |
|---------|----------------|
| Signups, auth events | `auth.users`, `auth.audit_log_entries` |
| Activation funnel | `profiles` (onboarding_completed_at), `interest_requests`, `matches` |
| Engagement | `interest_requests`, `matches`, `messages`, `match_unlocks` |
| Payments | `fulfilled_payments`, Stripe API |
| Moderation | `user_reports`, `blocked_users` |
| AI usage | `ai_outreach_logs`, `ai_broker_calls` |

---

## Suggested first milestone
Ship **Tier 1 only** (5 features), all server-side in `vip-portal-web/app/admin`,
admin-auth gated. ~1 day of work. Everything needed to run the beta intelligently.

## Next actions
- [ ] Scaffold `/admin` route + admin-only auth in `vip-portal-web`
- [ ] Server-side Supabase admin client (service-role, env var, never client-exposed)
- [ ] Port `checkSignups.mjs` logic into a server action → KPI cards + signup feed
- [ ] Build the activation funnel query
- [ ] Add auth event timeline from `auth.audit_log_entries`
