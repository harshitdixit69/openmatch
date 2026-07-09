import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Baseline quality score for requests that are accepted directly (auto-accept on reply)
// before any heuristic/AI score is available. Keeps such rows above the callback
// eligibility floor so real, accepted intent is not blocked from follow-up callbacks.
const DEFAULT_ACCEPTED_QUALITY_SCORE = 60;

type SubmitInterestRequestPayload = {
    candidateProfileId?: string;
    selectedReasonId?: string | null;
    personalizedReason?: string;
    mediaType?: 'none' | 'voice' | 'video';
    mediaUrl?: string | null;
    voiceTranscript?: string | null;
    requestQualityScore?: number | null;
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
    created_at: string;
};

type InterestRequestRow = {
    id: string;
    status: string;
    first_reply_due_at?: string | null;
};

type ReliabilityRow = {
    ghost_risk_score: number;
    active_request_limit: number;
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

        const payload = (await request.json()) as SubmitInterestRequestPayload;
        const candidateProfileId = payload.candidateProfileId?.trim();
        const personalizedReason = payload.personalizedReason?.trim();

        if (!candidateProfileId) {
            return json({ error: 'candidateProfileId is required.' }, 400);
        }

        if (!personalizedReason) {
            return json({ error: 'personalizedReason is required.' }, 400);
        }

        if (candidateProfileId === user.id) {
            return json({ error: 'You cannot send a request to yourself.' }, 400);
        }

        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        const reliabilitySummary = await loadReliabilitySummary(serviceClient, user.id);
        if (reliabilitySummary.activeRequestCount >= reliabilitySummary.activeRequestLimit) {
            return json({ error: 'You have reached your current outgoing request limit.' }, 409);
        }

        const [user1Id, user2Id] = [user.id, candidateProfileId].sort();
        const receiverId = user1Id === user.id ? user2Id : user1Id;
        let match = await fetchMatchByPair(serviceClient, user1Id, user2Id);

        if (!match) {
            match = await insertPendingMatch(serviceClient, user1Id, user2Id);
        }

        const firstMessage = await fetchFirstMessage(serviceClient, match.id);
        if (match.status === 'connected') {
            return json({
                requestId: null,
                matchId: match.id,
                status: 'already_connected',
                notice: 'This request is already accepted.',
                requestQualityScore: null,
                ghostRiskScore: reliabilitySummary.ghostRiskScore,
                activeRequestCountRemaining: Math.max(reliabilitySummary.activeRequestLimit - reliabilitySummary.activeRequestCount, 0),
                message: null,
            });
        }

        if (match.status === 'pending' && firstMessage?.sender_id && firstMessage.sender_id !== user.id) {
            const acceptedRequest = await safeAcceptInterestRequest(
                serviceClient,
                match.id,
                firstMessage.sender_id,
                user.id,
                firstMessage.content,
                reliabilitySummary.ghostRiskScore,
            );
            const updatedMatch = await updateMatchStatus(serviceClient, match.id, 'connected');
            const acceptanceMessage = await insertMessage(serviceClient, match.id, user.id, defaultAcceptMessage);

            return json({
                requestId: acceptedRequest?.id ?? null,
                matchId: updatedMatch.id,
                status: 'accepted',
                notice: 'Request accepted and a default reply was sent.',
                requestQualityScore: null,
                ghostRiskScore: reliabilitySummary.ghostRiskScore,
                activeRequestCountRemaining: Math.max(reliabilitySummary.activeRequestLimit - reliabilitySummary.activeRequestCount, 0),
                firstReplyDueAt: acceptedRequest?.first_reply_due_at ?? null,
                message: acceptanceMessage,
            });
        }

        if (firstMessage) {
            return json({
                requestId: null,
                matchId: match.id,
                status: 'already_pending',
                notice: 'This request is already pending.',
                requestQualityScore: null,
                ghostRiskScore: reliabilitySummary.ghostRiskScore,
                activeRequestCountRemaining: Math.max(reliabilitySummary.activeRequestLimit - reliabilitySummary.activeRequestCount, 0),
                message: null,
            });
        }

        const message = await insertMessage(serviceClient, match.id, user.id, personalizedReason.slice(0, 1000));
        const requestRecord = await safeInsertInterestRequest(
            serviceClient,
            match.id,
            user.id,
            receiverId,
            personalizedReason.slice(0, 1000),
            payload.mediaType ?? 'none',
            payload.mediaUrl ?? null,
            payload.requestQualityScore ?? 0,
            reliabilitySummary.ghostRiskScore,
        );

        if (requestRecord) {
            await safeInsertInterestRequestEvent(serviceClient, requestRecord.id, user.id, 'sent', {
                selectedReasonId: payload.selectedReasonId ?? null,
                voiceTranscript: payload.voiceTranscript ?? null,
            });
        }

        return json({
            requestId: requestRecord?.id ?? null,
            matchId: match.id,
            status: 'sent',
            notice: 'Request sent and chat opened.',
            requestQualityScore: null,
            ghostRiskScore: reliabilitySummary.ghostRiskScore,
            activeRequestCountRemaining: Math.max(reliabilitySummary.activeRequestLimit - (reliabilitySummary.activeRequestCount + 1), 0),
            message,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown submit-interest-request error.';
        return json({ error: message }, 500);
    }
});

async function loadReliabilitySummary(serviceClient: ReturnType<typeof createClient>, profileId: string) {
    const reliabilityResult = await serviceClient
        .from('profile_reliability_scores')
        .select('ghost_risk_score, active_request_limit')
        .eq('profile_id', profileId)
        .maybeSingle<ReliabilityRow>();

    let reliability: ReliabilityRow | null = null;
    if (!reliabilityResult.error) {
        reliability = reliabilityResult.data ?? null;
    } else if (!isMissingDatabaseObject(reliabilityResult.error.message)) {
        throw reliabilityResult.error;
    }

    const countResult = await serviceClient.rpc('get_active_interest_request_count', {
        target_profile_id: profileId,
    });

    let activeRequestCount = 0;
    if (!countResult.error) {
        activeRequestCount = typeof countResult.data === 'number' ? countResult.data : 0;
    } else if (!isMissingDatabaseObject(countResult.error.message)) {
        throw countResult.error;
    }

    return {
        ghostRiskScore: reliability?.ghost_risk_score ?? 18,
        activeRequestLimit: reliability?.active_request_limit ?? 10,
        activeRequestCount,
    };
}

async function fetchMatchByPair(serviceClient: ReturnType<typeof createClient>, user1Id: string, user2Id: string) {
    const { data, error } = await serviceClient
        .from('matches')
        .select('id, user_1_id, user_2_id, status, is_unlocked, created_at')
        .eq('user_1_id', user1Id)
        .eq('user_2_id', user2Id)
        .maybeSingle<MatchRow>();

    if (error) {
        throw error;
    }

    return data;
}

async function insertPendingMatch(serviceClient: ReturnType<typeof createClient>, user1Id: string, user2Id: string) {
    const { data, error } = await serviceClient
        .from('matches')
        .insert({
            user_1_id: user1Id,
            user_2_id: user2Id,
            status: 'pending',
        })
        .select('id, user_1_id, user_2_id, status, is_unlocked, created_at')
        .single<MatchRow>();

    if (error || !data) {
        throw error ?? new Error('Could not create the match request.');
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
        throw error ?? new Error('Could not update the match request.');
    }

    return data;
}

async function fetchFirstMessage(serviceClient: ReturnType<typeof createClient>, matchId: string) {
    const { data, error } = await serviceClient
        .from('messages')
        .select('id, match_id, sender_id, content, is_flagged_by_system, created_at')
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
        .select('id, match_id, sender_id, content, is_flagged_by_system, created_at')
        .single<MessageRow>();

    if (error || !data) {
        throw error ?? new Error('Could not create the initial chat message.');
    }

    return data;
}

async function safeInsertInterestRequest(
    serviceClient: ReturnType<typeof createClient>,
    matchId: string,
    senderId: string,
    receiverId: string,
    personalizedReason: string,
    mediaType: 'none' | 'voice' | 'video',
    mediaUrl: string | null,
    requestQualityScore: number,
    ghostRiskScore: number,
) {
    const existing = await serviceClient
        .from('interest_requests')
        .select('id, status')
        .eq('match_id', matchId)
        .eq('sender_id', senderId)
        .eq('receiver_id', receiverId)
        .in('status', ['sent', 'accepted'])
        .maybeSingle<InterestRequestRow>();

    if (!existing.error && existing.data) {
        return existing.data;
    }

    if (existing.error && !isMissingDatabaseObject(existing.error.message)) {
        throw existing.error;
    }

    if (existing.error && isMissingDatabaseObject(existing.error.message)) {
        return null;
    }

    const { data, error } = await serviceClient
        .from('interest_requests')
        .insert({
            match_id: matchId,
            sender_id: senderId,
            receiver_id: receiverId,
            status: 'sent',
            personalized_reason: personalizedReason,
            media_type: mediaType,
            media_url: mediaUrl,
            request_quality_score: Math.max(0, Math.min(100, Math.round(requestQualityScore))),
            sender_ghost_risk_score: ghostRiskScore,
        })
        .select('id, status')
        .single<InterestRequestRow>();

    if (error && isMissingDatabaseObject(error.message)) {
        return null;
    }

    if (error || !data) {
        throw error ?? new Error('Could not create the intent request row.');
    }

    return data;
}

async function safeAcceptInterestRequest(
    serviceClient: ReturnType<typeof createClient>,
    matchId: string,
    senderId: string,
    receiverId: string,
    personalizedReason: string,
    ghostRiskScore: number,
) {
    const existing = await serviceClient
        .from('interest_requests')
        .select('id, status, first_reply_due_at')
        .eq('match_id', matchId)
        .eq('sender_id', senderId)
        .eq('receiver_id', receiverId)
        .in('status', ['sent', 'accepted'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<InterestRequestRow>();

    if (existing.error && isMissingDatabaseObject(existing.error.message)) {
        return null;
    }

    if (existing.error) {
        throw existing.error;
    }

    if (existing.data) {
        if (existing.data.status === 'accepted') {
            return existing.data;
        }

        const { data, error } = await serviceClient
            .from('interest_requests')
            .update({
                status: 'accepted',
                accepted_at: new Date().toISOString(),
                first_reply_due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            })
            .eq('id', existing.data.id)
            .select('id, status, first_reply_due_at')
            .single<InterestRequestRow>();

        if (error) {
            throw error;
        }

        await safeInsertInterestRequestEvent(serviceClient, data.id, receiverId, 'accepted', {});
        return data;
    }

    const { data, error } = await serviceClient
        .from('interest_requests')
        .insert({
            match_id: matchId,
            sender_id: senderId,
            receiver_id: receiverId,
            status: 'accepted',
            personalized_reason: personalizedReason.slice(0, 1000),
            media_type: 'none',
            media_url: null,
            request_quality_score: DEFAULT_ACCEPTED_QUALITY_SCORE,
            sender_ghost_risk_score: ghostRiskScore,
            accepted_at: new Date().toISOString(),
            first_reply_due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .select('id, status, first_reply_due_at')
        .single<InterestRequestRow>();

    if (error && isMissingDatabaseObject(error.message)) {
        return null;
    }

    if (error || !data) {
        throw error ?? new Error('Could not create the accepted intent request row.');
    }

    await safeInsertInterestRequestEvent(serviceClient, data.id, receiverId, 'accepted', {});
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