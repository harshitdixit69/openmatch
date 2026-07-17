import Stripe from 'https://esm.sh/stripe@16.10.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type CheckoutRequest = {
    packageTier?: 'plus' | 'vip';
    subTier?: 'pro' | 'pro_max' | 'pro_supreme';
    durationMonths?: number;
    successUrl?: string;
    cancelUrl?: string;
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

        const payload = (await request.json()) as CheckoutRequest;
        const packageTier = payload.packageTier;
        const subTier = payload.subTier;
        const durationMonths = payload.durationMonths;

        if (packageTier !== 'plus' && packageTier !== 'vip') {
            return json({ error: 'Invalid or missing packageTier (must be plus or vip).' }, 400);
        }

        if (!durationMonths || ![1, 3, 6, 12].includes(durationMonths)) {
            return json({ error: 'Invalid or missing durationMonths (must be 1, 3, 6, or 12).' }, 400);
        }

        // Pricing and rewards configuration
        let priceINR = 0;
        let unlockCredits = 0;
        let aiCalls = 0;

        if (packageTier === 'plus') {
            const currentSubTier = subTier || 'pro';
            if (currentSubTier === 'pro') {
                if (durationMonths === 1) { priceINR = 299; unlockCredits = 25; }
                else if (durationMonths === 3) { priceINR = 749; unlockCredits = 75; }
                else if (durationMonths === 12) { priceINR = 1799; unlockCredits = 300; }
                else { return json({ error: 'Pro only supports 1, 3, or 12 month packages.' }, 400); }
            } else if (currentSubTier === 'pro_max') {
                if (durationMonths === 1) { priceINR = 499; unlockCredits = 50; }
                else if (durationMonths === 3) { priceINR = 1249; unlockCredits = 150; }
                else if (durationMonths === 12) { priceINR = 2999; unlockCredits = 600; }
                else { return json({ error: 'Pro Max only supports 1, 3, or 12 month packages.' }, 400); }
            } else if (currentSubTier === 'pro_supreme') {
                if (durationMonths === 1) { priceINR = 799; unlockCredits = 80; }
                else if (durationMonths === 3) { priceINR = 1999; unlockCredits = 240; }
                else if (durationMonths === 12) { priceINR = 4999; unlockCredits = 960; }
                else { return json({ error: 'Pro Supreme only supports 1, 3, or 12 month packages.' }, 400); }
            } else {
                return json({ error: 'Invalid subTier (must be pro, pro_max, or pro_supreme).' }, 400);
            }
        } else if (packageTier === 'vip') {
            if (durationMonths === 3) { priceINR = 2499; unlockCredits = 35; aiCalls = 15; }
            else if (durationMonths === 6) { priceINR = 4499; unlockCredits = 80; aiCalls = 30; }
            else if (durationMonths === 12) { priceINR = 7499; unlockCredits = 180; aiCalls = 60; }
            else { return json({ error: 'VIP only supports 3, 6, or 12 month packages.' }, 400); }
        } else {
            return json({ error: 'Invalid packageTier (must be plus or vip).' }, 400);
        }

        const stripe = new Stripe(env.stripeSecretKey, {
            apiVersion: '2025-04-30.basil',
            httpClient: Stripe.createFetchHttpClient(),
        });

        const successUrl = payload.successUrl || env.supabaseUrl;
        const cancelUrl = payload.cancelUrl || env.supabaseUrl;

        const displayName = packageTier === 'plus'
            ? `OpenMatch ${subTier === 'pro_max' ? 'Pro Max' : subTier === 'pro_supreme' ? 'Pro Supreme' : 'Pro'} Upgrade`
            : 'OpenMatch Exclusive (Assisted) Upgrade';

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'inr',
                        product_data: {
                            name: `${displayName} (${durationMonths} ${durationMonths === 1 ? 'Month' : 'Months'})`,
                            description: `Upfront conveniences including ${unlockCredits} match unlock credits${aiCalls > 0 ? ` and ${aiCalls} AI broker calls` : ''}.`,
                        },
                        unit_amount: priceINR * 100, // in paise
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            metadata: {
                type: 'subscription_package',
                user_id: user.id,
                userId: user.id,
                package_tier: packageTier,
                planTier: subTier || packageTier, // pro, pro_max, pro_supreme, or vip
                duration_months: durationMonths.toString(),
                planDuration: durationMonths === 1 ? '1_month' : durationMonths === 3 ? '3_months' : durationMonths === 6 ? '6_months' : 'till_marriage',
                unlock_credits: unlockCredits.toString(),
                ai_calls: aiCalls.toString(),
            },
            success_url: successUrl,
            cancel_url: cancelUrl,
        });

        return json({ checkoutUrl: session.url });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown create checkout session error.';
        return json({ error: message }, 500);
    }
});

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !stripeSecretKey) {
        throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or STRIPE_SECRET_KEY.');
    }

    return {
        supabaseUrl,
        supabaseAnonKey,
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
