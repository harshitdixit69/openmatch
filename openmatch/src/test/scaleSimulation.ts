/**
 * scaleSimulation.ts
 * -----------------------------------------------------------------------------
 * Load & scenario simulation for the OpenMatch HomeScreen workflows.
 *
 * It replicates 1,000 concurrent virtual users acting out three behaviour
 * personas plus injected edge cases (latency spikes + in-flight cancellations),
 * driving the SAME backend endpoints the real app uses:
 *
 *   - RPC          `match_profiles`               (feed)
 *   - Edge fn      `generate-fit-friction-breakdown` (compatibility, primary)
 *   - Edge fn      `generate-compatibility-summary`  (compatibility, fallback)
 *   - Edge fn      `manage-match-request`            (right-swipe / interest)
 *   - Table        `profile_contact_details`         (contact upsert)
 *   - Table        `profiles.photo_urls`             (photo curation)
 *
 * IMPORTANT accuracy note:
 *   In the real app a LEFT swipe (`recordPassedProfile`) writes to on-device
 *   AsyncStorage only — it does NOT hit the database. So DB write contention
 *   from "fast swipers" is dominated by RIGHT swipes (manage-match-request) and
 *   repeated feed fetches. This script models that faithfully: left swipes are
 *   counted as local no-ops, right swipes hit the edge function.
 *
 * -----------------------------------------------------------------------------
 * PREREQUISITES
 *   1. A pool of pre-seeded, confirmed test users (email + password) that can
 *      sign in with the anon key. Provide them via SIM_USERS_JSON (see below)
 *      or let the script derive them from a pattern.
 *   2. Env vars:
 *        EXPO_PUBLIC_SUPABASE_URL
 *        EXPO_PUBLIC_SUPABASE_ANON_KEY
 *      Optional:
 *        SIM_USER_COUNT           (default 1000)
 *        SIM_CONCURRENCY          (default 100  — real parallel workers)
 *        SIM_USER_EMAIL_PATTERN   (default "loadtest+{i}@openmatch.test")
 *        SIM_USER_PASSWORD        (default "LoadTest123!")
 *        SIM_USERS_JSON           (path to JSON: [{ "email", "password" }, ...])
 *        SIM_INJECT_LATENCY       ("true" to add random 100-3000ms delays)
 *        SIM_INJECT_CANCELLATION  ("true" to abort ~10% of requests mid-flight)
 *
 * RUN
 *   npx tsx openmatch/src/test/scaleSimulation.ts
 *   # or: npx ts-node --transpile-only openmatch/src/test/scaleSimulation.ts
 *
 * ⚠️  Run against a STAGING project, never production. This creates real rows.
 * -----------------------------------------------------------------------------
 */

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('❌ Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY.');
    process.exit(1);
}

const USER_COUNT = Number(process.env.SIM_USER_COUNT ?? 1000);
// Real OS/Node sockets and the DB pooler cannot sustain 1000 truly-parallel
// connections. We run USER_COUNT virtual users through a bounded worker pool.
const CONCURRENCY = Number(process.env.SIM_CONCURRENCY ?? 100);
const EMAIL_PATTERN = process.env.SIM_USER_EMAIL_PATTERN ?? 'loadtest+{i}@openmatch.test';
const PASSWORD = process.env.SIM_USER_PASSWORD ?? 'LoadTest123!';
const INJECT_LATENCY = process.env.SIM_INJECT_LATENCY === 'true';
const INJECT_CANCELLATION = process.env.SIM_INJECT_CANCELLATION === 'true';

type SimUser = { email: string; password: string };

function loadUserPool(): SimUser[] {
    const jsonPath = process.env.SIM_USERS_JSON;
    if (jsonPath) {
        const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as SimUser[];
        return parsed.slice(0, USER_COUNT);
    }

    return Array.from({ length: USER_COUNT }, (_, i) => ({
        email: EMAIL_PATTERN.replace('{i}', String(i + 1)),
        password: PASSWORD,
    }));
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

type OpName =
    | 'auth'
    | 'feed'
    | 'swipe_left_local'
    | 'swipe_right_interest'
    | 'photo_update'
    | 'contact_upsert'
    | 'contact_validation_block'
    | 'search_local'
    | 'compatibility'
    | 'interest_message'
    | 'cancelled';

const latencies: Record<string, number[]> = {};
const successCounts: Record<string, number> = {};
const failureCounts: Record<string, number> = {};
const errorSamples: Record<string, string> = {};

function recordSuccess(op: OpName, ms: number) {
    (latencies[op] ??= []).push(ms);
    successCounts[op] = (successCounts[op] ?? 0) + 1;
}

function recordFailure(op: OpName, error: unknown) {
    failureCounts[op] = (failureCounts[op] ?? 0) + 1;
    const message = error instanceof Error ? error.message : String(error);
    if (!errorSamples[`${op}:${message}`]) {
        errorSamples[`${op}:${message}`] = message;
    }
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[index];
}

// ---------------------------------------------------------------------------
// Helpers: latency injection + cancellation
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (min: number, max: number) => Math.floor(min + Math.random() * (max - min));

async function maybeInjectLatency() {
    if (INJECT_LATENCY) {
        await sleep(jitter(100, 3000));
    }
}

class CancelledError extends Error {
    constructor() {
        super('Operation cancelled mid-flight (user left / logged out)');
        this.name = 'CancelledError';
    }
}

/**
 * Wraps an async op with metrics, optional pre-latency, and a ~10% chance of
 * being "cancelled" — the underlying promise still runs (mirroring a real
 * fire-and-forget abandonment) but the result is discarded and counted.
 */
async function instrument<T>(op: OpName, fn: () => Promise<T>): Promise<T | undefined> {
    await maybeInjectLatency();

    const shouldCancel = INJECT_CANCELLATION && Math.random() < 0.1;
    const start = performance.now();

    if (shouldCancel) {
        // Kick off the work but race it against an abandonment timer.
        const work = fn().catch(() => undefined);
        const abandonMs = jitter(20, 400);
        const outcome = await Promise.race([
            work.then(() => 'done' as const),
            sleep(abandonMs).then(() => 'cancelled' as const),
        ]);

        if (outcome === 'cancelled') {
            recordFailure('cancelled', new CancelledError());
            void work; // let it settle in the background
            return undefined;
        }

        recordSuccess(op, performance.now() - start);
        return work;
    }

    try {
        const result = await fn();
        recordSuccess(op, performance.now() - start);
        return result;
    } catch (error) {
        recordFailure(op, error);
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Frontend validation mirror (Persona B must reproduce HomeScreen's guard)
// ---------------------------------------------------------------------------

function validateContactNumber(rawValue: string): string | null {
    const trimmed = rawValue.trim();
    if (!trimmed) return null;
    const cleaned = trimmed.replace(/[\s\-().]/g, '');
    if (!/^\+?\d{8,15}$/.test(cleaned)) {
        return 'invalid';
    }
    return null;
}

// ---------------------------------------------------------------------------
// Endpoint calls (mirror the real lib/* functions)
// ---------------------------------------------------------------------------

async function fetchFeed(client: SupabaseClient): Promise<{ id: string }[]> {
    const { data, error } = await client.rpc('match_profiles', { result_limit: 20 });
    if (error) throw error;
    return (Array.isArray(data) ? data : []).filter(
        (row): row is { id: string } => Boolean(row && typeof row === 'object' && 'id' in row),
    );
}

async function sendInterest(client: SupabaseClient, candidateProfileId: string, message?: string) {
    const { error } = await client.functions.invoke('manage-match-request', {
        body: { action: 'send', candidateProfileId, messageContent: message?.trim() || undefined },
    });
    if (error) throw error;
}

async function fetchCompatibility(client: SupabaseClient, candidateProfileId: string) {
    // Primary path: fit/friction breakdown. On failure, fall back to summary —
    // exactly like HomeScreen.openCompatibility().
    const primary = await client.functions.invoke('generate-fit-friction-breakdown', {
        body: { candidateProfileId },
    });
    if (!primary.error) return;

    const fallback = await client.functions.invoke('generate-compatibility-summary', {
        body: { candidateProfileId },
    });
    if (fallback.error) throw fallback.error;
}

async function updatePhotoUrls(client: SupabaseClient, userId: string, photoUrls: string[]) {
    const { error } = await client.from('profiles').update({ photo_urls: photoUrls }).eq('id', userId);
    if (error) throw error;
}

async function upsertContactDetails(
    client: SupabaseClient,
    userId: string,
    phone: string,
    whatsapp: string,
) {
    const { error } = await client.from('profile_contact_details').upsert({
        profile_id: userId,
        phone_number: phone.trim() || null,
        whatsapp_number: whatsapp.trim() || null,
        updated_at: new Date().toISOString(),
    });
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

async function runFastSwiper(client: SupabaseClient, userId: string) {
    // Fetch feed, then rapidly swipe every ~300ms. ~85% left (local no-op),
    // ~15% right (real interest write) — models true DB contention.
    const feed = await instrument('feed', () => fetchFeed(client));
    if (!feed || feed.length === 0) return;

    for (const candidate of feed.slice(0, 12)) {
        await sleep(jitter(200, 400));
        const isRight = Math.random() < 0.15;
        if (isRight) {
            await instrument('swipe_right_interest', () => sendInterest(client, candidate.id));
        } else {
            // Local AsyncStorage write in the real app — no network. Counted only.
            recordSuccess('swipe_left_local', 0);
        }
    }
}

async function runAccountCurator(client: SupabaseClient, userId: string) {
    // 1. Update photo array (add + reorder).
    const base = `https://example.test/${userId}`;
    await instrument('photo_update', () => updatePhotoUrls(client, userId, [`${base}/a.jpg`, `${base}/b.jpg`]));
    await instrument('photo_update', () => updatePhotoUrls(client, userId, [`${base}/b.jpg`, `${base}/a.jpg`]));

    // 2. Valid contact save.
    const validPhone = `+9198765${String(Math.floor(Math.random() * 90000) + 10000)}`;
    await instrument('contact_upsert', () => upsertContactDetails(client, userId, validPhone, validPhone));

    // 3. Intentionally invalid formats — the frontend guard must block these
    //    BEFORE any DB write. We assert the guard, and only hit the DB if it
    //    (incorrectly) passes, which would be a regression.
    const invalidInputs = ['12', 'abcmynumber', '+++999', '98765 43210 9999 8888 7777'];
    for (const bad of invalidInputs) {
        if (validateContactNumber(bad) === 'invalid') {
            recordSuccess('contact_validation_block', 0); // guard held ✅
        } else {
            // Guard failed to catch it — this is the regression we're hunting.
            await instrument('contact_upsert', () => upsertContactDetails(client, userId, bad, bad));
            recordFailure('contact_validation_block', new Error(`Validation let through: "${bad}"`));
        }
    }
}

async function runDeepReviewer(client: SupabaseClient, userId: string) {
    const feed = await instrument('feed', () => fetchFeed(client));
    if (!feed || feed.length === 0) return;

    // Local search filtering happens client-side over the fetched feed (exactly
    // how HomeScreen.visibleCandidates works) — measured as a local op.
    const queries = ['delhi', 'engineer', 'travel', 'music', 'zzznomatch'];
    for (const q of queries) {
        const start = performance.now();
        feed.filter(() => q.length >= 0); // stand-in for name/city/bio includes()
        recordSuccess('search_local', performance.now() - start);
    }

    // Open compatibility sheets for the first few candidates (AI edge fns).
    for (const candidate of feed.slice(0, 3)) {
        await instrument('compatibility', () => fetchCompatibility(client, candidate.id));
    }

    // Send an interest with a custom message.
    await instrument('interest_message', () =>
        sendInterest(client, feed[0].id, 'Loved your profile — would love to connect!'),
    );
}

// ---------------------------------------------------------------------------
// Per-user session lifecycle
// ---------------------------------------------------------------------------

function personaForIndex(index: number): 'A' | 'B' | 'C' {
    const bucket = index % 10;
    if (bucket < 6) return 'A'; // 60%
    if (bucket < 8) return 'B'; // 20%
    return 'C'; // 20%
}

async function runVirtualUser(user: SimUser, index: number) {
    // Each virtual user gets an isolated client (no shared session storage).
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const authResult = await instrument('auth', async () => {
        const { data, error } = await client.auth.signInWithPassword({
            email: user.email,
            password: user.password,
        });
        if (error) throw error;
        if (!data.user) throw new Error('No user returned from sign-in.');
        return data.user;
    });

    if (!authResult) {
        return; // auth failed/cancelled — metrics already recorded.
    }

    const userId = authResult.id;

    try {
        switch (personaForIndex(index)) {
            case 'A':
                await runFastSwiper(client, userId);
                break;
            case 'B':
                await runAccountCurator(client, userId);
                break;
            case 'C':
                await runDeepReviewer(client, userId);
                break;
        }
    } finally {
        // Simulate the user leaving / logging out (also frees the session).
        await client.auth.signOut().catch(() => undefined);
    }
}

// ---------------------------------------------------------------------------
// Bounded worker pool
// ---------------------------------------------------------------------------

async function runPool(users: SimUser[]) {
    let cursor = 0;

    async function worker() {
        while (cursor < users.length) {
            const index = cursor++;
            await runVirtualUser(users[index], index);
        }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, users.length) }, () => worker());
    await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printSummary(wallClockMs: number) {
    const ops = Object.keys({ ...successCounts, ...failureCounts }).sort();

    console.log('\n📊 ===== SCALE SIMULATION SUMMARY =====');
    console.log(`Virtual users        : ${USER_COUNT}`);
    console.log(`Worker concurrency   : ${CONCURRENCY}`);
    console.log(`Latency injection    : ${INJECT_LATENCY ? 'ON (100-3000ms)' : 'off'}`);
    console.log(`Cancellation inject  : ${INJECT_CANCELLATION ? 'ON (~10%)' : 'off'}`);
    console.log(`Total wall-clock     : ${(wallClockMs / 1000).toFixed(1)}s`);

    console.log('\nOperation                 |   OK |  FAIL |   p50 |   p95 |   p99  (ms)');
    console.log('--------------------------|------|-------|-------|-------|-------');
    for (const op of ops) {
        const ok = successCounts[op] ?? 0;
        const fail = failureCounts[op] ?? 0;
        const l = latencies[op] ?? [];
        const p50 = percentile(l, 50).toFixed(0).padStart(5);
        const p95 = percentile(l, 95).toFixed(0).padStart(5);
        const p99 = percentile(l, 99).toFixed(0).padStart(5);
        console.log(
            `${op.padEnd(25)} | ${String(ok).padStart(4)} | ${String(fail).padStart(5)} | ${p50} | ${p95} | ${p99}`,
        );
    }

    const totalOk = Object.values(successCounts).reduce((a, b) => a + b, 0);
    const totalFail = Object.values(failureCounts).reduce((a, b) => a + b, 0);
    const rate = totalOk + totalFail > 0 ? ((totalOk / (totalOk + totalFail)) * 100).toFixed(2) : '0';
    console.log(`\nOverall success rate : ${rate}%  (${totalOk} ok / ${totalFail} failed)`);

    const validationBlocks = successCounts['contact_validation_block'] ?? 0;
    const validationLeaks = failureCounts['contact_validation_block'] ?? 0;
    console.log(
        `Contact validation   : ${validationBlocks} blocked ✅ / ${validationLeaks} leaked ${
            validationLeaks > 0 ? '❌ REGRESSION' : '✅'
        }`,
    );

    const uniqueErrors = Object.values(errorSamples);
    if (uniqueErrors.length > 0) {
        console.log('\n❌ Distinct error samples (top 12):');
        uniqueErrors.slice(0, 12).forEach((message) => console.log(`  - ${message}`));
    }
    console.log('======================================\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
    const users = loadUserPool();
    console.log(`🚀 Starting scale simulation: ${users.length} users, concurrency ${CONCURRENCY}...`);
    console.log('   Persona mix → A Fast Swiper 60% | B Curator 20% | C Deep Reviewer 20%');

    const start = performance.now();
    await runPool(users);
    printSummary(performance.now() - start);
}

main().catch((error) => {
    console.error('Fatal simulation error:', error);
    process.exit(1);
});
