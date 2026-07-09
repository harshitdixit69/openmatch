import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type RespondInterestRequestPayload = {
    action?: 'accept' | 'decline';
    matchId?: string;
    requestId?: string;
};

type MatchRow = {
    id: string;
    user_1_id: string;
    user_2_id: string;
    status: string;
    is_unlocked: boolean;
    created_at: string;
};

type MessageRow = {
    id: string;
    match_id: string;
    sender_id: string;
    content: string;
    is_flagged_by_system: boolean;
    read_at: string | null;
    created_at: string;
};

type InterestRequestRow = {
    id: string;
    match_id: string;
    sender_id: string;
    receiver_id: string;
    status: 'sent' | 'accepted' | 'declined' | 'expired' | 'ghosted' | 'closed';
    personalized_reason: string;
    accepted_at: string | null;
    first_reply_due_at: string | null;
};

const defaultAcceptMessage = 'Hi, I accepted your request. Happy to continue the conversation here.';

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

        const payload = (await request.json()) as RespondInterestRequestPayload;
        if (payload.action !== 'accept' && payload.action !== 'decline') {
            return json({ error: 'A valid action is required.' }, 400);
        }

        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        const requestRecord = await fetchInterestRequest(serviceClient, user.id, payload);
        const targetMatch = requestRecord
            ? await fetchMatchById(serviceClient, requestRecord.match_id)
            : await fetchLegacyPendingMatch(serviceClient, user.id, payload.matchId);

        if (!targetMatch) {
            return json({ error: 'Pending request not found.' }, 404);
        }

        if (payload.action === 'decline') {
            const declinedRequest = requestRecord
                ? await updateInterestRequestStatus(serviceClient, requestRecord.id, 'declined')
                : await insertLegacyInterestRequest(serviceClient, targetMatch, user.id, 'declined');

            if (declinedRequest) {
                await safeInsertInterestRequestEvent(serviceClient, declinedRequest.id, user.id, 'declined', {});
            }

            return json({
                action: 'declined',
                requestId: declinedRequest?.id ?? null,
                matchId: targetMatch.id,
                notice: 'Request declined.',
                firstReplyDueAt: null,
                message: null,
            });
        }

        if (targetMatch.status === 'connected' && requestRecord?.status === 'accepted') {
            return json({
                action: 'already_connected',
                requestId: requestRecord.id,
                matchId: targetMatch.id,
                notice: 'This request is already accepted.',
                firstReplyDueAt: requestRecord.first_reply_due_at,
                message: null,
            });
        }

        const acceptedRequest = requestRecord
            ? await acceptInterestRequest(serviceClient, requestRecord)
            : await insertLegacyInterestRequest(serviceClient, targetMatch, user.id, 'accepted');
        const updatedMatch = await updateMatchStatus(serviceClient, targetMatch.id, 'connected');
        const message = await insertMessage(serviceClient, targetMatch.id, user.id, defaultAcceptMessage);

        if (acceptedRequest) {
            await safeInsertInterestRequestEvent(serviceClient, acceptedRequest.id, user.id, 'accepted', {});
        }

        return json({
            action: 'accepted',
            requestId: acceptedRequest?.id ?? null,
            matchId: updatedMatch.id,
            notice: 'Request accepted and a default reply was sent.',
            firstReplyDueAt: acceptedRequest?.first_reply_due_at ?? null,
            message,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown respond-interest-request error.';
        return json({ error: message }, 500);
    }
});

async function fetchInterestRequest(
    serviceClient: ReturnType<typeof createClient>,
    currentUserId: string,
    payload: RespondInterestRequestPayload,
) {
    const baseQuery = serviceClient
        .from('interest_requests')
        .select('id, match_id, sender_id, receiver_id, status, personalized_reason, accepted_at, first_reply_due_at')
        .eq('receiver_id', currentUserId)
        .in('status', ['sent', 'accepted']);

    const query = payload.requestId
        ? baseQuery.eq('id', payload.requestId.trim())
        : payload.matchId
            ? baseQuery.eq('match_id', payload.matchId.trim()).order('created_at', { ascending: false }).limit(1)
            : null;

    if (!query) {
        return null;
    }

    const { data, error } = await query.maybeSingle<InterestRequestRow>();

    if (error && !isMissingDatabaseObject(error.message)) {
        throw error;
    }

    return data ?? null;
}

async function fetchLegacyPendingMatch(
    serviceClient: ReturnType<typeof createClient>,
    currentUserId: string,
    matchId: string | undefined,
) {
    const normalizedMatchId = matchId?.trim();
    if (!normalizedMatchId) {
        return null;
    }

    const match = await fetchMatchById(serviceClient, normalizedMatchId);
    if (match.user_1_id !== currentUserId && match.user_2_id !== currentUserId) {
        throw new Error('You are not part of this match.');
    }

    if (match.status !== 'pending') {
        return match;
    }

    const firstMessage = await fetchFirstMessage(serviceClient, match.id);
    if (!firstMessage || firstMessage.sender_id === currentUserId) {
        throw new Error('You cannot respond to your own request.');
    }

    return match;
}

async function acceptInterestRequest(serviceClient: ReturnType<typeof createClient>, requestRecord: InterestRequestRow) {
    if (requestRecord.status === 'accepted') {
        return requestRecord;
    }

    const { data, error } = await serviceClient
        .from('interest_requests')
        .update({
            status: 'accepted',
            accepted_at: new Date().toISOString(),
            first_reply_due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('id', requestRecord.id)
        .select('id, match_id, sender_id, receiver_id, status, personalized_reason, accepted_at, first_reply_due_at')
        .single<InterestRequestRow>();

    if (error || !data) {
        throw error ?? new Error('Could not accept the interest request.');
    }

    return data;
}

async function updateInterestRequestStatus(
    serviceClient: ReturnType<typeof createClient>,
    requestId: string,
    status: 'declined',
) {
    const { data, error } = await serviceClient
        .from('interest_requests')
        .update({ status })
        .eq('id', requestId)
        .select('id, match_id, sender_id, receiver_id, status, personalized_reason, accepted_at, first_reply_due_at')
        .single<InterestRequestRow>();

    if (error || !data) {
        throw error ?? new Error('Could not update the interest request.');
    }

    return data;
}

async function insertLegacyInterestRequest(
    serviceClient: ReturnType<typeof createClient>,
    match: MatchRow,
    currentUserId: string,
    targetStatus: 'accepted' | 'declined',
) {
    const firstMessage = await fetchFirstMessage(serviceClient, match.id);
    if (!firstMessage || firstMessage.sender_id === currentUserId) {
        return null;
    }

    const { data, error } = await serviceClient
        .from('interest_requests')
        .insert({
            match_id: match.id,
            sender_id: firstMessage.sender_id,
            receiver_id: currentUserId,
            status: targetStatus,
            personalized_reason: firstMessage.content.slice(0, 1000),
            media_type: 'none',
            media_url: null,
            request_quality_score: 0,
            sender_ghost_risk_score: 0,
            accepted_at: targetStatus === 'accepted' ? new Date().toISOString() : null,
            first_reply_due_at:
                targetStatus === 'accepted' ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null,
        })
        .select('id, match_id, sender_id, receiver_id, status, personalized_reason, accepted_at, first_reply_due_at')
        .single<InterestRequestRow>();

    if (error && isMissingDatabaseObject(error.message)) {
        return null;
    }

    if (error || !data) {
        throw error ?? new Error('Could not create a legacy interest request row.');
    }

    return data;
}

async function fetchMatchById(serviceClient: ReturnType<typeof createClient>, matchId: string) {
    const { data, error } = await serviceClient
        .from('matches')
        .select('id, user_1_id, user_2_id, status, is_unlocked, created_at')
        .eq('id', matchId)
        .single<MatchRow>();

    if (error || !data) {
        throw error ?? new Error('Match not found.');
    }

    return data;
}

async function updateMatchStatus(serviceClient: ReturnType<typeof createClient>, matchId: string, status: 'pending' | 'connected') {
    const { data, error } = await serviceClient
        .from('matches')
        .update({ status })
        .eq('id', matchId)
        .select('id, user_1_id, user_2_id, status, is_unlocked, created_at')
        .single<MatchRow>();

    if (error || !data) {
        throw error ?? new Error('Could not update the match status.');
    }

    return data;
}

async function fetchFirstMessage(serviceClient: ReturnType<typeof createClient>, matchId: string) {
    const { data, error } = await serviceClient
        .from('messages')
        .select('id, match_id, sender_id, content, is_flagged_by_system, read_at, created_at')
        .eq('match_id', matchId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle<MessageRow>();

    if (error) {
        throw error;
    }

    return data;
}

async function insertMessage(serviceClient: ReturnType<typeof createClient>, matchId: string, senderId: string, content: string) {
    const { data, error } = await serviceClient
        .from('messages')
        .insert({
            match_id: matchId,
            sender_id: senderId,
            content,
            is_flagged_by_system: false,
        })
        .select('id, match_id, sender_id, content, is_flagged_by_system, read_at, created_at')
        .single<MessageRow>();

    if (error || !data) {
        throw error ?? new Error('Could not create the acceptance message.');
    }

    return data;
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