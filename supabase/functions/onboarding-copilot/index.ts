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
    religion?: string;
    marital_status?: string;
    education?: string;
    diet?: string;
    mother_tongue?: string;
    income_band?: string;
    occupation?: string;
    company?: string;
    family_type?: string;
    family_status?: string;
    num_siblings?: number;
    drinks_alcohol?: boolean;
    smokes?: boolean;
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
            maxTokens: 800,
            messages: [
                {
                    role: 'system',
                    content:
                        'You are an expert matrimonial profile ghostwriter and AI copilot. Rewrite the user\'s details into a highly personalized, articulate, warm, and authentic matrimonial profile. Incorporate their career, education, religion, cultural background, family values, and lifestyle naturally. Return ONLY valid JSON with keys: "bio", "preferences", "summary", and "missingTopics".\n- bio: 3-5 complete, engaging sentences covering their career, personality, family background, and values.\n- preferences: 3-5 specific, thoughtful sentences describing their ideal partner, shared values, and life vision.\n- summary: 1 crisp sentence summarizing the profile strengths.\n- missingTopics: Array of 0-3 short prompt strings for details they could add.',
                },
                {
                    role: 'user',
                    content: [
                        `Full name: ${payload.full_name ?? ''}`,
                        `Gender: ${payload.gender ?? ''}`,
                        `Looking for a: ${payload.partner_gender_preference ?? ''}`,
                        `Date of birth: ${payload.dob ?? ''}`,
                        `Location: ${payload.location ?? ''}`,
                        `Profile managed by: ${payload.profile_owner ?? 'self'}`,
                        `Height (cm): ${typeof payload.height_cm === 'number' ? payload.height_cm : ''}`,
                        `Religion: ${payload.religion ?? ''}`,
                        `Mother tongue: ${payload.mother_tongue ?? ''}`,
                        `Education: ${payload.education ?? ''}`,
                        `Occupation / Designation: ${payload.occupation ?? ''}`,
                        `Company / Employer: ${payload.company ?? ''}`,
                        `Annual Income Band: ${payload.income_band ?? ''}`,
                        `Marital Status: ${payload.marital_status ?? ''}`,
                        `Family Type: ${payload.family_type ?? ''}`,
                        `Family Status: ${payload.family_status ?? ''}`,
                        `Number of Siblings: ${typeof payload.num_siblings === 'number' ? payload.num_siblings : ''}`,
                        `Diet: ${payload.diet ?? ''}`,
                        `Drinking: ${payload.drinks_alcohol === false ? 'No / Never' : payload.drinks_alcohol === true ? 'Yes / Socially' : 'Not specified'}`,
                        `Smoking: ${payload.smokes === false ? 'No / Never' : payload.smokes === true ? 'Yes / Socially' : 'Not specified'}`,
                        `Current bio notes: ${payload.bio ?? ''}`,
                        `Current partner preferences notes: ${payload.preferences ?? ''}`,
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