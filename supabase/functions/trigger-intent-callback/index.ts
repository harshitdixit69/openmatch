import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type TriggerIntentCallbackPayload = {
    requestId?: string;
    mode?: 'availability_check' | 'schedule_prompt';
};

type InterestRequestRow = {
    id: string;
    sender_id: string;
    receiver_id: string;
    status: 'sent' | 'accepted' | 'declined' | 'expired' | 'ghosted' | 'closed';
    request_quality_score: number;
    media_type: 'none' | 'voice' | 'video';
    sender_ghost_risk_score: number;
};

type FollowupJobRow = {
    id: string;
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

        const payload = (await request.json()) as TriggerIntentCallbackPayload;
        const requestId = payload.requestId?.trim();
        if (!requestId) {
            return json({ error: 'requestId is required.' }, 400);
        }

        const mode = payload.mode === 'schedule_prompt' ? 'schedule_prompt' : 'availability_check';
        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        const requestResult = await serviceClient
            .from('interest_requests')
            .select('id, sender_id, receiver_id, status, request_quality_score, media_type, sender_ghost_risk_score')
            .eq('id', requestId)
            .maybeSingle<InterestRequestRow>();

        if (requestResult.error && !isMissingDatabaseObject(requestResult.error.message)) {
            throw requestResult.error;
        }

        const interestRequest = requestResult.data;
        if (!interestRequest) {
            return json({ error: 'Interest request not found.' }, 404);
        }

        if (interestRequest.sender_id !== user.id && interestRequest.receiver_id !== user.id) {
            return json({ error: 'You are not a participant in this request.' }, 403);
        }

        const eligibility = evaluateCallbackEligibility(interestRequest);
        if (!eligibility.allowed) {
            return json({ error: eligibility.reason }, 409);
        }

        const channel = mode === 'schedule_prompt' ? 'schedule_prompt' : 'availability_check';
        const existingJob = await serviceClient
            .from('ai_followup_jobs')
            .select('id')
            .eq('request_id', requestId)
            .eq('channel', channel)
            .in('status', ['queued', 'completed'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle<FollowupJobRow>();

        if (existingJob.error && !isMissingDatabaseObject(existingJob.error.message)) {
            throw existingJob.error;
        }

        if (existingJob.data) {
            return json({
                jobId: existingJob.data.id,
                provider: 'retell',
                status: 'queued',
            });
        }

        const insertResult = await serviceClient
            .from('ai_followup_jobs')
            .insert({
                request_id: requestId,
                provider: 'retell',
                channel,
                status: 'queued',
                payload: {
                    mode,
                    requestedBy: user.id,
                    requestQualityScore: interestRequest.request_quality_score,
                    mediaType: interestRequest.media_type,
                },
            })
            .select('id')
            .single<FollowupJobRow>();

        if (insertResult.error) {
            throw insertResult.error;
        }

        await safeInsertInterestRequestEvent(serviceClient, requestId, user.id, 'intent_callback_queued', {
            mode,
            provider: 'retell',
            channel,
        });

        return json({
            jobId: insertResult.data.id,
            provider: 'retell',
            status: 'queued',
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown trigger-intent-callback error.';
        return json({ error: message }, 500);
    }
});

// Eligibility for queuing an AI follow-up job. We intentionally do NOT gate on
// request_quality_score here: once a request is accepted or ghosted, real mutual
// engagement has already happened (the receiver accepted, or the sender ghosted after
// acceptance), so the original cold-request quality is no longer a meaningful signal.
// This function only queues an ai_followup_jobs row; the actual outbound call in
// trigger-outbound-broker-call is still independently gated by explicit broker consent.
function evaluateCallbackEligibility(request: InterestRequestRow) {
    if (request.status !== 'accepted' && request.status !== 'ghosted') {
        return {
            allowed: false,
            reason: 'Callback can only be queued for accepted or ghosted requests.',
        };
    }

    if (request.sender_ghost_risk_score >= 90) {
        return {
            allowed: false,
            reason: 'Callback disabled for critical ghost-risk accounts until pending requests are resolved.',
        };
    }

    return {
        allowed: true,
        reason: null,
    };
}

async function safeInsertInterestRequestEvent(
    serviceClient: ReturnType<typeof createClient>,
    requestId: string,
    actorId: string,
    eventType: string,
    payload: Record<string, unknown>,
) {
    const { error } = await serviceClient.from('interest_request_events').insert({
        request_id: requestId,
        actor_id: actorId,
        event_type: eventType,
        payload,
    });

    if (error && !isMissingDatabaseObject(error.message)) {
        throw error;
    }
}

function isMissingDatabaseObject(message: string | undefined) {
    return /does not exist|relation .* does not exist|function .* does not exist/i.test(message ?? '');
}

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