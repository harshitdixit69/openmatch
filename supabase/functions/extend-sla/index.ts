import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ExtendSlaPayload = {
    requestId: string;
};

type InterestRequestRow = {
    id: string;
    match_id: string;
    sender_id: string;
    receiver_id: string;
    status: 'sent' | 'accepted' | 'declined' | 'expired' | 'ghosted' | 'closed';
    first_reply_due_at: string | null;
    first_reply_at: string | null;
    sla_extended: boolean;
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
            global: { headers: { Authorization: authHeader } },
        });

        const {
            data: { user },
            error: userError,
        } = await userClient.auth.getUser();

        if (userError || !user) {
            return json({ error: 'Invalid token.' }, 401);
        }

        const payload = (await request.json()) as ExtendSlaPayload;
        if (!payload.requestId) {
            return json({ error: 'Missing requestId parameter.' }, 400);
        }

        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        // 1. Fetch interest request
        const { data: interestRequest, error: fetchError } = await serviceClient
            .from('interest_requests')
            .select('id, match_id, sender_id, receiver_id, status, first_reply_due_at, first_reply_at, sla_extended')
            .eq('id', payload.requestId)
            .single<InterestRequestRow>();

        if (fetchError || !interestRequest) {
            return json({ error: 'Interest request not found.' }, 404);
        }

        // 2. Validate permissions (must be original sender)
        if (interestRequest.sender_id !== user.id) {
            return json({ error: 'Only the original sender of the request can extend the SLA.' }, 403);
        }

        // 3. Verify request is accepted and not already extended/replied
        if (interestRequest.status !== 'accepted') {
            return json({ error: 'Reply deadline can only be extended for accepted requests.' }, 400);
        }

        if (interestRequest.first_reply_at) {
            return json({ error: 'First reply has already been sent.' }, 400);
        }

        if (interestRequest.sla_extended === true) {
            return json({ error: 'Deadline can only be extended once.' }, 400);
        }

        if (!interestRequest.first_reply_due_at) {
            return json({ error: 'No active reply deadline found.' }, 400);
        }

        // 4. Update the deadline (add 24 hours)
        const extendedDueAt = new Date(new Date(interestRequest.first_reply_due_at).getTime() + 24 * 60 * 60 * 1000).toISOString();
        const { data: updatedRequest, error: updateError } = await serviceClient
            .from('interest_requests')
            .update({
                first_reply_due_at: extendedDueAt,
                sla_extended: true,
                updated_at: new Date().toISOString()
            })
            .eq('id', interestRequest.id)
            .select('id, match_id, sender_id, receiver_id, status, first_reply_due_at, first_reply_at, sla_extended')
            .single<InterestRequestRow>();

        if (updateError || !updatedRequest) {
            return json({ error: updateError?.message || 'Failed to extend reply deadline.' }, 500);
        }

        return json({
            success: true,
            updatedRequest,
        });

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown extend-sla error.';
        return json({ error: message }, 500);
    }
});

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
        throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.');
    }

    return {
        supabaseUrl,
        supabaseAnonKey,
        supabaseServiceRoleKey,
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
