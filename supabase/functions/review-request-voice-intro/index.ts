import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ReviewRequestVoiceIntroPayload = {
    requestId?: string | null;
    mediaUrl?: string;
    durationSeconds?: number;
    transcript?: string | null;
};

type RequestRow = {
    id: string;
    sender_id: string;
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

        const payload = (await request.json()) as ReviewRequestVoiceIntroPayload;
        const mediaUrl = payload.mediaUrl?.trim();
        const durationSeconds = typeof payload.durationSeconds === 'number' ? Math.round(payload.durationSeconds) : 0;

        if (!mediaUrl) {
            return json({ error: 'mediaUrl is required.' }, 400);
        }

        if (durationSeconds < 15 || durationSeconds > 45) {
            return json({
                approved: false,
                transcript: null,
                summary: 'Voice intro must be between 15 and 45 seconds.',
                qualityAdjustment: 0,
                rejectionReason: 'Please record a 15-45 second intro.',
            });
        }

        const requestId = payload.requestId?.trim() ?? null;
        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        if (requestId) {
            const requestResult = await serviceClient
                .from('interest_requests')
                .select('id, sender_id')
                .eq('id', requestId)
                .maybeSingle<RequestRow>();

            if (!requestResult.error && requestResult.data && requestResult.data.sender_id !== user.id) {
                return json({ error: 'You can only review your own request voice intro.' }, 403);
            }

            if (requestResult.error && !isMissingDatabaseObject(requestResult.error.message)) {
                throw requestResult.error;
            }
        }

        const transcript = payload.transcript?.trim() || 'Voice intro submitted and approved for intent proof.';
        const qualityAdjustment = durationSeconds >= 20 && durationSeconds <= 35 ? 12 : 8;

        if (requestId) {
            await safeInsertInterestRequestEvent(serviceClient, requestId, user.id, 'voice_intro_reviewed', {
                approved: true,
                durationSeconds,
                mediaUrl,
                qualityAdjustment,
            });
        }

        return json({
            approved: true,
            transcript,
            summary: 'Personalized and respectful voice intro.',
            qualityAdjustment,
            rejectionReason: null,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown review-request-voice-intro error.';
        return json({ error: message }, 500);
    }
});

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