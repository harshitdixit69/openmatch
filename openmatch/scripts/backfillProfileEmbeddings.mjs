import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const profileId = process.env.PROFILE_ID ?? null;
const rawLimit = process.env.BACKFILL_LIMIT ?? '50';
const explicitFunctionUrl = process.env.GENERATE_PROFILE_EMBEDDING_URL;
const dryRun = /^(1|true|yes)$/i.test(process.env.DRY_RUN ?? '');

if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
}

const limit = Number.parseInt(rawLimit, 10);
if (!Number.isFinite(limit) || limit < 1) {
    throw new Error('BACKFILL_LIMIT must be a positive integer.');
}

const functionUrl = explicitFunctionUrl ?? deriveFunctionUrl(supabaseUrl);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
});

let query = supabase
    .from('profiles')
    .select('id, bio, preferences, location, profile_owner')
    .is('embedding', null)
    .order('created_at', { ascending: true });

if (profileId) {
    query = query.eq('id', profileId).limit(1);
} else {
    query = query.limit(limit);
}

const { data, error } = await query;

if (error) {
    throw error;
}

const profiles = data ?? [];
const candidates = profiles.filter((profile) => hasEmbeddingInput(profile));
const skippedCount = profiles.length - candidates.length;

console.log(`Found ${profiles.length} profile(s) with null embeddings.`);
console.log(`Eligible for backfill: ${candidates.length}. Skipped for empty input: ${skippedCount}.`);
console.log(`Embedding function URL: ${functionUrl}`);

if (profiles.length === 0) {
    process.exit(0);
}

if (dryRun) {
    console.log('Dry run enabled. No edge function requests were sent.');
    process.exit(0);
}

let successCount = 0;
let failureCount = 0;

for (const [index, profile] of candidates.entries()) {
    const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            type: 'INSERT',
            record: profile,
        }),
    });

    const responseText = await response.text();
    const label = `[${index + 1}/${candidates.length}] ${profile.id}`;

    if (!response.ok) {
        failureCount += 1;
        console.error(`${label} failed with HTTP ${response.status}: ${responseText}`);
        continue;
    }

    try {
        const payload = JSON.parse(responseText);
        if (payload?.error) {
            failureCount += 1;
            console.error(`${label} failed: ${payload.error}`);
            continue;
        }
    } catch {
        // Non-JSON success responses are still acceptable here.
    }

    successCount += 1;
    console.log(`${label} backfilled successfully.`);
}

console.log(`Backfill complete. Success: ${successCount}. Failed: ${failureCount}. Skipped: ${skippedCount}.`);

if (failureCount > 0) {
    process.exitCode = 1;
}

function hasEmbeddingInput(profile) {
    return buildEmbeddingSource(profile).trim().length > 0;
}

function buildEmbeddingSource(profile) {
    return [profile.bio, profile.preferences, profile.location, profile.profile_owner]
        .map((part) => (part ?? '').trim())
        .filter(Boolean)
        .join('\n');
}

function deriveFunctionUrl(url) {
    const projectRef = new URL(url).hostname.split('.')[0];
    return `https://${projectRef}.functions.supabase.co/generate-profile-embedding`;
}