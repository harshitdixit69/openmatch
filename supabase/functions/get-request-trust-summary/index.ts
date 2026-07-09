import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type GetRequestTrustSummaryPayload = {
    targetProfileId?: string;
};

type ProfileRow = {
    id: string;
    profile_owner: string | null;
};

type ReliabilityRow = {
    response_reliability_score: number;
    ghost_risk_score: number;
    active_request_limit: number;
    median_first_reply_minutes: number | null;
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

        const payload = (await request.json()) as GetRequestTrustSummaryPayload;
        const targetProfileId = payload.targetProfileId?.trim();
        if (!targetProfileId) {
            return json({ error: 'Missing targetProfileId.' }, 400);
        }

        const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
            auth: { persistSession: false },
        });

        const [profileResult, reliability, activeRequestCount] = await Promise.all([
            admin.from('profiles').select('id, profile_owner').eq('id', targetProfileId).maybeSingle<ProfileRow>(),
            safeFetchReliability(admin, targetProfileId),
            safeFetchActiveRequestCount(admin, targetProfileId),
        ]);

        if (profileResult.error || !profileResult.data) {
            return json({ error: 'Target profile not found.' }, 404);
        }

        const responseReliabilityScore = clampNumber(reliability?.response_reliability_score ?? 80, 0, 100);
        const ghostRiskScore = clampNumber(reliability?.ghost_risk_score ?? 18, 0, 100);
        const activeRequestLimit = clampNumber(reliability?.active_request_limit ?? 10, 0, 50);
        const medianFirstReplyMinutes =
            typeof reliability?.median_first_reply_minutes === 'number' && Number.isFinite(reliability.median_first_reply_minutes)
                ? Math.max(0, Math.round(reliability.median_first_reply_minutes))
                : null;

        return json({
            responseReliabilityScore,
            ghostRiskScore,
            activeRequestLimit,
            activeRequestCount,
            medianFirstReplyMinutes,
            managedBy: normalizeManagedBy(profileResult.data.profile_owner),
            badges: buildBadges({
                managedBy: normalizeManagedBy(profileResult.data.profile_owner),
                responseReliabilityScore,
                ghostRiskScore,
                activeRequestCount,
                activeRequestLimit,
                medianFirstReplyMinutes,
            }),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown get-request-trust-summary error.';
        return json({ error: message }, 500);
    }
});

async function safeFetchReliability(serviceClient: ReturnType<typeof createClient>, profileId: string) {
    const { data, error } = await serviceClient
        .from('profile_reliability_scores')
        .select('response_reliability_score, ghost_risk_score, active_request_limit, median_first_reply_minutes')
        .eq('profile_id', profileId)
        .maybeSingle<ReliabilityRow>();

    if (!error) {
        return data;
    }

    if (isMissingDatabaseObject(error)) {
        return null;
    }

    throw error;
}

async function safeFetchActiveRequestCount(serviceClient: ReturnType<typeof createClient>, profileId: string) {
    const { data, error } = await serviceClient.rpc('get_active_interest_request_count', {
        target_profile_id: profileId,
    });

    if (!error) {
        return typeof data === 'number' ? data : 0;
    }

    if (isMissingDatabaseObject(error)) {
        return 0;
    }

    throw error;
}

function buildBadges({
    managedBy,
    responseReliabilityScore,
    ghostRiskScore,
    activeRequestCount,
    activeRequestLimit,
    medianFirstReplyMinutes,
}: {
    managedBy: ReturnType<typeof normalizeManagedBy>;
    responseReliabilityScore: number;
    ghostRiskScore: number;
    activeRequestCount: number;
    activeRequestLimit: number;
    medianFirstReplyMinutes: number | null;
}) {
    const badges: string[] = [];

    if (responseReliabilityScore >= 85) {
        badges.push('Replies consistently');
    } else if (typeof medianFirstReplyMinutes === 'number' && medianFirstReplyMinutes > 0 && medianFirstReplyMinutes <= 90) {
        badges.push('Replies quickly');
    } else {
        badges.push('Trust history still forming');
    }

    if (ghostRiskScore <= 24) {
        badges.push('Low ghost risk');
    } else if (ghostRiskScore <= 49) {
        badges.push('Moderate ghost risk');
    } else {
        badges.push('High ghost risk');
    }

    if (managedBy === 'self') {
        badges.push('Self-managed');
    } else if (managedBy) {
        badges.push(`${capitalize(managedBy)}-managed`);
    }

    if (activeRequestCount <= Math.max(2, Math.round(activeRequestLimit / 3))) {
        badges.push('Open requests under control');
    } else if (activeRequestCount >= Math.max(1, activeRequestLimit - 1)) {
        badges.push('Near outgoing request cap');
    }

    return badges.slice(0, 3);
}

function normalizeManagedBy(value: string | null | undefined) {
    if (value === 'self' || value === 'parent' || value === 'sibling' || value === 'relative') {
        return value;
    }

    return null;
}

function clampNumber(value: number, minimum: number, maximum: number) {
    return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function capitalize(value: string) {
    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function isMissingDatabaseObject(error: { message?: string } | null | undefined) {
    const message = error?.message?.toLowerCase() ?? '';
    return message.includes('does not exist') || message.includes('could not find the function');
}

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
        throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.');
    }

    return {
        supabaseUrl,
        supabaseAnonKey,
        serviceRoleKey,
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