import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { callAzureJsonChat, hasChatProvider } from '../_shared/azureChat.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type OnboardingCopilotRequest = {
    full_name?: string;
    gender?: string;
    partner_gender_preference?: string;
    dob?: string;
    location?: string;
    bio?: string;
    preferences?: string;
    height_cm?: number;
    profile_owner?: string;
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

        const payload = (await request.json()) as OnboardingCopilotRequest;
        if (!payload.full_name?.trim() || !payload.location?.trim()) {
            return json({ error: 'full_name and location are required.' }, 400);
        }

        const aiResult = await callAzureJsonChat({
            apiKey: env.azureApiKey,
            apiVersion: env.azureApiVersion,
            endpoint: env.azureEndpoint,
            deployment: env.chatDeployment,
            maxTokens: 700,
            messages: [
                {
                    role: 'system',
                    content:
                        'You are an onboarding copilot for a matrimonial app. Rewrite the user draft into a respectful, clear, and authentic profile. Return only JSON with keys bio, preferences, summary, and missingTopics. bio should be 3-5 sentences. preferences should be 3-5 sentences. summary should be 1 sentence explaining the profile direction. missingTopics should be an array of 0-4 short missing-detail prompts such as "career goals" or "preferred city".',
                },
                {
                    role: 'user',
                    content: [
                        `Full name: ${payload.full_name ?? ''}`,
                        `Gender: ${payload.gender ?? ''}`,
                        `Looking for a: ${payload.partner_gender_preference ?? ''}`,
                        `Date of birth: ${payload.dob ?? ''}`,
                        `Location: ${payload.location ?? ''}`,
                        `Profile owner: ${payload.profile_owner ?? ''}`,
                        `Height (cm): ${typeof payload.height_cm === 'number' ? payload.height_cm : ''}`,
                        `Current bio draft: ${payload.bio ?? ''}`,
                        `Current partner preferences draft: ${payload.preferences ?? ''}`,
                    ].join('\n'),
                },
            ],
        });

        const bio = asString(aiResult.bio);
        const preferences = asString(aiResult.preferences);
        const summary = asString(aiResult.summary);
        const missingTopics = asStringArray(aiResult.missingTopics).slice(0, 4);

        if (!bio || !preferences || !summary) {
            return json({ error: 'AI response was incomplete.' }, 500);
        }

        return json({ bio, preferences, summary, missingTopics });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown onboarding copilot error.';
        return json({ error: message }, 500);
    }
});

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const azureApiKey = Deno.env.get('AZURE_OPENAI_API_KEY');
    const azureApiVersion = Deno.env.get('AZURE_OPENAI_API_VERSION') ?? '2025-01-01-preview';
    const azureEndpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT');
    const chatDeployment = Deno.env.get('AZURE_OPENAI_CHAT_DEPLOYMENT');

    if (!supabaseUrl || !supabaseAnonKey || !hasChatProvider()) {
        throw new Error(
            'Missing SUPABASE_URL, SUPABASE_ANON_KEY, or an AI chat provider (set CISCO_* or AZURE_OPENAI_* secrets).',
        );
    }

    return {
        supabaseUrl,
        supabaseAnonKey,
        azureApiKey,
        azureApiVersion,
        azureEndpoint,
        chatDeployment,
    };
}

function asString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
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