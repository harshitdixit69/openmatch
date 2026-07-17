import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const client = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
    });

    const testEmail = `test-premium-${Date.now()}@example.com`;
    let userId: string | null = null;

    try {
        console.log(`Creating test user: ${testEmail}`);
        const { data: authData, error: authError } = await client.auth.admin.createUser({
            email: testEmail,
            password: 'TestPassword123!',
            email_confirm: true,
        });

        if (authError || !authData.user) {
            throw authError ?? new Error('Failed to create test user.');
        }

        userId = authData.user.id;

        // Upsert initial profile
        const { error: profileInitErr } = await client
            .from('profiles')
            .upsert({
                id: userId,
                full_name: 'Test Premium User',
                gender: 'female',
                dob: '1995-05-15',
                location: 'Lucknow, India',
                subscription_tier: 'free',
                manual_unlock_credits: 0,
                ai_call_credits: 0,
                onboarding_completed_at: new Date().toISOString(),
            });

        if (profileInitErr) {
            throw profileInitErr;
        }

        // Verify initial profile state
        const { data: profile, error: profileErr } = await client
            .from('profiles')
            .select('subscription_tier, subscription_expires_at, manual_unlock_credits, ai_call_credits')
            .eq('id', userId)
            .single();

        if (profileErr || !profile) {
            throw profileErr ?? new Error('Failed to fetch test profile.');
        }

        if (profile.subscription_tier !== 'free') {
            throw new Error(`Expected initial tier 'free', got '${profile.subscription_tier}'`);
        }

        console.log('Test user profile verified. Initial state is correct.');

        // 1. Simulate first purchase: Plus 3 Months
        console.log('Sending webhook request for Plus 3 Months purchase...');
        const session1Id = 'cs_test_pro_max_3m_' + Math.random().toString(36).slice(2, 9);
        const paymentIntent1Id = 'pi_test_pro_max_3m_' + Math.random().toString(36).slice(2, 9);
        const session1 = {
            id: 'evt_test_pro_max_3m_' + Math.random().toString(36).slice(2, 9),
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: session1Id,
                    payment_intent: paymentIntent1Id,
                    metadata: {
                        type: 'subscription_package',
                        user_id: userId,
                        planTier: 'pro_max',
                        duration_months: '3',
                    },
                },
            },
        };

        const response1 = await fetch(`${supabaseUrl}/functions/v1/stripe-webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify(session1),
        });

        if (!response1.ok) {
            const errText = await response1.text();
            throw new Error(`Webhook call 1 failed with status ${response1.status}: ${errText}`);
        }

        // Verify profile state after purchase 1
        const { data: profile1, error: profile1Err } = await client
            .from('profiles')
            .select('subscription_tier, subscription_expires_at, unlock_credits_remaining, super_interest_remaining, spotlights_remaining')
            .eq('id', userId)
            .single();

        if (profile1Err || !profile1) {
            throw profile1Err ?? new Error('Failed to fetch profile after purchase 1.');
        }

        if (profile1.subscription_tier !== 'pro_max') {
            throw new Error(`Expected tier 'pro_max', got '${profile1.subscription_tier}'`);
        }
        if (profile1.unlock_credits_remaining !== 90) {
            throw new Error(`Expected 90 unlock credits, got ${profile1.unlock_credits_remaining}`);
        }
        if (profile1.super_interest_remaining !== 150) {
            throw new Error(`Expected 150 super interests, got ${profile1.super_interest_remaining}`);
        }
        if (profile1.spotlights_remaining !== 3) {
            throw new Error(`Expected 3 spotlights, got ${profile1.spotlights_remaining}`);
        }

        const exp1 = new Date(profile1.subscription_expires_at!);
        const now = new Date();
        const diffMonths1 = (exp1.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
        if (diffMonths1 < 2.5 || diffMonths1 > 3.5) {
            throw new Error(`Expected expiry date around 3 months from now, got: ${profile1.subscription_expires_at}`);
        }

        console.log('Plus 3 Months purchase verified successfully!');

        // 1.5 Test Idempotency: Send the exact same session1 webhook again
        console.log('Testing idempotency: sending session1 webhook again...');
        const responseIdempotency = await fetch(`${supabaseUrl}/functions/v1/stripe-webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify(session1),
        });

        if (!responseIdempotency.ok) {
            throw new Error(`Webhook idempotency call failed with status ${responseIdempotency.status}`);
        }

        const resJson = await responseIdempotency.json();
        console.log('Idempotency response payload:', resJson);
        if (!resJson.already_processed) {
            throw new Error('Expected already_processed: true for duplicate webhook payload event.');
        }

        // Verify profile state has NOT changed (credits should still be 90)
        const { data: profileIdemp, error: profileIdempErr } = await client
            .from('profiles')
            .select('unlock_credits_remaining')
            .eq('id', userId)
            .single();

        if (profileIdempErr || !profileIdemp) {
            throw profileIdempErr ?? new Error('Failed to fetch profile for idempotency check.');
        }

        if (profileIdemp.unlock_credits_remaining !== 90) {
            throw new Error(`Expected unlock credits to remain 90, but it changed to ${profileIdemp.unlock_credits_remaining}`);
        }

        console.log('Webhook idempotency check passed successfully!');

        // 1.7 Test Correlated Idempotency: Send the payment intent succeeded webhook for session1 (same payment intent ID)
        console.log('Testing correlated idempotency: sending payment_intent succeeded webhook for session1...');
        const session1Intent = {
            id: 'evt_test_intent_idemp_' + Math.random().toString(36).slice(2, 9),
            type: 'payment_intent.succeeded',
            data: {
                object: {
                    id: paymentIntent1Id,
                    metadata: {}
                }
            }
        };

        const responseIntentIdempotency = await fetch(`${supabaseUrl}/functions/v1/stripe-webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify(session1Intent),
        });

        if (!responseIntentIdempotency.ok) {
            throw new Error(`Webhook payment intent idempotency call failed with status ${responseIntentIdempotency.status}`);
        }

        const resIntentJson = await responseIntentIdempotency.json();
        console.log('Payment intent idempotency response payload:', resIntentJson);
        if (!resIntentJson.already_processed && !resIntentJson.ignored) {
            throw new Error('Expected already_processed: true or ignored: true for correlated payment intent event.');
        }

        console.log('Webhook payment intent idempotency check passed successfully!');

        // 2. Simulate second purchase: Pro Supreme 12 Months (should roll forward expiry & add credits)
        console.log('Sending webhook request for Pro Supreme 12 Months purchase...');
        const session2Id = 'cs_test_pro_supreme_12m_' + Math.random().toString(36).slice(2, 9);
        const paymentIntent2Id = 'pi_test_pro_supreme_12m_' + Math.random().toString(36).slice(2, 9);
        const session2 = {
            id: 'evt_test_pro_supreme_12m_' + Math.random().toString(36).slice(2, 9),
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: session2Id,
                    payment_intent: paymentIntent2Id,
                    metadata: {
                        type: 'subscription_package',
                        user_id: userId,
                        planTier: 'pro_supreme',
                        duration_months: '12',
                    },
                },
            },
        };

        const response2 = await fetch(`${supabaseUrl}/functions/v1/stripe-webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify(session2),
        });

        if (!response2.ok) {
            const errText = await response2.text();
            throw new Error(`Webhook call 2 failed with status ${response2.status}: ${errText}`);
        }

        // Verify profile state after purchase 2
        const { data: profile2, error: profile2Err } = await client
            .from('profiles')
            .select('subscription_tier, subscription_expires_at, unlock_credits_remaining, super_interest_remaining, spotlights_remaining')
            .eq('id', userId)
            .single();

        if (profile2Err || !profile2) {
            throw profile2Err ?? new Error('Failed to fetch profile after purchase 2.');
        }

        if (profile2.subscription_tier !== 'pro_supreme') {
            throw new Error(`Expected tier 'pro_supreme', got '${profile2.subscription_tier}'`);
        }
        if (profile2.unlock_credits_remaining !== 90 + 600) {
            throw new Error(`Expected 690 unlock credits, got ${profile2.unlock_credits_remaining}`);
        }
        if (profile2.super_interest_remaining !== 150 + 960) {
            throw new Error(`Expected 1110 super interests, got ${profile2.super_interest_remaining}`);
        }
        if (profile2.spotlights_remaining !== 3 + 36) {
            throw new Error(`Expected 39 spotlights, got ${profile2.spotlights_remaining}`);
        }

        const exp2 = new Date(profile2.subscription_expires_at!);
        const diffMonths2 = (exp2.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
        if (diffMonths2 < 14.5 || diffMonths2 > 15.5) {
            throw new Error(`Expected expiry date around 15 months from now, got: ${profile2.subscription_expires_at}`);
        }

        console.log('VIP 12 Months purchase and roll-forward verified successfully!');

        return new Response(JSON.stringify({ success: true, message: 'All integration checks passed.' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (err: any) {
        console.error('Test execution failed:', err);
        return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } finally {
        if (userId) {
            console.log(`Cleaning up test user: ${userId}`);
            await client.auth.admin.deleteUser(userId);
        }
    }
});
