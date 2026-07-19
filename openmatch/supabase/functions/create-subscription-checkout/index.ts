import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

interface SubscriptionPackage {
  id: string;
  months: number;
  priceINR: number;
  unlockCredits: number;
  aiCalls: number;
  name: string;
}

const ALL_PACKAGES: SubscriptionPackage[] = [
  // Pro
  { id: 'pro_1m', name: 'OpenMatch Pro (1 Month)', months: 1, priceINR: 299, unlockCredits: 15, aiCalls: 0 },
  { id: 'pro_3m', name: 'OpenMatch Pro (3 Months)', months: 3, priceINR: 749, unlockCredits: 45, aiCalls: 0 },
  { id: 'pro_6m', name: 'OpenMatch Pro (6 Months)', months: 6, priceINR: 1199, unlockCredits: 90, aiCalls: 0 },
  { id: 'pro_12m', name: 'OpenMatch Pro (12 Months)', months: 12, priceINR: 1799, unlockCredits: 180, aiCalls: 0 },
  
  // Pro Max
  { id: 'pro_max_1m', name: 'OpenMatch Pro Max (1 Month)', months: 1, priceINR: 499, unlockCredits: 30, aiCalls: 0 },
  { id: 'pro_max_3m', name: 'OpenMatch Pro Max (3 Months)', months: 3, priceINR: 1249, unlockCredits: 90, aiCalls: 0 },
  { id: 'pro_max_6m', name: 'OpenMatch Pro Max (6 Months)', months: 6, priceINR: 1999, unlockCredits: 180, aiCalls: 0 },
  { id: 'pro_max_12m', name: 'OpenMatch Pro Max (12 Months)', months: 12, priceINR: 2999, unlockCredits: 360, aiCalls: 0 },
  
  // Pro Supreme
  { id: 'pro_supreme_1m', name: 'OpenMatch Pro Supreme (1 Month)', months: 1, priceINR: 799, unlockCredits: 50, aiCalls: 0 },
  { id: 'pro_supreme_3m', name: 'OpenMatch Pro Supreme (3 Months)', months: 3, priceINR: 1999, unlockCredits: 150, aiCalls: 0 },
  { id: 'pro_supreme_6m', name: 'OpenMatch Pro Supreme (6 Months)', months: 6, priceINR: 3299, unlockCredits: 300, aiCalls: 0 },
  { id: 'pro_supreme_12m', name: 'OpenMatch Pro Supreme (12 Months)', months: 12, priceINR: 4999, unlockCredits: 600, aiCalls: 0 },
  
  // Exclusive
  { id: 'exclusive_3m', name: 'OpenMatch Exclusive VIP (3 Months)', months: 3, priceINR: 2499, unlockCredits: 35, aiCalls: 15 },
  { id: 'exclusive_6m', name: 'OpenMatch Exclusive VIP (6 Months)', months: 6, priceINR: 4499, unlockCredits: 80, aiCalls: 30 },
  { id: 'exclusive_12m', name: 'OpenMatch Exclusive VIP (12 Months)', months: 12, priceINR: 7499, unlockCredits: 180, aiCalls: 60 },
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { packageId, successUrl, cancelUrl } = await req.json();

    const selectedPkg = ALL_PACKAGES.find(p => p.id === packageId);
    if (!selectedPkg) throw new Error("Invalid package selected");

    let tier = 'pro';
    if (selectedPkg.id.startsWith('pro_max')) tier = 'pro_max';
    else if (selectedPkg.id.startsWith('pro_supreme')) tier = 'pro_supreme';
    else if (selectedPkg.id.startsWith('exclusive')) tier = 'vip';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'inr',
            product_data: {
              name: selectedPkg.name,
              description: `Unlocks premium features for ${selectedPkg.months} months`,
            },
            unit_amount: selectedPkg.priceINR * 100, // Stripe expects paise
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl || 'openmatch://premium-success',
      cancel_url: cancelUrl || 'openmatch://premium-cancel',
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        packageId: selectedPkg.id,
        tier: tier,
        months: selectedPkg.months.toString(),
        unlockCredits: selectedPkg.unlockCredits.toString(),
        aiCalls: selectedPkg.aiCalls.toString(),
      },
    });

    return new Response(
      JSON.stringify({ checkoutUrl: session.url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
