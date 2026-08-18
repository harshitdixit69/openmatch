# OpenMatch — AI Marketing Agent

> **Status:** Phase 0/1 scaffolded · **Owner:** Growth · **Last updated:** 2026-08-06
> An autonomous, human-supervised marketing worker that generates on-brand
> content, publishes it on a schedule, measures results, and runs
> owned-audience re-engagement — all inside the existing Supabase stack.

---

## 1. What it does (and doesn't)

| Capability | Phase | Auto or approved? |
|-----------|-------|-------------------|
| **Content generation** — writes posts/captions/threads/emails/push on-brand | ✅ 0 (built) | Drafts only → **human approval** |
| **Publishing** — posts approved + scheduled content to channels | ✅ 1 (built, needs aggregator creds) | Auto-publishes **approved** items |
| **Metrics collection** — pulls engagement back per post | ✅ 2 (built, needs aggregator creds) | Automatic |
| **Feedback loop** — biases next content toward what performed | ✅ 2 (built) | Automatic |
| **Lifecycle loops** — re-engagement push/email to dormant users | ✅ 3 (starter, built) | Drafts → **human approval** |
| **Paid ads** — Meta/Google campaign management | 🔜 4 (not built) | Approved + hard spend caps |

**Guardrail principle:** the agent **never publishes anything that a human
hasn't approved.** Generation always writes `status='needs_review'`.

---

## 2. Architecture

```
Supabase Cron ──► Edge Function: marketing-agent  ──► OpenAI/Cisco/Azure LLM
                        │                              (via _shared/azureChat.ts)
                        ├─ generate        → marketing_content (needs_review)
                        ├─ publish         → aggregator API (Postiz/Ayrshare) → channels
                        ├─ collect_metrics → marketing_metrics
                        └─ lifecycle       → marketing_content (push/email drafts)
                        │
                        └─ every run audit-logged → marketing_agent_runs

Human review: approve/reject rows in marketing_content (Supabase table UI or
a small screen in vip-portal-web).
```

- **Function:** `supabase/functions/marketing-agent/index.ts` (Deno, worker-auth, same pattern as `process-ghosting-followups`).
- **Schema:** `supabase/migrations/20260806000000_marketing_agent.sql`.
- **LLM:** reuses `_shared/azureChat.ts` (Cisco Enterprise AI preferred, Azure OpenAI fallback).

---

## 3. Database schema

| Table | Purpose |
|-------|---------|
| `marketing_brand_guide` | Brand voice, target audience, banned topics, default CTA — injected into every prompt. Seeded with one active row. |
| `marketing_campaigns` | Themed batch: goal, channels, status, optional budget. Seeded with one starter campaign. |
| `marketing_content` | **The review queue.** Every generated piece with `status` lifecycle: `draft → needs_review → approved → scheduled → published` (or `rejected`/`failed`). |
| `marketing_metrics` | Per-content engagement (impressions/clicks/installs…). |
| `marketing_agent_runs` | Audit log of every autonomous run (mode, counts, errors). |

**RLS:** enabled on all tables with **no public policies** → invisible to the
anon/authenticated client; only the service role (edge function/cron) can
read/write. Same safety model the security audit established.

### Content status lifecycle
```
draft ─► needs_review ─►(human)─► approved ─► scheduled ─► published
                       └────────► rejected            └─► failed (publish error)
```

---

## 4. Modes & how to call it

Invoke with a service-role bearer token (or `MARKETING_AGENT_SECRET`).

```bash
BASE="$SUPABASE_URL/functions/v1/marketing-agent"
AUTH="Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

# 1) Generate 2 drafts each for IG + Reddit + X (dry run = no DB writes)
curl -s -X POST "$BASE" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"mode":"generate","channels":["instagram","reddit","x"],"countPerChannel":2,"dryRun":true}'

# 2) Generate for real (writes needs_review rows)
curl -s -X POST "$BASE" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"mode":"generate"}'

# 3) Publish approved + due content (dry run first!)
curl -s -X POST "$BASE" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"mode":"publish","dryRun":true}'

# 4) Owned-audience re-engagement drafts
curl -s -X POST "$BASE" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"mode":"lifecycle"}'
```

**Payload options:** `mode` · `dryRun` · `campaignId` · `channels[]` · `countPerChannel` (1–5).

### Approving content
Use the admin review queue in `vip-portal-web` at **`/dashboard/marketing`**
(tabs for needs-review/approved/scheduled/published/rejected/failed; each card
has approve/reject/edit + an optional schedule time). Requires a signed-in user
with `profiles.is_admin = true` and `SUPABASE_SERVICE_ROLE_KEY` set in the web
app env.

Or, as a fallback, approve directly in SQL:
```sql
update public.marketing_content
set status = 'approved', scheduled_at = now() + interval '1 hour'
where id = '<content-id>';
```

---

## 5. Environment variables / secrets

Set via `supabase secrets set KEY=value`.

| Secret | Required | Purpose |
|--------|----------|---------|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Standard (already set for other functions). |
| `MARKETING_AGENT_SECRET` | recommended | Extra worker token for cron auth (falls back to `INTENT_ESCROW_CRON_SECRET`). |
| One LLM provider — **Cisco** (`CISCO_CLIENT_ID`/`CISCO_CLIENT_SECRET`…) **or Azure** (`AZURE_OPENAI_API_KEY`/`AZURE_OPENAI_ENDPOINT`/`AZURE_OPENAI_CHAT_DEPLOYMENT`) | ✅ | Content generation. Same as other AI functions. |
| `MARKETING_AGGREGATOR_URL`, `MARKETING_AGGREGATOR_KEY` | for publishing | Postiz/Ayrshare endpoint + key. Until set, `publish` is a safe no-op. |

---

## 6. Deploy & schedule

```bash
# Apply schema (staging first!)
supabase db push

# Deploy the function
supabase functions deploy marketing-agent

# Schedule with pg_cron (example: generate weekly, publish hourly)
select cron.schedule('marketing-generate-weekly', '0 9 * * 1',
  $$ select net.http_post(
       url:='https://<ref>.functions.supabase.co/marketing-agent',
       headers:='{"Authorization":"Bearer <MARKETING_AGENT_SECRET>","Content-Type":"application/json"}'::jsonb,
       body:='{"mode":"generate"}'::jsonb) $$);

select cron.schedule('marketing-publish-hourly', '0 * * * *',
  $$ select net.http_post(
       url:='https://<ref>.functions.supabase.co/marketing-agent',
       headers:='{"Authorization":"Bearer <MARKETING_AGENT_SECRET>","Content-Type":"application/json"}'::jsonb,
       body:='{"mode":"publish"}'::jsonb) $$);
```

---

## 7. Choosing a publishing path

| Option | Effort | Notes |
|--------|--------|-------|
| **Postiz** (open-source, self-host) | 🟢 Low | Recommended start. One API → many channels. Free. |
| **Ayrshare** (hosted) | 🟢 Low | Simplest, paid tiers. Swap the adapter URL/key. |
| **Direct platform APIs** (Meta/X/LinkedIn/TikTok) | 🔴 High | Each needs a dev app + review (days–weeks). Do later for control. |

The publish adapter lives in `publishViaAggregator()` — swap that one function
to change providers.

---

## 8. Roadmap / TODO

- [x] **Phase 2 — metrics loop:** `collect_metrics` pulls per-post engagement
      from the aggregator's `/posts/{id}/analytics` endpoint, appends snapshots
      to `marketing_metrics`, and `generate` now feeds the top-performing bodies
      per channel back into the prompt (`fetchTopPerformers`). Real numbers need
      `MARKETING_AGGREGATOR_URL/KEY`; until then it's a safe no-op.
- [ ] **Attribution:** wire AppsFlyer/Adjust/Branch (or Meta/Google) so
      `installs` in `marketing_metrics` is real, not zero.
- [x] **Review UI:** admin-gated review queue at `vip-portal-web`
      `/dashboard/marketing` (approve/reject/edit/schedule) backed by
      `/api/marketing/content` — no more SQL approvals. Requires
      `SUPABASE_SERVICE_ROLE_KEY` in the web app env and `profiles.is_admin=true`.
- [ ] **Creatives:** generate images (OpenAI images / Bannerbear) from
      `image_prompt` and attach `image_url`.
- [ ] **Phase 3 lifecycle:** connect drafted push/email to Expo push + Resend.
- [ ] **Phase 4 paid ads:** Meta/Google campaign tools with hard `budget_cents`
      caps and mandatory human approval.
- [x] **Tests:** unit tests for `runSafetyCheck` (synonym matching, no false
      positives) + analytics parsing live in `marketing-agent/src/**/*.test.ts`
      (`npm test`).

---

## 9. Safety notes (matrimonial = sensitive)

- Banned topics (caste, dowry, colourism, guaranteed-marriage claims) are
  injected into every prompt **and** re-checked post-generation via
  `runSafetyCheck()`. Flagged items are marked and still require human review.
- Nothing is user-facing without approval. Lifecycle push/email are drafts only.
- All autonomous actions are logged to `marketing_agent_runs` for audit.
