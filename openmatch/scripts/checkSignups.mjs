// ---------------------------------------------------------------------------
// checkSignups.mjs — see who has actually signed up (excluding seeded mocks)
//
// USAGE (env vars already set in your shell):
//   export SUPABASE_URL="https://<ref>.supabase.co"
//   export SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"
//   node ./scripts/checkSignups.mjs
// ---------------------------------------------------------------------------
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

const isMock = (email) => {
    if (!email) return true; // no email = phone/anon test artifact
    const e = email.toLowerCase();
    // Seeded users + all the dev/test/QA artifacts this project generates.
    return (
        (e.includes('mock.') && e.endsWith('.test')) ||
        e.endsWith('@example.com') ||
        e.includes('@mock-phone-auth') ||
        /^(phase\d|stripetest|test[-_]|sla-|profile-save|test-review|test-block|test-ghostwriter|test-concierge|test_spotlight|test_rpc)/.test(e)
    );
};

function ago(dateStr) {
    if (!dateStr) return 'unknown';
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

async function main() {
    // Pull all auth users (paginated).
    const all = [];
    for (let page = 1; ; page += 1) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
        if (error) { console.error('listUsers failed:', error.message); process.exit(1); }
        const users = data?.users ?? [];
        if (users.length === 0) break;
        all.push(...users);
        if (users.length < 200) break;
    }

    const real = all.filter((u) => !isMock(u.email));
    const mocks = all.filter((u) => isMock(u.email));

    console.log('==================================================');
    console.log(`Total auth users : ${all.length}`);
    console.log(`Seeded mock users: ${mocks.length}`);
    console.log(`REAL users       : ${real.length}`);
    console.log('==================================================\n');

    if (real.length === 0) {
        console.log('No real signups yet. Share your link and re-run this. 🚀');
        return;
    }

    // Sort newest first.
    real.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    console.log('Real signups (newest first):');
    for (const u of real) {
        const confirmed = u.email_confirmed_at ? '✓ confirmed' : '… unconfirmed';
        const lastSeen = u.last_sign_in_at ? `last active ${ago(u.last_sign_in_at)}` : 'never signed in again';
        console.log(`  • ${u.email ?? '(no email)'}  —  joined ${ago(u.created_at)}  |  ${confirmed}  |  ${lastSeen}`);
    }

    // How many completed onboarding? (profiles with onboarding_completed_at)
    const realIds = real.map((u) => u.id);
    const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, full_name, onboarding_completed_at')
        .in('id', realIds);

    if (!pErr && profiles) {
        const completed = profiles.filter((p) => p.onboarding_completed_at).length;
        console.log(`\nProfiles created   : ${profiles.length}/${real.length}`);
        console.log(`Onboarding complete: ${completed}/${real.length}`);
    }

    // Signups in the last 24h / 7d.
    const now = Date.now();
    const last24h = real.filter((u) => now - new Date(u.created_at).getTime() < 864e5).length;
    const last7d = real.filter((u) => now - new Date(u.created_at).getTime() < 6048e5).length;
    console.log(`\nNew in last 24h    : ${last24h}`);
    console.log(`New in last 7 days : ${last7d}`);
    console.log(`\nGoal progress      : ${real.length}/100 real users`);
}

main().catch((e) => { console.error('crashed:', e); process.exit(1); });
