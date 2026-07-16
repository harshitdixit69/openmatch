import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Parse .env file manually to avoid third-party dotenv dependency
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
        const match = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
            const key = match[1];
            let value = match[2] || '';
            if (value.length > 0 && value.startsWith('"') && value.endsWith('"')) {
                value = value.substring(1, value.length - 1);
            } else if (value.length > 0 && value.startsWith("'") && value.endsWith("'")) {
                value = value.substring(1, value.length - 1);
            }
            process.env[key] = value.trim();
        }
    });
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Error: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be defined.');
    process.exit(1);
}

const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
});

async function ensureUserSession(email: string, password: string) {
    // Try sign in
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.data?.session) {
        return signIn.data;
    }
    // Sign up
    const signUp = await client.auth.signUp({ email, password });
    if (signUp.error) {
        throw signUp.error;
    }
    return signUp.data;
}

async function runStripeFallbackTest() {
    console.log('--------------------------------------------------');
    console.log('STARTING STRIPE WEB FALLBACK INTEGRATION TEST');
    console.log('--------------------------------------------------');

    const testEmail1 = `stripetest_user1_${Date.now()}@example.com`;
    const testEmail2 = `stripetest_user2_${Date.now()}@example.com`;
    const testPassword = 'StripeTestPassword123!';

    let user1Id = '';
    let user2Id = '';
    let matchId = '';
    let client1: any = null;

    try {
        // 1. Sign up/in User 1
        console.log('Registering/logging in User 1...');
        const session1 = await ensureUserSession(testEmail1, testPassword);
        user1Id = session1.user!.id;

        // 2. Sign up/in User 2
        console.log('Registering/logging in User 2...');
        const session2 = await ensureUserSession(testEmail2, testPassword);
        user2Id = session2.user!.id;

        client1 = createClient(supabaseUrl, supabaseAnonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${session1.session!.access_token}` } }
        });

        const client2 = createClient(supabaseUrl, supabaseAnonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${session2.session!.access_token}` } }
        });

        // 3. Setup profiles
        console.log('Setting up profiles onboarding completion...');
        const { error: p1Err } = await client1.from('profiles').upsert({
            id: user1Id,
            full_name: 'Stripe Web Test 1',
            dob: '1998-09-09',
            location: 'Lucknow',
            gender: 'man',
            partner_gender_preference: 'woman',
            profile_owner: 'self',
            onboarding_completed_at: new Date().toISOString(),
        });
        if (p1Err) throw p1Err;

        const { error: p2Err } = await client2.from('profiles').upsert({
            id: user2Id,
            full_name: 'Stripe Web Test 2',
            dob: '1998-09-09',
            location: 'Lucknow',
            gender: 'woman',
            partner_gender_preference: 'man',
            profile_owner: 'self',
            onboarding_completed_at: new Date().toISOString(),
        });
        if (p2Err) throw p2Err;

        // 4. Create connected Match
        console.log('Creating connected match row...');
        const { data: match, error: matchErr } = await client1.from('matches').insert({
            user_1_id: user1Id < user2Id ? user1Id : user2Id,
            user_2_id: user1Id < user2Id ? user2Id : user1Id,
            status: 'connected',
            is_unlocked: false,
        }).select().single();
        if (matchErr || !match) throw matchErr || new Error('Failed to create match');
        matchId = match.id;

        // 5. User 1 requests unlock via update-match-unlock edge function
        console.log('User 1 requesting unlock...');
        const { data: reqRes, error: reqErr } = await client1.functions.invoke('update-match-unlock', {
            body: { matchId, action: 'request' }
        });
        if (reqErr) throw reqErr;
        console.log('Request response:', reqRes);

        // 6. User 2 accepts unlock via update-match-unlock edge function
        console.log('User 2 accepting unlock...');
        const { data: accRes, error: accErr } = await client2.functions.invoke('update-match-unlock', {
            body: { matchId, action: 'accept' }
        });
        if (accErr) throw accErr;
        console.log('Accept response:', accRes);

        // 7. Test WEB checkout session generation (isWeb = true)
        console.log('\n--- REQUEST 1: WEB CHECKOUT SESSION FALLBACK (isWeb: true) ---');
        const { data: webResult, error: webErr } = await client1.functions.invoke('create-unlock-payment-intent', {
            body: {
                matchId: matchId,
                isWeb: true,
                successUrl: 'https://openmatch.org/success',
                cancelUrl: 'https://openmatch.org/cancel',
            }
        });

        if (webErr) {
            if (webErr.context && typeof webErr.context.json === 'function') {
                try {
                    const errBody = await webErr.context.json();
                    console.error('Web error payload:', errBody);
                } catch {}
            }
            throw webErr;
        }
        console.log('Web Response Payload:', webResult);

        if (webResult.checkoutUrl && webResult.checkoutUrl.includes('stripe.com')) {
            console.log('✅ SUCCESS: checkoutUrl successfully created and points to Stripe Checkout Session!');
        } else {
            console.error('❌ FAILURE: checkoutUrl is missing or invalid.');
            process.exit(1);
        }

        // 8. Test NATIVE PaymentIntent generation (isWeb = false / undefined)
        console.log('\n--- REQUEST 2: NATIVE PAYMENT INTENT (isWeb: false) ---');
        const { data: nativeResult, error: nativeErr } = await client1.functions.invoke('create-unlock-payment-intent', {
            body: {
                matchId: matchId,
                isWeb: false,
            }
        });

        if (nativeErr) throw nativeErr;
        console.log('Native Response Payload:', nativeResult);

        if (nativeResult.clientSecret && nativeResult.paymentIntentId) {
            console.log('✅ SUCCESS: clientSecret and paymentIntentId successfully created for native flow!');
        } else {
            console.error('❌ FAILURE: clientSecret or paymentIntentId is missing.');
            process.exit(1);
        }

        console.log('\n--------------------------------------------------');
        console.log('STRIPE WEB FALLBACK UNIT TESTS COMPLETED SUCCESSFULLY!');
        console.log('--------------------------------------------------');

    } catch (err) {
        console.error('❌ TEST ERROR:', err);
        process.exit(1);
    } finally {
        // Clean up test data
        console.log('\nStarting database clean up...');
        if (matchId) {
            const { error: delErr } = await client1.from('matches').delete().eq('id', matchId);
            if (delErr) {
                console.error('Clean up match delete failed:', delErr);
            } else {
                console.log('Deleted test match row');
            }
        }
        console.log('Clean up complete.');
    }
}

runStripeFallbackTest();
