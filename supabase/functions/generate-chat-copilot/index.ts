import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { callAzureJsonChat, hasChatProvider } from '../_shared/azureChat.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type CopilotRequest = {
    matchId?: string;
};

type MatchRow = {
    id: string;
    user_1_id: string;
    user_2_id: string;
};

type ProfileRow = {
    id: string;
    full_name: string;
    location: string;
    bio: string | null;
    preferences: string | null;
    profile_owner: string | null;
};

type MessageRow = {
    sender_id: string;
    content: string;
    created_at: string;
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
            return json({ error: 'Unauthorized request.' }, 401);
        }

        const payload = (await request.json()) as CopilotRequest;
        const matchId = payload.matchId?.trim();
        if (!matchId) {
            return json({ error: 'Missing matchId.' }, 400);
        }

        const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
            auth: { persistSession: false },
        });

        const { data: match, error: matchError } = await admin
            .from('matches')
            .select('id, user_1_id, user_2_id')
            .eq('id', matchId)
            .single<MatchRow>();

        if (matchError || !match) {
            return json({ error: 'Match not found.' }, 404);
        }

        const isParticipant = match.user_1_id === user.id || match.user_2_id === user.id;
        if (!isParticipant) {
            return json({ error: 'You are not allowed to access this match.' }, 403);
        }

        const otherUserId = match.user_1_id === user.id ? match.user_2_id : match.user_1_id;

        const [viewerResult, otherResult, messagesResult] = await Promise.all([
            admin
                .from('profiles')
                .select('id, full_name, location, bio, preferences, profile_owner')
                .eq('id', user.id)
                .single<ProfileRow>(),
            admin
                .from('profiles')
                .select('id, full_name, location, bio, preferences, profile_owner')
                .eq('id', otherUserId)
                .single<ProfileRow>(),
            admin
                .from('messages')
                .select('sender_id, content, created_at')
                .eq('match_id', match.id)
                .order('created_at', { ascending: false })
                .limit(20)
                .returns<MessageRow[]>(),
        ]);

        if (viewerResult.error || otherResult.error || !viewerResult.data || !otherResult.data) {
            return json({ error: 'Could not load chat copilot context.' }, 500);
        }

        const recentMessages = [...(messagesResult.data ?? [])].reverse();

        // Deterministic engagement scoring so chemistry never depends purely on an LLM guess.
        const engagement = computeEngagement(recentMessages, viewerResult.data.id);

        const aiResult = await callAzureJsonChat({
            apiKey: env.azureApiKey,
            apiVersion: env.azureApiVersion,
            endpoint: env.azureEndpoint,
            deployment: env.chatDeployment,
            maxTokens: 600,
            messages: [
                {
                    role: 'system',
                    content:
                        'You are a respectful conversation copilot for a matrimonial app. ' +
                        'Return ONLY JSON with this shape: ' +
                        '{"replySuggestions": string[3], "chemistryLabel": string, "warmth": number}. ' +
                        'replySuggestions: exactly 3 concise next messages the CURRENT user could send now, ' +
                        'each one sentence, under 90 characters, warm and specific to family values, lifestyle, ' +
                        'city, or long-term compatibility. If the chat is empty, make them friendly openers. ' +
                        'chemistryLabel: a short 2-4 word read of the vibe (e.g. "Warming up", "Great flow", ' +
                        '"Just getting started"). warmth: an integer 0-100 estimating rapport from the tone of the chat. ' +
                        'Never include phone numbers, email, social handles, or requests for direct contact.',
                },
                {
                    role: 'user',
                    content: [
                        `Current user profile:\n${profileToPrompt(viewerResult.data)}`,
                        `Other user profile:\n${profileToPrompt(otherResult.data)}`,
                        `Recent chat (oldest first):\n${messagesToPrompt(recentMessages, viewerResult.data.id, viewerResult.data.full_name, otherResult.data.full_name)}`,
                    ].join('\n\n'),
                },
            ],
        });

        const replySuggestions = asStringArray(aiResult.replySuggestions).slice(0, 3);
        if (replySuggestions.length === 0) {
            return json({ error: 'AI response did not include any reply suggestions.' }, 500);
        }

        const warmth = clampScore(toNumber(aiResult.warmth, engagement.score));
        // Blend: deterministic engagement dominates, AI warmth nudges the tone read.
        const score = recentMessages.length === 0 ? 0 : clampScore(Math.round(engagement.score * 0.6 + warmth * 0.4));

        const label =
            typeof aiResult.chemistryLabel === 'string' && aiResult.chemistryLabel.trim()
                ? aiResult.chemistryLabel.trim()
                : defaultLabel(score, recentMessages.length);

        return json({
            replySuggestions,
            chemistry: {
                score,
                label,
                signals: engagement.signals,
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown chat copilot error.';
        return json({ error: message }, 500);
    }
});

// ---------------------------------------------------------------------------
// Deterministic engagement / chemistry signals
// ---------------------------------------------------------------------------

function computeEngagement(messages: MessageRow[], viewerId: string): { score: number; signals: string[] } {
    if (messages.length === 0) {
        return { score: 0, signals: ['No messages yet'] };
    }

    const total = messages.length;
    const viewerCount = messages.filter((m) => m.sender_id === viewerId).length;
    const otherCount = total - viewerCount;
    const bothParticipated = viewerCount > 0 && otherCount > 0;
    const balance = bothParticipated ? 1 - Math.abs(viewerCount - otherCount) / total : 0;
    const questionCount = messages.filter((m) => m.content.includes('?')).length;
    const avgLength = messages.reduce((sum, m) => sum + m.content.trim().length, 0) / total;

    const lastCreatedAt = messages[messages.length - 1]?.created_at;
    const recencyHours = lastCreatedAt ? (Date.now() - new Date(lastCreatedAt).getTime()) / 3_600_000 : 999;

    const volumePoints = Math.min(total / 12, 1) * 30;
    const balancePoints = balance * 25;
    const curiosityPoints = Math.min(questionCount / 4, 1) * 20;
    const depthPoints = Math.min(avgLength / 120, 1) * 15;
    const recencyPoints = recencyHours < 24 ? 10 : recencyHours < 72 ? 5 : 0;

    const score = clampScore(Math.round(volumePoints + balancePoints + curiosityPoints + depthPoints + recencyPoints));

    const signals: string[] = [];
    if (!bothParticipated && otherCount === 0) {
        signals.push('Waiting on their first reply');
    } else if (balance >= 0.7) {
        signals.push('Balanced back-and-forth');
    }
    if (questionCount >= 2) {
        signals.push('Good curiosity');
    }
    if (avgLength > 100) {
        signals.push('Thoughtful messages');
    }
    if (recencyHours < 24) {
        signals.push('Active recently');
    } else if (recencyHours > 72) {
        signals.push('Going quiet');
    }

    return { score, signals: signals.slice(0, 3) };
}

function defaultLabel(score: number, messageCount: number): string {
    if (messageCount === 0) {
        return 'Just getting started';
    }
    if (score >= 75) {
        return 'Great flow';
    }
    if (score >= 45) {
        return 'Warming up';
    }
    return 'Early days';
}

function clampScore(value: number): number {
    if (Number.isNaN(value)) {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.round(value)));
}

function toNumber(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Env + formatting helpers (kept in sync with generate-chat-prompts)
// ---------------------------------------------------------------------------

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const azureApiKey = Deno.env.get('AZURE_OPENAI_API_KEY');
    const azureApiVersion = Deno.env.get('AZURE_OPENAI_API_VERSION') ?? '2025-01-01-preview';
    const azureEndpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT');
    const chatDeployment = Deno.env.get('AZURE_OPENAI_CHAT_DEPLOYMENT');

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !hasChatProvider()) {
        throw new Error(
            'Missing SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, or an AI chat provider (set CISCO_* or AZURE_OPENAI_* secrets).',
        );
    }

    return {
        supabaseUrl,
        supabaseAnonKey,
        serviceRoleKey,
        azureApiKey,
        azureApiVersion,
        azureEndpoint,
        chatDeployment,
    };
}

function profileToPrompt(profile: ProfileRow) {
    return [
        `Name: ${profile.full_name}`,
        `Location: ${profile.location}`,
        `Profile owner: ${profile.profile_owner ?? ''}`,
        `Bio: ${profile.bio ?? ''}`,
        `Preferences: ${profile.preferences ?? ''}`,
    ].join('\n');
}

function messagesToPrompt(messages: MessageRow[], viewerId: string, viewerName: string, otherName: string) {
    if (messages.length === 0) {
        return 'No messages yet.';
    }

    return messages
        .map((message) => `${message.sender_id === viewerId ? viewerName : otherName}: ${message.content}`)
        .join('\n');
}

function asStringArray(value: unknown) {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
        : [];
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
