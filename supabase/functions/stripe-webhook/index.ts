import Stripe from 'https://esm.sh/stripe@16.10.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { MatchUnlockRow } from '../_shared/unlockState.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

type MatchRow = {
    id: string;
    user_1_id: string;
    user_2_id: string;
    is_unlocked: boolean;
};

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const env = getEnv();
        const payload = await request.text();
        let event;
        const stripe = new Stripe(env.stripeSecretKey, {
            apiVersion: '2025-04-30.basil',
            httpClient: Stripe.createFetchHttpClient(),
        });

        const authHeader = request.headers.get('Authorization');
        if (authHeader === `Bearer ${env.supabaseServiceRoleKey}`) {
            event = JSON.parse(payload);
        } else {
            const signature = request.headers.get('Stripe-Signature');
            if (!signature) {
                return json({ error: 'Missing Stripe signature header.' }, 400);
            }
            event = await stripe.webhooks.constructEventAsync(payload, signature, env.webhookSecret);
        }
        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        // Helper to record payment event details to prevent race conditions
        async function recordAndCheckIdempotency(
            eventId: string,
            checkoutSessionId: string | null,
            paymentIntentId: string | null
        ): Promise<boolean> {
            const { error } = await serviceClient
                .from('fulfilled_payments')
                .insert({
                    stripe_event_id: eventId,
                    checkout_session_id: checkoutSessionId || null,
                    payment_intent_id: paymentIntentId || null
                });

            if (error) {
                if (error.code === '23505') {
                    console.log(`Idempotency block: Event ${eventId} (Session: ${checkoutSessionId}, Intent: ${paymentIntentId}) already processed.`);
                    return false;
                }
                console.error('Error inserting idempotency record:', error);
                throw error;
            }
            return true;
        }

        if (event.type.startsWith('payment_intent.')) {
            const intent = event.data.object as Stripe.PaymentIntent;
            const matchId = typeof intent.metadata.match_id === 'string' ? intent.metadata.match_id.trim() : '';
            const payerUserId = typeof intent.metadata.payer_user_id === 'string' ? intent.metadata.payer_user_id.trim() : '';

            if (!matchId || !payerUserId) {
                console.log(`PaymentIntent ${intent.id} has no match metadata. Checking for subscription checkout session...`);
                try {
                    const sessions = await stripe.checkout.sessions.list({
                        payment_intent: intent.id,
                        limit: 1,
                    });
                    const session = sessions.data?.[0];
                    if (session && session.metadata?.type === 'subscription_package') {
                        console.log(`Found subscription checkout session: ${session.id}. Running fulfillment...`);
                        
                        const proceed = await recordAndCheckIdempotency(
                            event.id,
                            session.id,
                            intent.id
                        );
                        if (!proceed) {
                            return json({ received: true, already_processed: true });
                        }

                        await handleSubscriptionCheckoutCompleted(serviceClient, session);
                        return json({ received: true, subscription_fulfilled: true });
                    }
                } catch (err) {
                    console.error('Error fetching checkout session for payment intent:', err);
                }
                return json({ received: true, ignored: true });
            }

            if (event.type === 'payment_intent.succeeded') {
                const proceed = await recordAndCheckIdempotency(
                    event.id,
                    null,
                    intent.id
                );
                if (!proceed) {
                    return json({ received: true, already_processed: true });
                }

                await handleSucceededPayment(serviceClient, matchId, payerUserId, intent);
            } else {
                await serviceClient
                    .from('match_unlock_payment_attempts')
                    .update({
                        status: intent.status,
                        client_secret: intent.client_secret,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('stripe_payment_intent_id', intent.id);
            }
        } else if (event.type === 'checkout.session.completed') {
            const session = event.data.object as Stripe.Checkout.Session;
            if (session.metadata?.type === 'subscription_package') {
                const proceed = await recordAndCheckIdempotency(
                    event.id,
                    session.id,
                    typeof session.payment_intent === 'string' ? session.payment_intent : null
                );
                if (!proceed) {
                    return json({ received: true, already_processed: true });
                }

                await handleSubscriptionCheckoutCompleted(serviceClient, session);
            }
        }

        return json({ received: true });
    } catch (error) {
        console.error('Stripe webhook exception:', error);
        const message = error && typeof error === 'object'
            ? ((error as any).message || JSON.stringify(error))
            : String(error);
        return json({ error: message }, 400);
    }
});

async function handleSucceededPayment(
    serviceClient: ReturnType<typeof createClient>,
    matchId: string,
    payerUserId: string,
    intent: Stripe.PaymentIntent,
) {
    const now = new Date().toISOString();

    await serviceClient.from('match_unlock_payment_attempts').upsert(
        {
            match_id: matchId,
            payer_user_id: payerUserId,
            stripe_payment_intent_id: intent.id,
            client_secret: intent.client_secret,
            amount: intent.amount,
            currency: intent.currency.toUpperCase(),
            status: intent.status,
            confirmed_at: now,
            updated_at: now,
        },
        {
            onConflict: 'stripe_payment_intent_id',
        },
    );

    const { data: match, error: matchError } = await serviceClient
        .from('matches')
        .select('id, user_1_id, user_2_id, is_unlocked')
        .eq('id', matchId)
        .single<MatchRow>();

    if (matchError || !match) {
        throw matchError ?? new Error('Match not found for unlock webhook.');
    }

    const { data: unlock, error: unlockError } = await serviceClient
        .from('match_unlocks')
        .select('*')
        .eq('match_id', matchId)
        .single<MatchUnlockRow>();

    if (unlockError || !unlock) {
        throw unlockError ?? new Error('Match unlock state not found for webhook.');
    }

    const nextUnlock: Partial<MatchUnlockRow> & { updated_at: string } = {
        updated_at: now,
    };

    if (match.user_1_id === payerUserId) {
        nextUnlock.user_1_paid_at = unlock.user_1_paid_at ?? now;
    } else if (match.user_2_id === payerUserId) {
        nextUnlock.user_2_paid_at = unlock.user_2_paid_at ?? now;
    } else {
        throw new Error('Webhook payer is not part of the match.');
    }

    const resultingUser1PaidAt = nextUnlock.user_1_paid_at ?? unlock.user_1_paid_at;
    const resultingUser2PaidAt = nextUnlock.user_2_paid_at ?? unlock.user_2_paid_at;
    const bothPaid = Boolean(resultingUser1PaidAt && resultingUser2PaidAt);

    nextUnlock.status = bothPaid ? 'completed' : 'awaiting_payment';

    const { error: updateUnlockError } = await serviceClient
        .from('match_unlocks')
        .update(nextUnlock)
        .eq('match_id', matchId);

    if (updateUnlockError) {
        throw updateUnlockError;
    }

    if (bothPaid) {
        if (!match.is_unlocked) {
            const { error: updateMatchError } = await serviceClient
                .from('matches')
                .update({ is_unlocked: true })
                .eq('id', matchId);

            if (updateMatchError) {
                throw updateMatchError;
            }
        }

        // Notify both users that contacts are now unlocked
        const otherUserId = match.user_1_id === payerUserId ? match.user_2_id : match.user_1_id;
        await Promise.all([
            safeInsertNotification(serviceClient, payerUserId, 'contact_unlocked', {
                title: 'Contacts unlocked!',
                body: 'Both of you paid. Contacts are now revealed!',
                metadata: { matchId: matchId },
            }),
            safeInsertNotification(serviceClient, otherUserId, 'contact_unlocked', {
                title: 'Contacts unlocked!',
                body: 'Both of you paid. Contacts are now revealed!',
                metadata: { matchId: matchId },
            }),
        ]);
    } else {
        // Only one paid (escrow hold state) - notify the other user
        const otherUserId = match.user_1_id === payerUserId ? match.user_2_id : match.user_1_id;
        let payerName = 'Your match';
        const { data: profile } = await serviceClient
            .from('profiles')
            .select('full_name')
            .eq('id', payerUserId)
            .maybeSingle();
        if (profile?.full_name) {
            payerName = profile.full_name;
        }

        const formattedAmount = `${intent.currency.toUpperCase() === 'INR' ? '₹' : intent.currency.toUpperCase() + ' '}${intent.amount / 100}`;

        await safeInsertNotification(serviceClient, otherUserId, 'contact_unlocked', {
            title: `${payerName} paid to unlock contacts`,
            body: `Your match paid to unlock contacts. Pay ${formattedAmount} to accept and reveal.`,
            metadata: { matchId: matchId },
        });
    }
}

async function safeInsertNotification(
    serviceClient: ReturnType<typeof createClient>,
    userId: string,
    type: string,
    opts: { title: string; body: string; metadata: Record<string, string> },
) {
    const { error } = await serviceClient.from('notifications').insert({
        user_id: userId,
        type,
        title: opts.title,
        body: opts.body,
        metadata: opts.metadata,
        is_read: false,
    });

    if (error && !/does not exist/i.test(error.message ?? '')) {
        console.warn('safeInsertNotification failed:', error.message);
    }
}

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

    if (!supabaseUrl || !supabaseServiceRoleKey || !stripeSecretKey || !webhookSecret) {
        throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, or STRIPE_WEBHOOK_SECRET.');
    }

    return {
        supabaseUrl,
        supabaseServiceRoleKey,
        stripeSecretKey,
        webhookSecret,
    };
}

async function handleSubscriptionCheckoutCompleted(
    serviceClient: ReturnType<typeof createClient>,
    session: Stripe.Checkout.Session,
) {
    const userId = session.metadata?.userId || session.metadata?.user_id;
    const planTier = session.metadata?.planTier || session.metadata?.package_tier;
    const durationMonths = parseInt(session.metadata?.duration_months ?? '0', 10);
    const legacyUnlockCredits = parseInt(session.metadata?.unlock_credits ?? '0', 10);
    const legacyAiCalls = parseInt(session.metadata?.ai_calls ?? '0', 10);

    if (!userId || !planTier || !durationMonths) {
        console.warn('Webhook subscription session missing critical metadata fields:', session.metadata);
        return;
    }

    const tier = planTier.toLowerCase();

    // Compute dynamic credits based on switch/case
    let unlocks = 0;
    let superInterests = 0;
    let spotlights = 0;
    let aiCalls = 0;

    switch (tier) {
        case 'pro':
        case 'plus': {
            const canonicalTier = 'pro';
            if (durationMonths === 1) {
                unlocks = 15; superInterests = 0; spotlights = 0;
            } else if (durationMonths === 3) {
                unlocks = 45; superInterests = 0; spotlights = 0;
            } else if (durationMonths === 6) {
                unlocks = 90; superInterests = 0; spotlights = 0;
            } else if (durationMonths === 12) {
                unlocks = 180; superInterests = 0; spotlights = 0;
            } else {
                unlocks = 15 * durationMonths; superInterests = 0; spotlights = 0;
            }
            break;
        }
        case 'pro_max': {
            if (durationMonths === 1) {
                unlocks = 30; superInterests = 50; spotlights = 1;
            } else if (durationMonths === 3) {
                unlocks = 90; superInterests = 150; spotlights = 3;
            } else if (durationMonths === 6) {
                unlocks = 180; superInterests = 300; spotlights = 6;
            } else if (durationMonths === 12) {
                unlocks = 360; superInterests = 600; spotlights = 12;
            } else {
                unlocks = 30 * durationMonths; superInterests = 50 * durationMonths; spotlights = 1 * durationMonths;
            }
            break;
        }
        case 'pro_supreme': {
            if (durationMonths === 1) {
                unlocks = 50; superInterests = 80; spotlights = 3;
            } else if (durationMonths === 3) {
                unlocks = 150; superInterests = 240; spotlights = 9;
            } else if (durationMonths === 6) {
                unlocks = 300; superInterests = 480; spotlights = 18;
            } else if (durationMonths === 12) {
                unlocks = 600; superInterests = 960; spotlights = 36;
            } else {
                unlocks = 50 * durationMonths; superInterests = 80 * durationMonths; spotlights = 3 * durationMonths;
            }
            break;
        }
        case 'vip':
        case 'exclusive': {
            aiCalls = legacyAiCalls || (durationMonths === 3 ? 15 : durationMonths === 6 ? 30 : 60);
            unlocks = legacyUnlockCredits || (durationMonths === 3 ? 35 : durationMonths === 6 ? 80 : 180);
            superInterests = 0;
            spotlights = 0;
            break;
        }
        default: {
            unlocks = legacyUnlockCredits || (15 * durationMonths);
            aiCalls = legacyAiCalls;
            superInterests = 0;
            spotlights = 0;
            break;
        }
    }

    const { data: profile, error: profileErr } = await serviceClient
        .from('profiles')
        .select('subscription_tier, subscription_expires_at, unlock_credits_remaining, super_interest_remaining, spotlights_remaining, manual_unlock_credits, ai_call_credits')
        .eq('id', userId)
        .single();

    if (profileErr || !profile) {
        throw profileErr ?? new Error(`User profile not found for ID: ${userId}`);
    }

    const now = new Date();
    let currentExpiry = profile.subscription_expires_at ? new Date(profile.subscription_expires_at) : null;

    let newExpiry: Date;
    if (currentExpiry && currentExpiry.getTime() > now.getTime()) {
        newExpiry = new Date(currentExpiry.getTime());
    } else {
        newExpiry = new Date(now.getTime());
    }

    newExpiry.setMonth(newExpiry.getMonth() + durationMonths);

    // Atomic calculated additions
    const newUnlockCredits = (profile.unlock_credits_remaining ?? 0) + unlocks;
    const newSuperInterests = (profile.super_interest_remaining ?? 0) + superInterests;
    const newSpotlights = (profile.spotlights_remaining ?? 0) + spotlights;

    const legacyManualUnlockCredits = (profile.manual_unlock_credits ?? 0) + unlocks;
    const legacyAiCallsTotal = (profile.ai_call_credits ?? 0) + aiCalls;

    // Determine target tier string (keep vip/plus for backward compat/UI checks)
    const targetTier = (tier === 'plus') ? 'pro' : tier;

    const { error: updateErr } = await serviceClient
        .from('profiles')
        .update({
            subscription_tier: targetTier,
            subscription_expires_at: newExpiry.toISOString(),
            unlock_credits_remaining: newUnlockCredits,
            super_interest_remaining: newSuperInterests,
            spotlights_remaining: newSpotlights,
            // Sync legacy columns
            manual_unlock_credits: legacyManualUnlockCredits,
            ai_call_credits: legacyAiCallsTotal,
        })
        .eq('id', userId);

    if (updateErr) {
        throw updateErr;
    }

    await safeInsertNotification(serviceClient, userId, 'subscription_activated', {
        title: `OpenMatch ${targetTier.toUpperCase()} Unlocked!`,
        body: `Your upgrade for ${durationMonths} months is active. Added ${unlocks} unlocks, ${superInterests} super interests, and ${spotlights} spotlights!`,
        metadata: {
            package_tier: targetTier,
            duration_months: durationMonths.toString(),
        },
    });
}

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
        },
    });
}