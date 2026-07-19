import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("No signature", { status: 400 });
  }

  let event;
  try {
    const body = await req.text();
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata;

    if (metadata && metadata.userId) {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      const userId = metadata.userId;
      const tier = metadata.tier;
      const months = parseInt(metadata.months || "0", 10);
      const newCredits = parseInt(metadata.unlockCredits || "0", 10);
      const newAiCalls = parseInt(metadata.aiCalls || "0", 10);

      // Fetch the current profile to add credits, instead of just setting them,
      // and determine if they already have an active expiry.
      const { data: profile, error: profileErr } = await supabaseAdmin
        .from('profiles')
        .select('subscription_expires_at, unlock_credits_remaining, ai_call_credits')
        .eq('id', userId)
        .single();

      if (profileErr) {
        console.error("Error fetching profile", profileErr);
        return new Response("Error updating profile", { status: 500 });
      }

      let currentExpiry = profile.subscription_expires_at ? new Date(profile.subscription_expires_at) : new Date();
      if (currentExpiry.getTime() < Date.now()) {
        currentExpiry = new Date();
      }

      // Add the new months to the expiry date
      currentExpiry.setMonth(currentExpiry.getMonth() + months);

      const updatePayload = {
        subscription_tier: tier,
        subscription_expires_at: currentExpiry.toISOString(),
        unlock_credits_remaining: (profile.unlock_credits_remaining || 0) + newCredits,
        ai_call_credits: (profile.ai_call_credits || 0) + newAiCalls,
      };

      const { error: updateErr } = await supabaseAdmin
        .from('profiles')
        .update(updatePayload)
        .eq('id', userId);

      if (updateErr) {
        console.error("Error updating profile", updateErr);
        return new Response("Error updating profile", { status: 500 });
      }

      console.log(`Successfully processed checkout for user ${userId} and upgraded to ${tier}`);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});
