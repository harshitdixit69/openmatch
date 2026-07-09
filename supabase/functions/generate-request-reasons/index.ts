import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { callAzureJsonChat } from '../_shared/azureChat.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type GenerateRequestReasonsPayload = {
    candidateProfileId?: string;
    mode?: string;
};

type ProfileRow = {
    id: string;
    full_name: string;
    gender: string;
    dob: string;
    location: string;
    bio: string | null;
    preferences: string | null;
    height_cm: number | null;
    profile_owner: string | null;
};

type ReliabilityRow = {
    ghost_risk_score: number;
    active_request_limit: number;
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

        const payload = (await request.json()) as GenerateRequestReasonsPayload;
        const candidateProfileId = payload.candidateProfileId?.trim();
        if (!candidateProfileId) {
            return json({ error: 'Missing candidateProfileId.' }, 400);
        }

        const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
            auth: { persistSession: false },
        });

        const [viewerResult, candidateResult, reliability, activeRequestCount] = await Promise.all([
            admin
                .from('profiles')
                .select('id, full_name, gender, dob, location, bio, preferences, height_cm, profile_owner')
                .eq('id', user.id)
                .single<ProfileRow>(),
            admin
                .from('profiles')
                .select('id, full_name, gender, dob, location, bio, preferences, height_cm, profile_owner')
                .eq('id', candidateProfileId)
                .maybeSingle<ProfileRow>(),
            safeFetchReliability(admin, user.id),
            safeFetchActiveRequestCount(admin, user.id),
        ]);

        if (viewerResult.error || !viewerResult.data) {
            return json({ error: 'Could not load the signed-in profile.' }, 404);
        }

        if (candidateResult.error || !candidateResult.data) {
            return json({ error: 'Candidate not found.' }, 404);
        }

        const activeRequestLimit = reliability?.active_request_limit ?? 10;
        const ghostRiskScore = reliability?.ghost_risk_score ?? 18;

        if (activeRequestCount >= activeRequestLimit) {
            return json(
                {
                    error: 'You have reached your current outgoing request limit.',
                    activeRequestCount,
                    activeRequestLimit,
                },
                409,
            );
        }

        const fallback = buildFallbackReasons(viewerResult.data, candidateResult.data, ghostRiskScore, activeRequestCount, activeRequestLimit);
        const aiReasons = await maybeGenerateAiReasons(env, viewerResult.data, candidateResult.data, ghostRiskScore);

        return json({
            reasons: aiReasons?.reasons.length ? aiReasons.reasons : fallback.reasons,
            requestQualityScore: aiReasons?.requestQualityScore ?? fallback.requestQualityScore,
            requiresVoiceIntro: aiReasons?.requiresVoiceIntro ?? fallback.requiresVoiceIntro,
            ghostRiskScore,
            activeRequestCount,
            activeRequestLimit,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown generate-request-reasons error.';
        return json({ error: message }, 500);
    }
});

async function maybeGenerateAiReasons(
    env: ReturnType<typeof getEnv>,
    viewerProfile: ProfileRow,
    candidateProfile: ProfileRow,
    ghostRiskScore: number,
) {
    if (!env.azureApiKey || !env.azureEndpoint || !env.chatDeployment) {
        return null;
    }

    try {
        const aiResult = await callAzureJsonChat({
            apiKey: env.azureApiKey,
            apiVersion: env.azureApiVersion,
            endpoint: env.azureEndpoint,
            deployment: env.chatDeployment,
            maxTokens: 650,
            messages: [
                {
                    role: 'system',
                    content:
                        'You are an intent coach for a matrimonial app. Return only JSON with keys reasons, requestQualityScore, and requiresVoiceIntro. reasons must be an array of exactly 3 objects with keys id, text, score, and tags. Keep each text concrete, respectful, and profile-specific. requestQualityScore must be a number from 0 to 100. requiresVoiceIntro should only be true when the sender risk is high enough that a short voice intro would materially improve trust.',
                },
                {
                    role: 'user',
                    content: `Sender profile:\n${profileToPrompt(viewerProfile)}\n\nReceiver profile:\n${profileToPrompt(candidateProfile)}\n\nSender ghost risk score: ${ghostRiskScore}`,
                },
            ],
        });

        const reasons = Array.isArray(aiResult.reasons)
            ? aiResult.reasons
                .map((reason, index) => normalizeReason(reason, index))
                .filter((reason): reason is NonNullable<ReturnType<typeof normalizeReason>> => Boolean(reason))
                .slice(0, 3)
            : [];

        if (reasons.length === 0) {
            return null;
        }

        return {
            reasons,
            requestQualityScore: normalizeNumber(aiResult.requestQualityScore, 78),
            requiresVoiceIntro: Boolean(aiResult.requiresVoiceIntro) && ghostRiskScore >= 50,
        };
    } catch (error) {
        console.warn('generate-request-reasons AI fallback engaged.', error);
        return null;
    }
}

async function safeFetchReliability(serviceClient: ReturnType<typeof createClient>, profileId: string) {
    const { data, error } = await serviceClient
        .from('profile_reliability_scores')
        .select('ghost_risk_score, active_request_limit')
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

function buildFallbackReasons(
    viewerProfile: ProfileRow,
    candidateProfile: ProfileRow,
    ghostRiskScore: number,
    activeRequestCount: number,
    activeRequestLimit: number,
) {
    const reasons = [];
    const sameLocation = normalizeText(viewerProfile.location) && normalizeText(viewerProfile.location) === normalizeText(candidateProfile.location);

    if (sameLocation) {
        reasons.push({
            id: 'city-alignment',
            text: `Both families are based in ${candidateProfile.location}, which makes an early conversation easier to carry forward seriously.`,
            score: 84,
            tags: ['city'],
        });
    }

    if (viewerProfile.preferences && candidateProfile.preferences) {
        reasons.push({
            id: 'preference-fit',
            text: 'Both profiles include clear long-term preferences, so there is enough specificity here for a respectful first request.',
            score: 80,
            tags: ['preferences', 'values'],
        });
    }

    if (viewerProfile.bio && candidateProfile.bio) {
        reasons.push({
            id: 'profile-depth',
            text: 'Both profiles have enough detail to justify a thoughtful first message instead of a generic interest request.',
            score: 77,
            tags: ['profile-depth'],
        });
    }

    if (reasons.length < 3) {
        reasons.push({
            id: 'serious-intent',
            text: 'This looks like a better match to approach with one specific reason than with a bulk request.',
            score: 72,
            tags: ['intent'],
        });
    }

    if (reasons.length < 3) {
        reasons.push({
            id: 'balanced-first-step',
            text: 'A short, profile-specific note here would make the first interaction feel more credible and respectful.',
            score: 70,
            tags: ['intent'],
        });
    }

    const completenessSignals = [
        viewerProfile.bio,
        viewerProfile.preferences,
        candidateProfile.bio,
        candidateProfile.preferences,
    ].filter(Boolean).length;

    return {
        reasons: reasons.slice(0, 3),
        requestQualityScore: clampNumber(68 + completenessSignals * 4, 64, 86),
        requiresVoiceIntro: ghostRiskScore >= 75 || (ghostRiskScore >= 50 && activeRequestCount >= Math.max(3, activeRequestLimit - 2)),
    };
}

function profileToPrompt(profile: ProfileRow) {
    return [
        `Name: ${profile.full_name}`,
        `Gender: ${profile.gender}`,
        `DOB: ${profile.dob}`,
        `Location: ${profile.location}`,
        `Height: ${profile.height_cm ?? ''}`,
        `Profile owner: ${profile.profile_owner ?? ''}`,
        `Bio: ${profile.bio ?? ''}`,
        `Preferences: ${profile.preferences ?? ''}`,
    ].join('\n');
}

function normalizeReason(value: unknown, index: number) {
    if (!value || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string' || !value.text.trim()) {
        return null;
    }

    const record = value as Record<string, unknown>;
    return {
        id: typeof record.id === 'string' && record.id.trim() ? record.id : `reason-${index + 1}`,
        text: record.text.trim(),
        score: normalizeNumber(record.score, 72),
        tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())) : [],
    };
}

function normalizeNumber(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function normalizeText(value: string | null | undefined) {
    return value?.trim().toLowerCase() ?? '';
}

function clampNumber(value: number, minimum: number, maximum: number) {
    return Math.max(minimum, Math.min(maximum, Math.round(value)));
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
        azureApiKey: Deno.env.get('AZURE_OPENAI_API_KEY') ?? '',
        azureApiVersion: Deno.env.get('AZURE_OPENAI_API_VERSION') ?? '2025-01-01-preview',
        azureEndpoint: Deno.env.get('AZURE_OPENAI_ENDPOINT') ?? '',
        chatDeployment: Deno.env.get('AZURE_OPENAI_CHAT_DEPLOYMENT') ?? '',
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