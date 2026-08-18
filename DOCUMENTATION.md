# OpenMatch — Complete Application Documentation

> **Version:** 2.0 · **Last consolidated:** August 3, 2026
> This is the single source of truth for the OpenMatch platform. It supersedes all previous
> documentation files (`README.md`, `claude.md`, `openmatch_project_doc.txt`,
> `FEATURE_BACKLOG.md`, `FEATURE_COMPARISON.md`, `major cencern bottlenecks`, and `STRUCTURE.md`).

---

## 1. What is OpenMatch?

OpenMatch is a modern, AI-first matrimonial matchmaking platform built to disrupt legacy incumbents
(Shaadi.com, Jeevansathi.com) that rely on coercive monetization — blurring faces, locking chat,
spamming notifications, and charging $30–$150/month subscriptions.

### The Problem
- **Forced friction:** communication and profiles deliberately locked/blurred to force upgrades.
- **Extortionate paywalls:** baseline interactions gated behind expensive subscriptions.
- **The "vanishing" phenomenon:** bulk "interest spraying" followed by ghosting after acceptance.

### The OpenMatch Solution — "AI Escrow" Freemium Model
Users browse fully-revealed profiles, match, and chat **for free** under AI moderation that blocks
PII (phone numbers, emails, handles). Once mutual trust is established, both users pay a small
**micro-transaction (~₹99 / $1)** to unlock unmoderated direct contact. This replaces high monthly
gates with a fair, one-time, value-aligned unlock.

**Core pillars:**
1. **Total transparency** — no blurred photos; replaced with Compatibility Snapshots & Common Ground Insights.
2. **AI Escrow chat** — free chat with real-time semantic PII redaction until mutual unlock.
3. **Mutual unlock micro-transaction** — fair-pay, both parties consent + pay to exchange contact.
4. **Intent Escrow & Trust Scoring** — anti-ghosting via personalized reasons, reply SLAs, ghost-risk & reliability scores.
5. **AI Broker calls** — optional automated outbound voice engagement for high-intent matches.
6. **VIP Concierge** — assisted, human-in-the-loop sourcing pipeline for premium users.

---

## 2. Repository Layout

```
openmatch/                       ← repo root
├── DOCUMENTATION.md             ← this file (single source of truth)
├── OpenMatch_Subscription_Tasks.xlsx
├── openmatch/                   ← React Native / Expo mobile app (primary client)
│   ├── App.tsx, index.ts, app.json, eas.json, package.json, tsconfig.json
│   ├── src/
│   │   ├── screens/             ← full-page screens (see §4)
│   │   ├── components/          ← reusable UI components
│   │   ├── lib/                 ← API clients & utilities (see §5)
│   │   └── test/                ← test setup
│   ├── supabase/                ← app-local edge functions + migrations
│   ├── scripts/                 ← integration checks, seeders, backfills
│   └── patches/                 ← patch-package overrides (@supabase-js)
├── supabase/                    ← canonical backend (Postgres + Edge Functions)
│   ├── migrations/              ← 80+ sequenced SQL migrations
│   ├── functions/               ← 33 Deno Edge Functions (see §6)
│   └── scripts/
└── vip-portal-web/              ← Next.js web dashboard for VIP concierge/agents
    ├── app/                     ← App Router (standard + vip route groups, API routes)
    ├── lib/supabase.ts
    └── middleware.ts
```

---

## 3. Technology Stack

| Layer | Technology |
|-------|-----------|
| **Mobile client** | React Native `0.85` + Expo `~56`, TypeScript `~5.8`, React `19.2` |
| **Web portal** | Next.js (App Router) + Tailwind CSS |
| **Backend & DB** | Supabase (PostgreSQL) with Row-Level Security |
| **Vector engine** | `pgvector` — 1536-dim embeddings, cosine distance, HNSW index |
| **Serverless** | Supabase Edge Functions (Deno) |
| **Auth** | Supabase Auth (Email/OTP) + Sign in with Apple |
| **Primary LLMs** | OpenAI GPT-4o-mini (escrow moderation, JSON extraction) |
| **Low-latency AI** | Groq (Llama/Mixtral) — request coaching, ghost-risk, nudges |
| **Audio** | Deepgram Nova / Whisper — voice intro transcription |
| **AI Voice calls** | Retell AI / VAPI on Twilio — outbound broker engagement |
| **Payments** | Stripe (Payment Intents, Apple Pay, subscription checkout) |
| **Hosting** | Vercel (web), Supabase Edge Functions (webhooks/AI) |

---

## 4. Mobile App — Screens (`openmatch/src/screens/`)

**Navigation:** 5 main tabs (Home, Matches, Inbox, Chat, Premium) via `MainTabsScreen`, plus modal screens.

| Screen | Purpose |
|--------|---------|
| `AuthScreen` | Email/OTP + Sign in with Apple login/signup |
| `OnboardingScreen` | AI-guided multi-step profile creation (bio + preferences via copilot) |
| `MainTabsScreen` | Tab shell, home hub, premium plan tables, spotlight |
| `HomeScreen` | Swipeable semantic match feed (Animated cards) |
| `MyMatchesScreen` | Matches filtered by connected/unlocked/pending |
| `MatchProfileScreen` | Long-form profile detail (album, family, career, compatibility, common ground) |
| `ChatScreen` | AI-escrow messaging, unlock flow, trust drawer, chat copilot |
| `NotificationsScreen` | Realtime in-app + push notifications |
| `DashboardScreen` | Activity stats, reliability score, ghost-risk |
| `SearchScreen` | Text + filter-chip discovery |
| `ShortlistScreen` | Saved/bookmarked profiles |
| `WhoViewedMeScreen` | Recent profile visitors |
| `PartnerPreferencesScreen` | Age, height, education, diet, religion, location prefs |
| `ProfileEditScreen` | 5-section profile form with photo management |
| `SettingsScreen` | Account, notifications, privacy, danger zone |
| `IdentityVerificationScreen` | ID upload + face-liveness verification |
| `ModerationQueueScreen` | Silent block/report moderation queue |
| `ConciergeHubScreen` / `VipConciergeDashboard` | VIP assisted sourcing pipeline |
| `Premium*Screen` (Chat, Hub, Search, Settings, etc.) | Premium-tier variants of core surfaces |

---

## 5. Mobile App — Libraries (`openmatch/src/lib/`)

| Module | Responsibility |
|--------|---------------|
| `supabase.ts` | Supabase client init |
| `chatApi.ts` | Messages, matches, unlock state (batched/concurrent queries) |
| `matchmakingApi.ts` | Semantic feed, hybrid filtering, auto-fetch pagination |
| `intentEscrowApi.ts` | Interest requests, reasons, SLA, trust summaries |
| `profileApi.ts` / `profilePhotoApi.ts` | Profile CRUD + photo management |
| `partnerPreferencesApi.ts` | Partner preference read/write |
| `notificationsApi.ts` | Realtime notifications |
| `profileViewsApi.ts` | Who-viewed-me tracking |
| `shortlistApi.ts` | Bookmarks |
| `activityStatsApi.ts` | Dashboard stats |
| `conciergeApi.ts` | VIP concierge intake + sourcing |
| `voiceIntroApi.ts` | Voice intro record/upload |
| `paymentSheet.ts` / `paymentSheet.native.ts` | Stripe payment sheet (web + native) |
| `premiumAnalytics.ts` / `premiumPopup.ts` / `premiumTargeting.ts` | Premium promo A/B, cooldowns, arm bucketing |
| `aiApi.ts` | Shared AI endpoint helpers |
| `theme.tsx` / `uiScale.ts` / `responsiveLayout.tsx` | Theming & responsive layout |

Many modules ship co-located Jest tests (`*.test.ts`).

---

## 6. Backend — Edge Functions (`supabase/functions/`, 33 functions)

**Matchmaking & Profiles**
- `generate-profile-embedding` — OpenAI embeddings → `profiles.embedding`
- `generate-profile-variants` — AI profile ghostwriter variants
- `generate-compatibility-summary` — 2-sentence "why you match" snapshot
- `generate-fit-friction-breakdown` — checklist fit/mismatch scoring
- `onboarding-copilot` — AI-guided onboarding

**Escrow Chat & Unlock**
- `send-escrow-message` — regex + LLM PII detection & redaction
- `update-match-unlock` — flips `is_unlocked` on mutual paid consent
- `create-unlock-payment-intent` — Stripe payment intent for micro-transaction
- `generate-chat-copilot` / `generate-chat-prompts` — reply suggestions
- `typing-status` — realtime typing indicator

**Intent Escrow & Trust**
- `submit-interest-request` — create intent artifact with reason/media
- `generate-request-reasons` — AI-personalized request reasons
- `respond-interest-request` — accept/decline + notification insert
- `review-request-voice-intro` — voice intro quality check
- `get-request-trust-summary` — reliability + ghost-risk summary
- `extend-sla` — SLA grace / snooze
- `process-ghosting-followups` — ghosting detection + reminders
- `manage-match-request` — match state orchestration

**AI Broker Calls**
- `send-broker-consent` — sender→receiver consent + channel choice
- `trigger-outbound-broker-call` / `trigger-intent-callback` — Retell/VAPI/Twilio dispatch
- `handle-broker-call-webhook` / `retell-webhook-handler` — call events + AI summaries

**Payments & Subscriptions**
- `create-subscription-checkout` — Stripe checkout (Pro / Pro Max / Exclusive tiers)
- `stripe-webhook` — signed webhook fulfillment
- `process-payment-refunds` — automatic credit restoration
- `test-subscription-fulfillment` — fulfillment test harness

**VIP Concierge**
- `concierge-intake-chat` / `process-concierge-intake` — intake flow
- `generate-assisted-shortlist` — AI-sourced candidate shortlist
- `discuss-candidate-chat` — concierge discussion assistant

`_shared/` holds common CORS, auth, and LLM client helpers.

---

## 7. Data Model (Postgres, RLS-enforced)

Core tables (80+ sequenced migrations in `supabase/migrations/`):

- **`profiles`** — identity, `full_name`, `gender`, `dob`, `location`, `bio`, `profile_owner`
  (`self`/`parent`/`sibling`/`relative`), `embedding vector(1536)`, `verification_status`,
  `subscription_tier`, `subscription_expires_at`, spotlight fields.
- **`profile_contact_details`** — masked phone/email/WhatsApp (unlocked only after payment).
- **`matches`** — `user_1_id` < `user_2_id`, `status` (`pending`/`connected`/`rejected`),
  `is_unlocked`, `ai_compatibility_summary`; unique pair constraint.
- **`messages`** — chat frames, `is_flagged_by_system`, `read_at`.
- **`interest_requests`** — intent artifacts: `personalized_reason`, `ai_reason_summary`,
  `media_type/url`, `request_quality_score`, `sender_ghost_risk_score`, `first_reply_due_at`,
  `first_reply_at`, `ghosted_at`, `reminder_count`, `status`.
- **`interest_request_events`** — audit trail of request state changes.
- **`profile_reliability_scores`** — `response_reliability_score`, `ghost_risk_score`,
  `active_request_limit`, SLA/ghost counters, `median_first_reply_minutes`.
- **`ai_broker_calls`** — broker call orchestration, consent, summaries.
- **`match_unlocks`** — per-user unlock/payment state.
- **`notifications`** — realtime alerts (service-role insert policies).
- Plus tables for shortlists, profile views, VIP outreach credits/telemetry.

**Key RPCs:** `match_profiles` (hybrid vector search), `consume_vip_outreach_credit` (atomic
credit gate), `refund_vip_outreach_trigger`, `get_activity_stats`, `upsert_profile_view` — all
using `auth.uid()` internally to prevent client spoofing.

---

## 8. Core Workflows

### 8.1 AI Escrow Moderation (PII block, <600ms target)
1. **Regex pre-filter** catches emails, `@handles`, numeric dial strings.
2. **LLM parser** (GPT-4o-mini, JSON schema) detects obfuscated PII ("nine five six...", image links).
3. **Redaction** writes `<Upgrade to share contact info>` and surfaces an actionable unlock trigger in-chat.

### 8.2 Mutual Unlock (fair-pay)
User A requests contact exchange → User B accepts → backend creates one Stripe PaymentIntent per
participant → on both signed webhooks, `matches.is_unlocked = true` → escrow interceptor is bypassed.

### 8.3 Hybrid Match Discovery
Hard SQL filters first (age, religion, diet, location radius) → then `pgvector` cosine similarity
(HNSW index) on the surviving pool → ranked feed with auto-fetch when 5 cards from the end.

### 8.4 Anti-Ghosting Intent Escrow
On acceptance, `first_reply_due_at = now() + 24h`. A daemon flips unmet requests to `ghosted`,
lowers the sender's `response_reliability_score`, and throttles their `active_request_limit`.
SLA grace/snooze ("Weekend Mode") prevents false ghosting.

### 8.5 AI Broker Calls
Consent-gated outbound calls (Retell/VAPI/Twilio) for high-intent matches, with AI-generated call
summaries written back to `ai_broker_calls`.

---

## 9. Subscription & Monetization

- **Free tier:** browse, match, escrow chat, compatibility insights.
- **Mutual unlock:** one-time micro-transaction (~₹99 / $1) to exchange contact.
- **Premium tiers** (via `create-subscription-checkout`): **Pro**, **Pro Max**, **Pro Supreme**,
  and **Exclusive/Assisted** — bundling upfront unlock credits, AI broker calls, spotlights, and
  (for Assisted) a human AI-matchmaker concierge. Durations: 1 / 3 / 6 / 12 months with
  multiplier-based bulk credits.
- **Non-coercive promos:** premium promo cards with A/B experiment arms, impression cooldowns,
  and by-surface/by-arm CTR analytics — never blocking the free core journey.

---

## 10. VIP Concierge (Web Portal — `vip-portal-web/`)

A Next.js App Router dashboard for concierge/agents:
- **Route groups:** `(standard)` and `(vip)` dashboards, gated by `middleware.ts`.
- **API routes:** `api/vip/trigger-pitch`, `api/vip/retell-webhook`.
- **Pipeline stages:** Ready to Pitch → Call Active → Awaiting Handshake → Connected.
- Atomic credit consumption + automatic refunds on failed/declined pitches.
- Shares the Supabase backend (`lib/supabase.ts`).

---

## 11. Security & Compliance

- **Row-Level Security** on all user-scoped tables; no cross-user reads of contacts, messages, or billing.
- **Zero-trust writes:** match state, transactions, and reliability recalcs run server-side only.
- **Payment integrity:** `is_unlocked` flips only on signed Stripe webhook confirmation.
- **Identity verification (server-authoritative):** The `verify-identity-ai` Edge Function is the
  only path that can set `verification_status`. It runs the AI check, stores raw govt IDs in a
  **private** `verification-docs` bucket, logs the attempt, and writes the badge with the service
  role. A DB trigger (`prevent_client_verification_change`) reverts any client attempt to mutate
  the trust columns, so users cannot self-grant a verified badge. Selfies are captured **live via
  the front camera** (liveness-lite). Borderline confidence → `pending` (manual review); transient
  AI/infra failures return `error` and never falsely reject a legitimate user.
- **Silent block/report:** blocking hides the profile and routes messages to a moderation queue
  without alerting the blocked user (prevents retaliation).

---

## 12. Development

### Prerequisites
- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- Supabase CLI (for migrations & edge function deploys)

### Mobile app
```bash
cd openmatch
npm install            # runs patch-package postinstall
npm run ios            # or: npm run android / npm run web
npm test               # Jest suite
npm run test:coverage
```

### Backend
```bash
# from supabase/  — apply migrations & deploy functions via Supabase CLI
supabase db push
supabase functions deploy <function-name>
```
Integration checks live in `openmatch/scripts/` (e.g. `npm run check:phase4`, `check:idempotency`).

### Web portal
```bash
cd vip-portal-web
npm install
npm run dev
```

### Required environment variables (see `supabase/functions/.env.example`)
Supabase URL + anon/service keys, `OPENAI_API_KEY`, `GROQ_API_KEY`, Deepgram, Retell/Twilio,
and Stripe secret + webhook signing keys.

---

## 13. Implementation Status

| Phase | Status |
|-------|--------|
| 1 — Setup, Auth & Identity | ✅ Complete |
| 2 — Onboarding & Vector Embeddings | ✅ Complete |
| 3 — Semantic Matchmaking Feed | ✅ Complete |
| 4 — AI Escrow Chat | ✅ Complete |
| 5 — Payments & Mutual Unlock | ✅ Complete |
| 6 — Reference UI / Inbox Polish | ✅ Complete |
| 7 — Intent Escrow, Trust & Reliability | ✅ Complete |
| 8 — AI Broker Automated Voice Calls | ✅ Complete |
| 9 — Bulk Credits & Premium Subscriptions | ✅ Complete |
| 10 — VIP Concierge Sourcing Engine | ✅ Complete |

---

## 14. Known Design Considerations / Roadmap

- **Mutual payment deadlock:** first-mover protection via authorize-then-charge escrow, 48-hour
  auto-refund, or a "Free Unlock Token" if the counterparty doesn't reciprocate.
- **Hybrid search hardening:** keep enforcing non-negotiable SQL dealbreakers before vector ranking.
- **Actionable PII redactions:** render redactions as tappable "Send Mutual Unlock Request" UI.
- **SLA grace periods:** snooze / Weekend Mode to avoid false ghosting.
- **Astro/Kundali compatibility:** planned for Indian-matrimony fit.
- **Deeper premium experimentation dashboards** and richer live-status chat signals.

---

*License: Proprietary — OpenMatch Inc.*
