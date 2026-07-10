# Scale Simulation — Run Guide

Load & scenario simulator for the OpenMatch HomeScreen workflows.
Script: [`scaleSimulation.ts`](./scaleSimulation.ts)

> ⚠️ **Run against a STAGING Supabase project, never production.**
> It writes real rows (`interest_requests`, `profile_contact_details`, `profiles.photo_urls`)
> and invokes real (billable) AI edge functions.

---

## 1. What it simulates

1,000 concurrent virtual users (configurable) through a bounded worker pool, in a **60/20/20** persona mix:

| Persona | % | Hits |
|---|---|---|
| **A – Fast Swiper** | 60% | `match_profiles` feed → swipes (~85% left = local no-op, ~15% right = `manage-match-request`) |
| **B – Account Curator** | 20% | `profiles.photo_urls` add+reorder, valid `profile_contact_details` upsert, 4 invalid phone formats (must be blocked by the mirrored `validateContactNumber` guard) |
| **C – Deep Reviewer** | 20% | feed → local search → `generate-fit-friction-breakdown` (fallback `generate-compatibility-summary`) → interest with message |

Edge cases: latency spikes (100–3000ms) and ~10% in-flight cancellations.

---

## 2. One-time prerequisites

### a) Install the TypeScript runner
```bash
cd openmatch
npm i -D tsx          # preferred
# or: npm i -D ts-node
```

### b) Seed confirmed test users
The script signs in with the **anon key**, so the users must already exist and be email-confirmed.

Provide them one of two ways:
- **Pattern (default):** emails `loadtest+1@openmatch.test` … `loadtest+1000@openmatch.test`, password `LoadTest123!`.
- **Explicit file:** set `SIM_USERS_JSON=/abs/path/users.json` where the file is:
  ```json
  [{ "email": "a@x.test", "password": "..." }, { "email": "b@x.test", "password": "..." }]
  ```

> If users aren't seeded, every `auth` op fails — the report will show that clearly (not a crash).
> Ask the assistant to generate `seedTestUsers.ts` (service-role) if you want automated provisioning.

---

## 3. Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | ✅ | — | Supabase project URL (staging) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | ✅ | — | Anon key |
| `SIM_USER_COUNT` | — | `1000` | Number of virtual users |
| `SIM_CONCURRENCY` | — | `100` | Real parallel workers |
| `SIM_USER_EMAIL_PATTERN` | — | `loadtest+{i}@openmatch.test` | Email pattern (`{i}` = 1-based) |
| `SIM_USER_PASSWORD` | — | `LoadTest123!` | Shared test password |
| `SIM_USERS_JSON` | — | — | Path to explicit user list (overrides pattern) |
| `SIM_INJECT_LATENCY` | — | `false` | `true` = random 100–3000ms delays |
| `SIM_INJECT_CANCELLATION` | — | `false` | `true` = abandon ~10% of ops mid-flight |

---

## 4. Commands

### Smoke test first (always start small)
```bash
cd openmatch
export EXPO_PUBLIC_SUPABASE_URL="https://YOUR-STAGING.supabase.co"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="YOUR_ANON_KEY"
export SIM_USER_COUNT=50
export SIM_CONCURRENCY=10
npx tsx src/test/scaleSimulation.ts
```

### Full 1,000-user run
```bash
cd openmatch
export EXPO_PUBLIC_SUPABASE_URL="https://YOUR-STAGING.supabase.co"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="YOUR_ANON_KEY"
export SIM_USER_COUNT=1000
export SIM_CONCURRENCY=100
npx tsx src/test/scaleSimulation.ts
```

### Full run with edge cases (latency + cancellation)
```bash
cd openmatch
export EXPO_PUBLIC_SUPABASE_URL="https://YOUR-STAGING.supabase.co"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="YOUR_ANON_KEY"
export SIM_USER_COUNT=1000
export SIM_CONCURRENCY=100
export SIM_INJECT_LATENCY=true
export SIM_INJECT_CANCELLATION=true
npx tsx src/test/scaleSimulation.ts
```

### Using an explicit user list
```bash
export SIM_USERS_JSON="/absolute/path/to/users.json"
npx tsx src/test/scaleSimulation.ts
```

### One-liner (no persistent exports)
```bash
cd openmatch && EXPO_PUBLIC_SUPABASE_URL="..." EXPO_PUBLIC_SUPABASE_ANON_KEY="..." \
SIM_USER_COUNT=200 SIM_CONCURRENCY=40 npx tsx src/test/scaleSimulation.ts
```

### Fallback runner (if `tsx` unavailable)
```bash
npx ts-node --transpile-only src/test/scaleSimulation.ts
```

### Optional: add an npm script
In `openmatch/package.json` under `"scripts"`:
```json
"loadtest": "tsx src/test/scaleSimulation.ts"
```
then: `npm run loadtest`

---

## 5. Reading the report

```
Operation                 |   OK |  FAIL |   p50 |   p95 |   p99  (ms)
```
- **feed / swipe_right_interest / compatibility / contact_upsert / photo_update** → real network ops; watch p95/p99.
- **swipe_left_local / search_local** → local ops (near 0ms) — mirror the app's on-device work.
- **contact_validation_block** → `blocked ✅` count vs `leaked ❌ REGRESSION`. Any leak means an invalid number reached the DB (bug).
- **cancelled** → count of abandoned in-flight ops (only when `SIM_INJECT_CANCELLATION=true`).

---

## 6. Things to watch for at scale (backend health)

1. **pgvector index** — ensure an `hnsw`/`ivfflat` index on the profile embedding column, or `match_profiles` does full scans under load and DB CPU spikes.
2. **Realtime/connection limits** — Supabase pooler + Realtime have concurrency caps (esp. free tier). If `feed`/`auth` failures spike, you've hit them. Lower `SIM_CONCURRENCY`.
3. **Edge-function cold starts / rate limits** — `generate-*` functions may throttle; p99 on `compatibility` will reveal it.
4. **Cost** — 1,000 users × AI edge calls is real spend. Scale `SIM_USER_COUNT` up gradually (50 → 200 → 1000).

---

## 7. Known gotchas / FAQ

- **`Missing Supabase environment variables`** → export the two `EXPO_PUBLIC_*` vars in the *same* shell.
- **All `auth` failed** → test users not seeded/confirmed, or wrong password/pattern.
- **`npx run web` fails** → unrelated; that's an invalid command. This script uses `npx tsx`, not the Expo dev server.
- **Don't run in the app bundle** → this is a **Node** script (uses `node:fs`, `node:perf_hooks`); it is not imported by the React Native app and won't ship in the build.
- **Cleanup** → seeded rows/interests remain in staging after a run; truncate or reset staging tables periodically.
