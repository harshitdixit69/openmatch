import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ManageMatchRequest = {
    action?: 'send' | 'accept';
    candidateProfileId?: string;
    matchId?: string;
    messageContent?: string;
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

const defaultRequestMessage = 'Hi, I would like to connect with you here on OpenMatch.';
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

        const payload = (await request.json()) as ManageMatchRequest;
        const action = payload.action;

        if (action !== 'send' && action !== 'accept') {
            return json({ error: 'A valid action is required.' }, 400);
        }

        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        const result =
            action === 'send'
                ? await handleSendRequest(serviceClient, user.id, payload.candidateProfileId, payload.messageContent)
                : await handleAcceptRequest(serviceClient, user.id, payload.matchId);

        return json(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown match request error.';
        return json({ error: message }, 500);
    }
});

async function handleSendRequest(
    serviceClient: ReturnType<typeof createClient>,
    currentUserId: string,
    candidateProfileId: string | undefined,
    messageContent: string | undefined,
) {
    const normalizedCandidateId = typeof candidateProfileId === 'string' ? candidateProfileId.trim() : '';
    if (!normalizedCandidateId) {
        throw new Error('candidateProfileId is required.');
    }

    const requestMessage = normalizeRequestMessage(messageContent) ?? defaultRequestMessage;

    if (normalizedCandidateId === currentUserId) {
        throw new Error('You cannot send a request to yourself.');
    }

    const [user1Id, user2Id] = [currentUserId, normalizedCandidateId].sort();
    let match = await fetchMatchByPair(serviceClient, user1Id, user2Id);

    if (!match) {
        match = await insertPendingMatch(serviceClient, user1Id, user2Id);
        const message = await insertMessage(serviceClient, match.id, currentUserId, requestMessage);
        return {
            action: 'sent',
            match,
            message,
            notice: 'Request sent and chat opened.',
        };
    }

    const firstMessage = await fetchFirstMessage(serviceClient, match.id);
    if (match.status === 'connected') {
        return {
            action: 'already_connected',
            match,
            message: null,
            notice: 'This request is already accepted.',
        };
    }

    if (match.status === 'pending' && firstMessage?.sender_id && firstMessage.sender_id !== currentUserId) {
        const updatedMatch = await updateMatchStatus(serviceClient, match.id, 'connected');
        const message = await insertMessage(serviceClient, match.id, currentUserId, defaultAcceptMessage);
        return {
            action: 'accepted',
            match: updatedMatch,
            message,
            notice: 'Request accepted and a default reply was sent.',
        };
    }

    if (!firstMessage) {
        const message = await insertMessage(serviceClient, match.id, currentUserId, requestMessage);
        return {
            action: 'sent',
            match,
            message,
            notice: 'Request sent and chat opened.',
        };
    }

    return {
        action: 'already_pending',
        match,
        message: null,
        notice: 'This request is already pending.',
    };
}

function normalizeRequestMessage(value: string | undefined) {
    const normalized = value?.trim();
    if (!normalized) {
        return null;
    }

    return normalized.slice(0, 280);
}

async function handleAcceptRequest(
    serviceClient: ReturnType<typeof createClient>,
    currentUserId: string,
    matchId: string | undefined,
) {
    const normalizedMatchId = typeof matchId === 'string' ? matchId.trim() : '';
    if (!normalizedMatchId) {
        throw new Error('matchId is required.');
    }

    const match = await fetchMatchById(serviceClient, normalizedMatchId);
    if (match.user_1_id !== currentUserId && match.user_2_id !== currentUserId) {
        throw new Error('You are not part of this match.');
    }

    if (match.status === 'connected') {
        return {
            action: 'already_connected',
            match,
            message: null,
            notice: 'This request is already accepted.',
        };
    }

    const firstMessage = await fetchFirstMessage(serviceClient, match.id);
    if (firstMessage?.sender_id === currentUserId) {
        throw new Error('You already sent this request.');
    }

    const updatedMatch = await updateMatchStatus(serviceClient, match.id, 'connected');
    const message = await insertMessage(serviceClient, match.id, currentUserId, defaultAcceptMessage);

    return {
        action: 'accepted',
        match: updatedMatch,
        message,
        notice: 'Request accepted and a default reply was sent.',
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

async function insertMessage(
    serviceClient: ReturnType<typeof createClient>,
    matchId: string,
    senderId: string,
    content: string,
) {
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
        throw error ?? new Error('Could not create the default chat message.');
    }

    return data;
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