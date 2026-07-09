import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { callAzureJsonChat, hasChatProvider } from '../_shared/azureChat.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type PromptRequest = {
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

        const payload = (await request.json()) as PromptRequest;
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
                .limit(8)
                .returns<MessageRow[]>(),
        ]);

        if (viewerResult.error || otherResult.error || !viewerResult.data || !otherResult.data) {
            return json({ error: 'Could not load chat prompt context.' }, 500);
        }

        const recentMessages = [...(messagesResult.data ?? [])].reverse();

        const aiResult = await callAzureJsonChat({
            apiKey: env.azureApiKey,
            apiVersion: env.azureApiVersion,
            endpoint: env.azureEndpoint,
            deployment: env.chatDeployment,
            maxTokens: 500,
            messages: [
                {
                    role: 'system',
                    content:
                        'You are a respectful conversation coach for a matrimonial app. Suggest exactly 3 concise next-message prompts the current user could send. Return only JSON with a prompts array. Each prompt must be one sentence, under 90 characters, and ideally 8 to 16 words. Keep them safe, warm, and specific to family values, lifestyle, city, or long-term compatibility. Do not include phone numbers, email, social handles, or anything that asks for direct contact.',
                },
                {
                    role: 'user',
                    content: [
                        `Current user profile:\n${profileToPrompt(viewerResult.data)}`,
                        `Other user profile:\n${profileToPrompt(otherResult.data)}`,
                        `Recent chat:\n${messagesToPrompt(recentMessages, viewerResult.data.id, viewerResult.data.full_name, otherResult.data.full_name)}`,
                    ].join('\n\n'),
                },
            ],
        });

        const prompts = asStringArray(aiResult.prompts).slice(0, 3);
        if (prompts.length === 0) {
            return json({ error: 'AI response did not include any prompts.' }, 500);
        }

        return json({ prompts });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown chat prompt error.';
        return json({ error: message }, 500);
    }
});

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
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
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