import Stripe from 'https://esm.sh/stripe@16.10.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { buildViewerUnlockState, getParticipantColumns, MatchRow, MatchUnlockRow } from '../_shared/unlockState.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type CreateUnlockPaymentIntentRequest = {
    matchId?: string;
    isWeb?: boolean;
    successUrl?: string;
    cancelUrl?: string;
};

type PaymentAttemptRow = {
    id: string;
    match_id: string;
    payer_user_id: string;
    stripe_payment_intent_id: string;
    client_secret: string | null;
    amount: number;
    currency: string;
    status: string;
    confirmed_at: string | null;
    created_at: string;
    updated_at: string;
};

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const env = getEnv();
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            return json({ error: 'Missing Authorization header.' }, 401);
        }

        const userClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
            auth: { persistSession: false },
            global: {
                headers: {
                    Authorization: authHeader,
                },
            },
        });

        const {
            data: { user },
            error: userError,
        } = await userClient.auth.getUser();

        if (userError || !user) {
            return json({ error: 'Unauthorized request.' }, 401);
        }

        const payload = (await request.json()) as CreateUnlockPaymentIntentRequest;
        const matchId = typeof payload.matchId === 'string' ? payload.matchId.trim() : '';
        if (!matchId) {
            return json({ error: 'matchId is required.' }, 400);
        }

        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });
        const stripe = new Stripe(env.stripeSecretKey, {
            apiVersion: '2025-04-30.basil',
            httpClient: Stripe.createFetchHttpClient(),
        });

        const match = await fetchMatch(serviceClient, matchId, user.id);
        const unlock = await fetchMatchUnlock(serviceClient, matchId);
        const state = buildViewerUnlockState(match, unlock, user.id);

        const baseResponse = {
            amount: env.unlockAmount,
            currency: env.unlockCurrency,
            merchantDisplayName: env.merchantDisplayName,
        };

        if (match.is_unlocked) {
            return json({
                alreadyUnlocked: true,
                clientSecret: null,
                paymentIntentId: null,
                reused: false,
                state,
                ...baseResponse,
            });
        }

        if (!unlock || unlock.status !== 'awaiting_payment' || !state.hasCurrentUserAccepted || !state.hasOtherUserAccepted) {
            return json({ error: 'Both people must accept the unlock request before payment can start.' }, 409);
        }

        if (state.hasCurrentUserPaid) {
            return json({ error: 'Your payment is already complete. Waiting for the other person.' }, 409);
        }

        if (payload.isWeb) {
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [
                    {
                        price_data: {
                            currency: env.unlockCurrency.toLowerCase(),
                            product_data: {
                                name: `OpenMatch mutual unlock for match ${match.id}`,
                                description: 'One-time fee to unlock direct chat and contact sharing',
                            },
                            unit_amount: env.unlockAmount,
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                    match_id: match.id,
                    payer_user_id: user.id,
                    unlock_mode: 'mutual',
                },
                success_url: payload.successUrl || env.supabaseUrl,
                cancel_url: payload.cancelUrl || env.supabaseUrl,
            });

            return json({
                alreadyUnlocked: false,
                checkoutUrl: session.url,
                reused: false,
                state,
                ...baseResponse,
            });
        }

        const existingAttempt = await fetchLatestPaymentAttempt(serviceClient, match.id, user.id);
        if (existingAttempt) {
            const existingIntent = await stripe.paymentIntents.retrieve(existingAttempt.stripe_payment_intent_id);
            if (
                existingIntent.status !== 'canceled' &&
                existingIntent.status !== 'succeeded' &&
                typeof existingIntent.client_secret === 'string'
            ) {
                await serviceClient
                    .from('match_unlock_payment_attempts')
                    .update({
                        client_secret: existingIntent.client_secret,
                        status: existingIntent.status,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', existingAttempt.id);

                return json({
                    alreadyUnlocked: false,
                    clientSecret: existingIntent.client_secret,
                    paymentIntentId: existingIntent.id,
                    reused: true,
                    state,
                    ...baseResponse,
                });
            }
        }

        const intent = await stripe.paymentIntents.create({
            amount: env.unlockAmount,
            currency: env.unlockCurrency.toLowerCase(),
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                match_id: match.id,
                payer_user_id: user.id,
                unlock_mode: 'mutual',
            },
            description: `OpenMatch mutual unlock for match ${match.id}`,
        });

        const { error: insertError } = await serviceClient.from('match_unlock_payment_attempts').insert({
            match_id: match.id,
            payer_user_id: user.id,
            stripe_payment_intent_id: intent.id,
            client_secret: intent.client_secret,
            amount: env.unlockAmount,
            currency: env.unlockCurrency,
            status: intent.status,
            updated_at: new Date().toISOString(),
        });

        if (insertError) {
            throw insertError;
        }

        return json({
            alreadyUnlocked: false,
            clientSecret: intent.client_secret,
            paymentIntentId: intent.id,
            reused: false,
            state,
            ...baseResponse,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown create unlock payment error.';
        return json({ error: message }, 500);
    }
});

async function fetchMatch(serviceClient: ReturnType<typeof createClient>, matchId: string, userId: string) {
    const { data, error } = await serviceClient
        .from('matches')
        .select('id, user_1_id, user_2_id, status, is_unlocked')
        .eq('id', matchId)
        .single<MatchRow>();

    if (error) {
        throw error;
    }

    getParticipantColumns(data, userId);
    return data;
}

async function fetchMatchUnlock(serviceClient: ReturnType<typeof createClient>, matchId: string) {
    const { data, error } = await serviceClient
        .from('match_unlocks')
        .select('*')
        .eq('match_id', matchId)
        .maybeSingle<MatchUnlockRow>();

    if (error) {
        throw error;
    }

    return data;
}

async function fetchLatestPaymentAttempt(serviceClient: ReturnType<typeof createClient>, matchId: string, userId: string) {
    const { data, error } = await serviceClient
        .from('match_unlock_payment_attempts')
        .select('*')
        .eq('match_id', matchId)
        .eq('payer_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<PaymentAttemptRow>();

    if (error) {
        throw error;
    }

    return data;
}

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    const merchantDisplayName = Deno.env.get('STRIPE_MERCHANT_DISPLAY_NAME') ?? 'OpenMatch';
    const unlockAmount = Number.parseInt(Deno.env.get('STRIPE_UNLOCK_AMOUNT') ?? '9900', 10);
    const unlockCurrency = (Deno.env.get('STRIPE_UNLOCK_CURRENCY') ?? 'INR').toUpperCase();

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !stripeSecretKey) {
        throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, or STRIPE_SECRET_KEY.');
    }

    if (!Number.isFinite(unlockAmount) || unlockAmount < 1) {
        throw new Error('STRIPE_UNLOCK_AMOUNT must be a positive integer.');
    }

    return {
        supabaseUrl,
        supabaseAnonKey,
        supabaseServiceRoleKey,
        stripeSecretKey,
        merchantDisplayName,
        unlockAmount,
        unlockCurrency,
    };
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