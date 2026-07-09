# OpenMatch — Feature Backlog (ported ideas)

> Source of ideas: the internal `matrimonial-llm-app` (FastAPI + Next.js) repo.
> This backlog lists **only features that OpenMatch does NOT already have**, adapted to our
> React Native + Expo + Supabase stack and our non-coercive "AI escrow" ethos.
>
> Already in OpenMatch (do **not** re-port): semantic embedding matching, AI compatibility
> summary + fit/friction breakdown, AI chat prompt ideas, AI escrow / PII redaction, intent-escrow
> with trust + ghost-risk scoring, voice intros, AI outbound broker calls, mutual-unlock payments,
> read receipts / unread counts, premium promo A/B analytics.

Legend — **Effort:** S (≤1 day) · M (2–4 days) · L (1–2 weeks). **Status:** ⬜ todo · 🟡 in progress · ✅ done.

---

## 🥇 Tier 1 — Highest value, best fit for AI-first positioning

### 1. AI Chat Copilot — reply suggestions + chemistry meter — Effort: M — 🟡 in progress
Mid-conversation help inside the escrow chat.
- **Reply suggestions:** 3 context-aware next messages (already partially covered by
  `generate-chat-prompts`; the copilot upgrades this).
- **Chemistry meter (0–100):** deterministic engagement score (volume, balance, curiosity,
  depth, recency) with a light AI "warmth" nudge + human-readable signals.
- **Why:** directly fights ghosting — our #1 problem — by making it easy to keep replying.
- **Build:** edge function `generate-chat-copilot` + `fetchChatCopilot` in `aiApi.ts` +
  `ChemistryMeter` UI in `ChatScreen`.

### 2. AI Profile Builder / "Ghostwriter" (full) — Effort: M — ⬜
Upgrade one-shot `onboarding-copilot` into a real builder.
- 3 tone variants (Witty / Sincere / Balanced), conversational edit ("make it shorter/funnier"),
  single-section regeneration, tone switch, undo, draft save, preview, publish + revision history.
- **Build:** edge function `generate-profile-variants` + a Profile Builder screen; store variants
  and revision history in a `profile_revisions` table.

### 3. Compatibility dimension breakdown — Effort: S–M — ⬜
Split the compatibility read into sub-scores: **values / lifestyle / personality / goals /
partner-fit**, shown as bars on `MatchProfileScreen`.
- **Build:** extend `generate-fit-friction-breakdown` to return a `dimensions` array.

---

## 🥈 Tier 2 — Trust & Safety (table-stakes we're missing)

### 4. Block & Report + moderation queue — Effort: S–M — ⬜ (important)
User-initiated **block** and **report** (currently we only redact PII).
- **Build:** `blocks` + `reports` tables (RLS), report sheet in `ChatScreen`/`MatchProfileScreen`,
  filter blocked users out of the feed and chat.

### 5. Verification ladder + badges — Effort: M — ⬜
Mobile OTP → Selfie → ID document → **Blue Tick**, with badges and visibility boosts.
- **Build:** `verifications` table + a Verify wizard; reinforces the existing trust/ghost-risk story.

---

## 🥉 Tier 3 — Engagement / retention (cheap wins)

### 6. Shortlist / "Save for later" — Effort: S — ⬜
Save a profile without sending a formal escrow request.
- **Build:** `shortlists` table + heart/save on cards + a Shortlist tab.

### 7. "Who viewed me" (profile viewers) — Effort: S — ⬜
Record profile views and show a viewers list (keep it **free**, not hard-paywalled, per our ethos).
- **Build:** `profile_views` table + a Viewers list.

### 8. Lightweight "Like" soft signal — Effort: S — ⬜
A low-friction like distinct from the heavier escrow request, with mutual-like detection.

### 9. Notifications center + preferences — Effort: S–M — ⬜
A real notifications inbox (list, mark-read, per-type prefs) beyond the current alerts badge.

### 10. Typing indicator + online presence — Effort: S — ⬜
Add typing + presence via Supabase Realtime (we already have read receipts / unread).

---

## 🏅 Tier 4 — Structure & discovery polish

- **11. Structured Partner-Preferences editor** (age/height/religion/income/location-radius) — S–M — ⬜
- **12. "Today's Matches" (expiring daily picks) + "Near Me" radius selector** — S–M — ⬜
- **13. Dedicated Search page** (multi-filter + full-text) — M — ⬜
- **14. Settings: privacy controls + delete account** — S — ⬜

---

## 🛠️ Tier 5 — Ops (only when scaling)

- **15. Admin panel** (metrics, ban/suspend/reinstate, reports queue, health) — M–L — ⬜

---

## ⚠️ Deliberately excluded (conflicts with OpenMatch ethos)
- **Tiered subscriptions (Gold/Diamond/Platinum) + paywall gating** — clashes with our
  non-coercive micro-unlock model (see `claude.md`). Only the *daily request-cap* idea applies,
  which we already have.
- Semantic matching, icebreakers, compatibility summary, real-time chat, premium analytics — already shipped.

---

## Recommended port order
1. AI Chat Copilot (reply suggestions + chemistry) — **started**
2. Block & Report
3. AI Profile Builder variants
4. Shortlist + Who-viewed-me
5. Verification ladder
