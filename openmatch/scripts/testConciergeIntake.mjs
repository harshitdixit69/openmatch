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
    console.log('==> Starting Assisted Concierge Intake Verification...');
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

    const email = `test-concierge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = 'TestConcierge!123';

    // 1. Sign up test user
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
            full_name: 'Concierge Tester',
            dob: '1995-05-05',
            location: 'Mumbai',
            gender: 'woman',
            partner_gender_preference: 'man',
            bio: 'Looking for a serious partner.',
            preferences: 'Caring and career-oriented.',
            profile_owner: 'self',
            onboarding_completed_at: new Date().toISOString()
        });
    if (profileError) throw profileError;

    // 2. Initialize Assisted Concierge Session (RPC check)
    console.log('==> Initializing Assisted session via RPC...');
    const { data: sessionId, error: rpcError } = await userClient.rpc('initialize_assisted_session', {
        p_user_id: user.id
    });
    if (rpcError) throw rpcError;
    console.log('    Session initialized successfully. ID:', sessionId);

    // 3. Verify profiles subscription_tier and user_tier updated correctly
    console.log('==> Verifying profiles table updates...');
    const { data: profileRecord, error: fetchProfileError } = await userClient
        .from('profiles')
        .select('subscription_tier, user_tier')
        .eq('id', user.id)
        .single();
    if (fetchProfileError) throw fetchProfileError;
    console.log('    Profile tiers:', profileRecord);
    if (profileRecord.subscription_tier !== 'assisted' || profileRecord.user_tier !== 'ASSISTED') {
        throw new Error('Profile tiers were not updated correctly by RPC.');
    }

    // 4. Verify RLS select policy on concierge session
    console.log('==> Verifying RLS select policy on assisted_concierge_sessions...');
    const { data: sessionRecord, error: sessionFetchError } = await userClient
        .from('assisted_concierge_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();
    if (sessionFetchError) throw sessionFetchError;
    console.log('    Session record from DB:', { id: sessionRecord.id, status: sessionRecord.status });
    if (sessionRecord.status !== 'INTAKE_IN_PROGRESS') {
        throw new Error(`Expected session status INTAKE_IN_PROGRESS, got ${sessionRecord.status}`);
    }

    // 5. Invoke Edge Function for the first message (greeting)
    console.log('==> Invoking concierge-intake-chat Edge Function (Initiating)...');
    const initResponse = await fetch(`${functionsBaseUrl}/concierge-intake-chat`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ messages: [] })
    });

    if (!initResponse.ok) {
        throw new Error(`Edge Function failed with status ${initResponse.status}: ${await initResponse.text()}`);
    }

    const initData = await initResponse.json();
    console.log('    Edge Function Response (Greeting):', initData);
    if (initData.status !== 'IN_PROGRESS' || !initData.message) {
        throw new Error('Greeting response was invalid.');
    }

    // 6. Simulate a chat exchange (dynamic interview)
    console.log('==> Invoking Edge Function with user response...');
    const chatResponse = await fetch(`${functionsBaseUrl}/concierge-intake-chat`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messages: [
                { role: 'assistant', content: initData.message },
                { role: 'user', content: 'I am a software engineer living in Mumbai. I prefer a joint family setting, love travelling on weekends, and dynamic communication is key to me.' }
            ]
        })
    });

    if (!chatResponse.ok) {
        throw new Error(`Edge Function failed with status ${chatResponse.status}: ${await chatResponse.text()}`);
    }

    const chatData = await chatResponse.json();
    console.log('    Edge Function Response (Next Question):', chatData);
    if (chatData.status !== 'IN_PROGRESS' || !chatData.message) {
        throw new Error('Dynamic interview response was invalid.');
    }

    console.log('\n==> ALL PHASE 1 CHECKS PASSED SUCCESSFULLY! ✅');
}

main().catch((err) => {
    console.error('\n❌ VERIFICATION FAILED:', err);
    process.exit(1);
});
