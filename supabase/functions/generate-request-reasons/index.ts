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

    // With no bio and no stated preferences there is nothing specific to ground
    // a message in. Asking anyway is what produced generic profile advice.
    if (hasThinProfile(candidateProfile)) {
        return null;
    }

    try {
        const receiverName = firstName(candidateProfile.full_name);

        const aiResult = await callAzureJsonChat({
            apiKey: env.azureApiKey,
            apiVersion: env.azureApiVersion,
            endpoint: env.azureEndpoint,
            deployment: env.chatDeployment,
            maxTokens: 650,
            messages: [
                {
                    role: 'system',
                    content: [
                        'You draft short opening messages for a matrimonial app.',
                        '',
                        'CRITICAL: each "text" you produce is sent VERBATIM to the receiver as the sender\'s first message. It is not advice, not feedback, and not commentary. Never describe or evaluate either profile.',
                        '',
                        'Write each message:',
                        '- in the first person, as the sender speaking directly to the receiver',
                        '- referring to something specific from the RECEIVER profile (their work, city, interests, stated preferences)',
                        '- 1 to 2 sentences, under 240 characters, warm and respectful, no flattery about appearance',
                        '- ending in a way that invites a reply',
                        '',
                        'Never write "your bio", "your profile", "add more photos", or any suggestion about improving a profile. Never mention scores, risk, or this app\'s features.',
                        '',
                        'Return only JSON with keys reasons, requestQualityScore, requiresVoiceIntro. reasons must be an array of exactly 3 objects with keys id, text, score, tags. score is your confidence (0-100) that this specific message will get a reply. requestQualityScore is a number 0-100. requiresVoiceIntro should only be true when sender risk is high enough that a short voice intro would materially improve trust.',
                    ].join('\n'),
                },
                {
                    role: 'user',
                    content: [
                        `Write 3 different opening messages that I could send to ${receiverName}.`,
                        '',
                        `About me (the sender, do not describe me back to myself):\n${profileToPrompt(viewerProfile)}`,
                        '',
                        `About ${receiverName} (the receiver — ground the messages in this):\n${profileToPrompt(candidateProfile)}`,
                        '',
                        `Sender ghost risk score: ${ghostRiskScore}`,
                    ].join('\n'),
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

/**
 * Builds sendable opening messages.
 *
 * These are what the receiver actually reads, so they are written in the first
 * person and addressed to them. They previously described the match instead
 * ("Both profiles include clear long-term preferences...") which read as robotic
 * narration when delivered.
 */
function buildFallbackReasons(
    viewerProfile: ProfileRow,
    candidateProfile: ProfileRow,
    ghostRiskScore: number,
    activeRequestCount: number,
    activeRequestLimit: number,
) {
    const reasons: { id: string; text: string; score: number; tags: string[] }[] = [];
    const name = firstName(candidateProfile.full_name);
    const sameLocation = normalizeText(viewerProfile.location) && normalizeText(viewerProfile.location) === normalizeText(candidateProfile.location);

    if (sameLocation) {
        reasons.push({
            id: 'city-alignment',
            text: `Hi ${name}, I noticed we're both in ${candidateProfile.location}. That makes it easy to actually meet if this feels right to both of us. Would you be open to talking?`,
            score: 84,
            tags: ['city'],
        });
    }

    if (candidateProfile.preferences) {
        reasons.push({
            id: 'preference-fit',
            text: `Hi ${name}, what you've written about what you're looking for lines up closely with what I want long term. I'd like to know more about you.`,
            score: 80,
            tags: ['preferences', 'values'],
        });
    }

    if (candidateProfile.bio) {
        reasons.push({
            id: 'profile-depth',
            text: `Hi ${name}, I read your profile properly rather than just swiping. What you wrote about yourself came across as genuine, and I'd like to start a conversation.`,
            score: 77,
            tags: ['profile-depth'],
        });
    }

    if (reasons.length < 3) {
        reasons.push({
            id: 'serious-intent',
            text: `Hi ${name}, I'm here looking for something serious rather than casual conversation. If you feel the same, I'd like to get to know you.`,
            score: 72,
            tags: ['intent'],
        });
    }

    if (reasons.length < 3) {
        reasons.push({
            id: 'balanced-first-step',
            text: `Hi ${name}, I'd rather send you one honest message than a generic request. I'd like to hear more about you if you're open to it.`,
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

/** First name only — full names read stiffly in an opening message. */
function firstName(fullName: string | null | undefined) {
    return fullName?.trim().split(/\s+/)[0] || 'there';
}

/**
 * True when the receiver profile has too little to reference specifically.
 * Without this the model has nothing to ground on and invents filler.
 */
function hasThinProfile(profile: ProfileRow) {
    return !normalizeText(profile.bio) && !normalizeText(profile.preferences);
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

/**
 * Phrases that mean the model has started coaching the sender about their own
 * profile instead of writing a message to the receiver. This text would be sent
 * verbatim, so anything matching is discarded rather than shipped.
 */
const COACHING_PHRASES = [
    'your bio',
    'your profile',
    'your photos',
    'add more',
    'adding more',
    'adding details',
    'consider adding',
    'you should add',
    'more photos',
    'profile completeness',
    'helps potential matches',
    'increase engagement',
    'both profiles',
];

export function isSendableMessage(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length < 15) return false;
    // Long enough to be a paragraph of advice rather than an opening line.
    if (trimmed.length > 320) return false;

    const lowered = trimmed.toLowerCase();
    return !COACHING_PHRASES.some((phrase) => lowered.includes(phrase));
}

function normalizeReason(value: unknown, index: number) {
    if (!value || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string' || !value.text.trim()) {
        return null;
    }

    const record = value as Record<string, unknown>;
    const text = (record.text as string).trim();

    // Guardrail: never surface profile-coaching as a sendable message.
    if (!isSendableMessage(text)) {
        console.warn('generate-request-reasons discarded a non-sendable reason.');
        return null;
    }

    return {
        id: typeof record.id === 'string' && record.id.trim() ? record.id : `reason-${index + 1}`,
        text,
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