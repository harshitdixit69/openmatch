// ---------------------------------------------------------------------------
// cleanupMockUsers.mjs — delete users created by seedMockUsers.mjs
//
// Seeded accounts use emails like "...@mock.<random>.test". This script finds
// every auth user whose email contains ".test" AND "mock." and deletes them.
// Deleting the auth user cascades to profiles / related rows (see the
// add_fk_cascades migration).
//
// USAGE:
//   export SUPABASE_URL="https://<ref>.supabase.co"
//   export SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"
//   node ./scripts/cleanupMockUsers.mjs           # dry run (lists only)
//   node ./scripts/cleanupMockUsers.mjs --delete   # actually delete
// ---------------------------------------------------------------------------
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
    process.exit(1);
}

const DELETE = process.argv.includes('--delete');
const PER_PAGE = 200;

// A user is considered "mock" only if BOTH markers are present, to avoid ever
// touching a real account.
function isMockEmail(email) {
    if (!email) return false;
    const e = email.toLowerCase();
    return e.includes('mock.') && e.endsWith('.test');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
    console.log(DELETE ? '⚠️  DELETE mode' : 'ℹ️  Dry run (pass --delete to remove). ');

    const mockUsers = [];
    let page = 1;

    // Paginate through all auth users.
    for (;;) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PER_PAGE });
        if (error) {
            console.error('listUsers failed:', error.message);
            process.exit(1);
        }
        const users = data?.users ?? [];
        if (users.length === 0) break;

        for (const u of users) {
            if (isMockEmail(u.email)) mockUsers.push({ id: u.id, email: u.email });
        }
        if (users.length < PER_PAGE) break;
        page += 1;
    }

    console.log(`Found ${mockUsers.length} mock user(s).`);
    if (mockUsers.length === 0) return;

    // Show a sample so you can sanity-check before deleting.
    for (const u of mockUsers.slice(0, 10)) console.log('  -', u.email);
    if (mockUsers.length > 10) console.log(`  ... and ${mockUsers.length - 10} more`);

    if (!DELETE) {
        console.log('\nDry run only. Re-run with --delete to remove these users.');
        return;
    }

    let ok = 0;
    let failed = 0;
    for (const u of mockUsers) {
        const { error } = await supabase.auth.admin.deleteUser(u.id);
        if (error) {
            failed += 1;
            console.error(`Failed to delete ${u.email}: ${error.message}`);
        } else {
            ok += 1;
        }
    }
    console.log(`\nDone. Deleted ${ok}, failed ${failed}.`);
}

main().catch((error) => {
    console.error('Cleanup crashed:', error);
    process.exit(1);
});
