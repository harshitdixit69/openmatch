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
    console.log('==> Starting step 11 & 12 verification...');
    const env = parseEnvFile(await readFile(new URL('../.env', import.meta.url), 'utf8'));
    const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const functionsBaseUrl = supabaseUrl.replace('.supabase.co', '.functions.supabase.co');

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing URL or Anon key in .env file.');
    }

    const client = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const email = `test-ghostwriter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = 'TestGhostwriter!123';

    // 1. Sign up/in test user
    console.log('==> Signing up test user:', email);
    const signUp = await client.auth.signUp({ email, password });
    if (signUp.error) throw signUp.error;
    const session = signUp.data.session;
    const user = signUp.data.user;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${session.access_token}` } }
    });

    // Create user profile
    console.log('==> Upserting user profile...');
    const { error: profileError } = await userClient
        .from('profiles')
        .upsert({
            id: user.id,
            full_name: 'Test Harshit',
            dob: '1998-09-09',
            location: 'Lucknow',
            gender: 'man',
            partner_gender_preference: 'woman',
            bio: 'hello',
            preferences: 'hello',
            profile_owner: 'self',
            onboarding_completed_at: new Date().toISOString()
        });
    if (profileError) throw profileError;

    // 2. Verify Online Presence & Heartbeat (Step 11)
    console.log('==> Verifying online presence RPC...');
    const { error: presenceError } = await userClient.rpc('update_user_presence', { p_status: 'online' });
    if (presenceError) throw presenceError;

    const { data: presenceData, error: fetchPresenceError } = await userClient
        .from('user_presence')
        .select('*')
        .eq('user_id', user.id)
        .single();
    if (fetchPresenceError) throw fetchPresenceError;
    console.log('    Presence table verification: SUCCESS', presenceData);

    // 3. Verify AI Profile Builder / "Ghostwriter" (Step 12)
    console.log('==> Invoking generate-profile-variants Edge Function...');
    const functionResponse = await fetch(`${functionsBaseUrl}/generate-profile-variants`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            full_name: 'Test Harshit',
            gender: 'man',
            partner_gender_preference: 'woman',
            dob: '1998-09-09',
            location: 'Lucknow',
            bio: 'hello',
            preferences: 'hello',
            profile_owner: 'self',
            tone: 'witty'
        })
    });

    if (!functionResponse.ok) {
        throw new Error(`Edge Function generate-profile-variants failed with status ${functionResponse.status}: ${await functionResponse.text()}`);
    }

    const aiResult = await functionResponse.json();
    console.log('    Edge function proposal verification: SUCCESS', aiResult);

    // 4. Verify Revision History Persistence (Step 12)
    console.log('==> Inserting profile revision...');
    const { error: revisionError } = await userClient
        .from('profile_revisions')
        .insert({
            profile_id: user.id,
            tone: 'witty',
            bio: aiResult.bio ?? 'hello optimized',
            preferences: aiResult.preferences ?? 'hello optimized partner',
            source: 'ai',
            revision_number: 1
        });
    if (revisionError) throw revisionError;

    console.log('==> Querying profile revisions (checking RLS)...');
    const { data: revisions, error: fetchRevisionsError } = await userClient
        .from('profile_revisions')
        .select('*')
        .eq('profile_id', user.id);
    if (fetchRevisionsError) throw fetchRevisionsError;

    if (revisions.length !== 1) {
        throw new Error(`Expected exactly 1 revision row, but found: ${revisions.length}`);
    }
    console.log('    Profile revisions persistence verification: SUCCESS', revisions[0]);

    // 5. Verify Typing Status Edge Function (Step 11)
    const dummyMatchId = 'fad08c7b-d2b5-4b9f-a30a-1dff5fd49bab';
    console.log('==> Testing typing-status Edge Function (clear action)...');
    const clearResponse = await fetch(`${functionsBaseUrl}/typing-status`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            matchId: dummyMatchId,
            action: 'clear'
        })
    });

    if (!clearResponse.ok) {
        throw new Error(`Edge Function typing-status clear failed with status ${clearResponse.status}: ${await clearResponse.text()}`);
    }
    const clearResult = await clearResponse.json();
    console.log('    Edge function typing-status clear verification: SUCCESS', clearResult);

    console.log('==> Testing typing-status Edge Function (set action expecting constraint error)...');
    const setResponse = await fetch(`${functionsBaseUrl}/typing-status`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            matchId: dummyMatchId,
            action: 'set'
        })
    });

    const setResText = await setResponse.text();
    // It should fail with 500 error due to match_id FK constraint violation
    if (setResponse.status === 500 && setResText.includes('violates foreign key constraint')) {
        console.log('    Edge function typing-status set constraint check: SUCCESS (correctly failed with FK violation as expected)');
    } else {
        throw new Error(`Expected set typing status on dummy match to fail with 500 FK constraint error, but got status ${setResponse.status}: ${setResText}`);
    }

    console.log('\n=========================================');
    console.log('✅ ALL CHECKS PASSED SUCCESSFULLY!');
    console.log('=========================================');
}

main().catch((err) => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
});
