import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { callAzureJsonChat, hasChatProvider } from '../_shared/azureChat.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type BreakdownRequest = {
    candidateProfileId?: string;
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

        const payload = (await request.json()) as BreakdownRequest;
        const candidateProfileId = payload.candidateProfileId?.trim();
        if (!candidateProfileId) {
            return json({ error: 'Missing candidateProfileId.' }, 400);
        }

        const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
            auth: { persistSession: false },
        });

        const [viewerResult, candidateResult] = await Promise.all([
            admin
                .from('profiles')
                .select('id, full_name, gender, dob, location, bio, preferences, height_cm, profile_owner')
                .eq('id', user.id)
                .single<ProfileRow>(),
            admin
                .from('profiles')
                .select('id, full_name, gender, dob, location, bio, preferences, height_cm, profile_owner')
                .eq('id', candidateProfileId)
                .single<ProfileRow>(),
        ]);

        if (viewerResult.error || candidateResult.error || !viewerResult.data || !candidateResult.data) {
            return json({ error: 'Could not load both profiles for AI analysis.' }, 404);
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
                        'You are a matchmaking analyst for a matrimonial app. Compare the two profiles and return only JSON with keys summary, fitPoints, and frictionPoints. summary must be 2 concise sentences. fitPoints must be 2-4 short concrete reasons they align. frictionPoints must be 1-3 realistic points they should discuss early. Be balanced, respectful, and avoid certainty or overpromising.',
                },
                {
                    role: 'user',
                    content: `Profile A:\n${profileToPrompt(viewerResult.data)}\n\nProfile B:\n${profileToPrompt(candidateResult.data)}`,
                },
            ],
        });

        const summary = asString(aiResult.summary);
        const fitPoints = asStringArray(aiResult.fitPoints).slice(0, 4);
        const frictionPoints = asStringArray(aiResult.frictionPoints).slice(0, 3);

        if (!summary) {
            return json({ error: 'AI response did not include a summary.' }, 500);
        }

        return json({ summary, fitPoints, frictionPoints });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown fit breakdown error.';
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
        `Gender: ${profile.gender}`,
        `DOB: ${profile.dob}`,
        `Location: ${profile.location}`,
        `Height: ${profile.height_cm ?? ''}`,
        `Profile owner: ${profile.profile_owner ?? ''}`,
        `Bio: ${profile.bio ?? ''}`,
        `Preferences: ${profile.preferences ?? ''}`,
    ].join('\n');
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