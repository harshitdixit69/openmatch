import Stripe from 'https://esm.sh/stripe@16.10.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type TimedOutUnlock = {
    match_id: string;
    payer_user_id: string;
    stripe_payment_intent_id: string;
};

type MatchRow = {
    id: string;
    user_1_id: string;
    user_2_id: string;
    status: string;
    is_unlocked: boolean;
};

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const env = getEnv();
        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        const stripe = new Stripe(env.stripeSecretKey, {
            apiVersion: '2025-04-30.basil',
            httpClient: Stripe.createFetchHttpClient(),
        });

        // 1. Fetch timed out unlocks from DB RPC
        const { data: timedOutList, error: rpcError } = await serviceClient.rpc('get_timed_out_unlocks');
        if (rpcError) {
            throw rpcError;
        }

        const list = (timedOutList ?? []) as TimedOutUnlock[];
        console.log(`Processing ${list.length} timed out match unlocks...`);

        const results = [];

        for (const item of list) {
            const { match_id, payer_user_id, stripe_payment_intent_id } = item;
            console.log(`Processing refund for match: ${match_id}, payer: ${payer_user_id}, intent: ${stripe_payment_intent_id}`);

            let stripeRefunded = false;
            let stripeError: string | null = null;

            try {
                // 2. Trigger Stripe refund
                const refund = await stripe.refunds.create({
                    payment_intent: stripe_payment_intent_id,
                    metadata: {
                        match_id,
                        payer_user_id,
                        refund_reason: 'mutual_unlock_timeout',
                    },
                });
                console.log(`Stripe refund created. ID: ${refund.id}, Status: ${refund.status}`);
                stripeRefunded = true;
            } catch (err: any) {
                stripeError = err?.message ?? 'Unknown Stripe error';
                console.warn(`Stripe refund call failed or was already refunded: ${stripeError}`);
                // If it is already refunded or cannot be refunded, we still proceed to clean up the DB
                if (err?.code === 'charge_already_refunded' || err?.message?.includes('already refunded')) {
                    stripeRefunded = true;
                }
            }

            const now = new Date().toISOString();

            // 3. Update match_unlocks status to declined, and reset paid_at timestamps
            const { error: updateUnlockErr } = await serviceClient
                .from('match_unlocks')
                .update({
                    status: 'declined',
                    declined_by: null, // System timeout indicator
                    declined_at: now,
                    user_1_paid_at: null,
                    user_2_paid_at: null,
                    updated_at: now,
                })
                .eq('match_id', match_id);

            if (updateUnlockErr) {
                console.error(`Failed to update match_unlocks for ${match_id}:`, updateUnlockErr.message);
                results.push({ match_id, success: false, error: updateUnlockErr.message });
                continue;
            }

            // 4. Update the payment attempt status to refunded
            const { error: updateAttemptErr } = await serviceClient
                .from('match_unlock_payment_attempts')
                .update({
                    status: 'refunded',
                    updated_at: now,
                })
                .eq('stripe_payment_intent_id', stripe_payment_intent_id);

            if (updateAttemptErr) {
                console.error(`Failed to update match_unlock_payment_attempts for ${stripe_payment_intent_id}:`, updateAttemptErr.message);
            }

            // 5. Send notifications
            try {
                const { data: match } = await serviceClient
                    .from('matches')
                    .select('user_1_id, user_2_id')
                    .eq('id', match_id)
                    .single<MatchRow>();

                if (match) {
                    const other_user_id = match.user_1_id === payer_user_id ? match.user_2_id : match.user_1_id;

                    // Payer Notification
                    await safeInsertNotification(serviceClient, payer_user_id, 'contact_unlocked', {
                        title: 'Unlock payment refunded',
                        body: 'Your contact unlock request timed out because the other person did not pay. You have been refunded.',
                        metadata: { matchId: match_id },
                    });

                    // Non-payer Notification
                    await safeInsertNotification(serviceClient, other_user_id, 'contact_unlocked', {
                        title: 'Contact unlock expired',
                        body: 'The contact unlock request has expired because payment was not completed.',
                        metadata: { matchId: match_id },
                    });
                }
            } catch (notifyErr: any) {
                console.warn('Failed to send notification:', notifyErr?.message);
            }

            results.push({ match_id, success: true, stripeRefunded, stripeError });
        }

        return json({ processedCount: list.length, results });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown refund cron error.';
        console.error('Error processing payment refunds:', message);
        return json({ error: message }, 500);
    }
});

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

    if (!supabaseUrl || !supabaseServiceRoleKey || !stripeSecretKey) {
        throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or STRIPE_SECRET_KEY.');
    }

    return {
        supabaseUrl,
        supabaseServiceRoleKey,
        stripeSecretKey,
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
