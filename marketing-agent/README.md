# OpenMatch Marketing Agent

A **standalone** AI marketing automation agent for the [OpenMatch](../openmatch) app.
It is a separate project (own `package.json`, own git, own deploy) — it is **not**
a screen in the app and has no dependency on the mobile codebase. It talks to
the same Supabase backend so it can market the app and re-engage real users.

> Human-approval first: the agent **generates drafts** and **only publishes
> content a human has approved**. Nothing goes live automatically.

---

## What it does

| Command | What it does |
|---------|--------------|
| `generate` | LLM drafts on-brand posts/threads/emails/push into the review queue (`status=needs_review`). |
| `publish` | Publishes **approved** + due content via an aggregator (Postiz/Ayrshare). |
| `collect-metrics` | Pulls engagement into `marketing_metrics` (Phase 2 stub). |
| `lifecycle` | Drafts re-engagement push for dormant OpenMatch users. |

Every run is audit-logged to `marketing_agent_runs`.

---

## Setup

```bash
cd marketing-agent
npm install
cp .env.example .env      # fill in Supabase service-role key + OpenAI key
npm run db:push           # creates marketing_* tables (or prints SQL to paste)
```

Required env (see `.env.example`):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — same project as the app (server-side only)
- `OPENAI_API_KEY` (+ optional `OPENAI_MODEL`, default `gpt-4o-mini`)
- `MARKETING_AGGREGATOR_URL` / `_KEY` — optional; publish is a safe no-op until set
- `APP_STORE_URL` / `PLAY_STORE_URL` — injected into CTAs

---

## Usage

```bash
# Draft content (safe preview — no DB writes)
npm run generate:dry

# Draft for real → review queue
npm run generate

# Target specific channels / counts
npx tsx src/index.ts generate --channels instagram,reddit --count 3

# Approve content (until a UI exists, use SQL in Supabase):
#   update marketing_content set status='approved',
#     scheduled_at = now() + interval '1 hour' where id = '<id>';

# Publish approved + due content
npm run publish:dry     # preview
npm run publish         # for real (needs aggregator creds)

# Owned-audience re-engagement drafts
npm run lifecycle
```

---

## Content lifecycle

```
draft ─► needs_review ─►(human approve)─► approved ─► scheduled ─► published
                       └─────────────────► rejected           └─► failed
```

---

## Scheduling (run it on a server / cron)

```bash
npm run build   # -> dist/
# Example crontab:
#   0 9 * * 1  cd /path/marketing-agent && node dist/index.js generate
#   0 * * * *  cd /path/marketing-agent && node dist/index.js publish
```

Or containerize and run on any host (Fly.io, Railway, a small VPS, GitHub Actions cron).

---

## Publishing providers

Swap the single `publishViaAggregator()` function in `src/agent/publish.ts`:
- **Postiz** (open-source, self-host, free) — recommended start
- **Ayrshare** (hosted, paid) — simplest
- Direct platform APIs (Meta/X/LinkedIn/TikTok) later, for full control

---

## Making it a separate GitHub repo

This folder is self-contained. To split it out:

```bash
cd marketing-agent
git init
git add .
git commit -m "OpenMatch marketing agent"
git remote add origin git@github.com:<you>/openmatch-marketing-agent.git
git push -u origin main
```

(You can also physically move the folder anywhere — it has no path dependency
on the app.)

---

## Roadmap
- [x] Phase 2: real metrics + feedback loop (bias next content to what performs)
- [ ] Attribution (AppsFlyer/Adjust/Branch) so `installs` is real
- [ ] Optional review UI (small web app) instead of SQL approvals
- [ ] Image creatives from `image_prompt`
- [ ] Wire lifecycle drafts to Expo push / Resend email
- [ ] Phase 4: paid ads with hard budget caps

## Tests

```bash
npm test          # runs unit tests (safety check + analytics parsing) via node:test
```

> Note: the production runtime is the Supabase edge function
> `supabase/functions/marketing-agent/index.ts` (cron-driven, uses the shared
> Cisco/Azure LLM). This CLI is the local/manual twin that talks to the same
> `marketing_*` tables. The canonical schema is the backend migration
> `supabase/migrations/20260806000000_marketing_agent.sql`; `sql/schema.sql`
> here is a standalone mirror for `npm run db:push`.
