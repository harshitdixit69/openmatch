import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

function parseEnvFile(text) {
    return Object.fromEntries(
        text
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => {
                const separatorIndex = line.indexOf('=');
                return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
            }),
    );
}

async function main() {
    console.log('==> Starting Step 1: User Block & Report Verification...');
    const env = parseEnvFile(await readFile(new URL('../.env', import.meta.url), 'utf8'));
    const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing URL or Anon key in .env file.');
    }

    const adminClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const emailA = `test-block-A-${Date.now()}@example.com`;
    const emailB = `test-block-B-${Date.now()}@example.com`;
    const password = 'TestBlockUser!123';

    // 1. Sign up User A
    console.log('==> Signing up User A:', emailA);
    const signUpA = await adminClient.auth.signUp({ email: emailA, password });
    if (signUpA.error) throw signUpA.error;
    const sessionA = signUpA.data.session;
    const userA = signUpA.data.user;

    const clientA = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${sessionA.access_token}` } }
    });

    console.log('==> Creating Profile for User A...');
    const { error: profileAError } = await clientA
        .from('profiles')
        .upsert({
            id: userA.id,
            full_name: 'Blocker Alice',
            dob: '1995-05-05',
            location: 'Lucknow',
            gender: 'woman',
            partner_gender_preference: 'man',
            bio: 'I am Blocker Alice',
            profile_owner: 'self',
            onboarding_completed_at: new Date().toISOString()
        });
    if (profileAError) throw profileAError;

    // 2. Sign up User B
    console.log('==> Signing up User B:', emailB);
    const signUpB = await adminClient.auth.signUp({ email: emailB, password });
    if (signUpB.error) throw signUpB.error;
    const sessionB = signUpB.data.session;
    const userB = signUpB.data.user;

    const clientB = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${sessionB.access_token}` } }
    });

    console.log('==> Creating Profile for User B...');
    const { error: profileBError } = await clientB
        .from('profiles')
        .upsert({
            id: userB.id,
            full_name: 'Blocked Bob',
            dob: '1993-03-03',
            location: 'Lucknow',
            gender: 'man',
            partner_gender_preference: 'woman',
            bio: 'I am Blocked Bob',
            profile_owner: 'self',
            onboarding_completed_at: new Date().toISOString()
        });
    if (profileBError) throw profileBError;

    // 3. Create a Match between User A and User B
    const [firstId, secondId] = userA.id < userB.id ? [userA.id, userB.id] : [userB.id, userA.id];
    console.log(`==> Creating Match between ${firstId} and ${secondId}...`);
    
    const { data: match, error: matchError } = await adminClient
        .from('matches')
        .insert({
            user_1_id: firstId,
            user_2_id: secondId,
            status: 'connected',
            is_unlocked: false
        })
        .select()
        .single();
    if (matchError) throw matchError;
    console.log('    Match created:', match.id);

    // 4. User A blocks User B
    console.log(`==> User A (${userA.id}) blocking User B (${userB.id})...`);
    const { error: blockError } = await clientA
        .from('user_blocks')
        .insert({
            blocker_id: userA.id,
            blocked_id: userB.id
        });
    if (blockError) throw blockError;
    console.log('    Block record inserted successfully.');

    // 5. Verify Match is Silently Deleted
    console.log('==> Checking if Match was deleted by DB trigger...');
    const { data: fetchMatch, error: fetchMatchError } = await adminClient
        .from('matches')
        .select('*')
        .eq('id', match.id)
        .maybeSingle();
    if (fetchMatchError) throw fetchMatchError;

    if (fetchMatch) {
        throw new Error('Assertion failed: Match was NOT deleted upon block creation!');
    }
    console.log('    Match termination trigger verification: SUCCESS (match was deleted)');

    // 6. Verify profile query yields null (simulates direct link 404)
    console.log('==> Testing block profile filtration query (User B reading User A)...');
    const { data: profileAForB, error: errorAForB } = await clientB
        .from('profiles')
        .select('id, full_name')
        .eq('id', userA.id)
        .maybeSingle();
    if (errorAForB) throw errorAForB;

    if (profileAForB) {
        throw new Error(`Assertion failed: User B was able to view User A's profile even though they are blocked! Profile name: ${profileAForB.full_name}`);
    }
    console.log('    User B reading User A profile check: SUCCESS (returned null)');

    console.log('==> Testing block profile filtration query (User A reading User B)...');
    const { data: profileBForA, error: errorBForA } = await clientA
        .from('profiles')
        .select('id, full_name')
        .eq('id', userB.id)
        .maybeSingle();
    if (errorBForA) throw errorBForA;

    if (profileBForA) {
        throw new Error(`Assertion failed: User A was able to view User B's profile even though they are blocked! Profile name: ${profileBForA.full_name}`);
    }
    console.log('    User A reading User B profile check: SUCCESS (returned null)');

    // 7. Cleanup test accounts
    console.log('==> Cleaning up test profiles and auth records...');
    await adminClient.from('profiles').delete().in('id', [userA.id, userB.id]);
    const { error: authDelA } = await adminClient.auth.admin.deleteUser(userA.id);
    const { error: authDelB } = await adminClient.auth.admin.deleteUser(userB.id);
    if (authDelA) console.warn('Failed to delete auth user A:', authDelA.message);
    if (authDelB) console.warn('Failed to delete auth user B:', authDelB.message);

    console.log('\n=========================================');
    console.log('✅ STEP 1 VERIFICATION PASSED SUCCESSFULLY!');
    console.log('=========================================');
}

main().catch((err) => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
});
