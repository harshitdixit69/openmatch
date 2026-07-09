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
        const signature = request.headers.get('Stripe-Signature');
        if (!signature) {
            return json({ error: 'Missing Stripe signature header.' }, 400);
        }

        const payload = await request.text();
        const stripe = new Stripe(env.stripeSecretKey, {
            apiVersion: '2025-04-30.basil',
            httpClient: Stripe.createFetchHttpClient(),
        });
        const event = await stripe.webhooks.constructEventAsync(payload, signature, env.webhookSecret);
        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        if (event.type.startsWith('payment_intent.')) {
            const intent = event.data.object as Stripe.PaymentIntent;
            const matchId = typeof intent.metadata.match_id === 'string' ? intent.metadata.match_id.trim() : '';
            const payerUserId = typeof intent.metadata.payer_user_id === 'string' ? intent.metadata.payer_user_id.trim() : '';

            if (!matchId || !payerUserId) {
                return json({ received: true, ignored: true });
            }

            if (event.type === 'payment_intent.succeeded') {
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
        }

        return json({ received: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown Stripe webhook error.';
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

    if (bothPaid && !match.is_unlocked) {
        const { error: updateMatchError } = await serviceClient
            .from('matches')
            .update({ is_unlocked: true })
            .eq('id', matchId);

        if (updateMatchError) {
            throw updateMatchError;
        }
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

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
        },
    });
}