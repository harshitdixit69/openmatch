import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { callAzureJsonChat, hasChatProvider } from '../_shared/azureChat.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ProfileVariantRequest = {
    full_name?: string;
    gender?: string;
    partner_gender_preference?: string;
    dob?: string;
    location?: string;
    bio?: string;
    preferences?: string;
    height_cm?: number;
    profile_owner?: string;
    tone?: 'witty' | 'sincere' | 'balanced';
    refinement?: string;
    section?: 'bio' | 'preferences';
};

const TONE_PROMPTS: Record<string, string> = {
    witty: 'Write in a warm, witty, and slightly playful tone. Use light humour and clever phrasing that shows personality without being flippant. The result should feel approachable and memorable.',
    sincere: 'Write in a sincere, heartfelt, and grounded tone. Use direct, honest language that conveys genuine warmth and seriousness about finding a life partner. Avoid clichés.',
    balanced: 'Write in a balanced, confident, and natural tone. Mix warmth with clarity. The result should feel authentic — neither too formal nor too casual — like a thoughtful friend introducing them.',
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

        const payload = (await request.json()) as ProfileVariantRequest;
        if (!payload.full_name?.trim() || !payload.location?.trim()) {
            return json({ error: 'full_name and location are required.' }, 400);
        }

        const tone = payload.tone ?? 'balanced';
        const toneInstruction = TONE_PROMPTS[tone] ?? TONE_PROMPTS.balanced;
        const refinement = payload.refinement?.trim() ?? '';
        const section = payload.section;

        let systemPrompt =
            'You are an expert profile ghostwriter for a matrimonial app. ' +
            toneInstruction + ' ';

        if (section === 'bio') {
            systemPrompt +=
                'Rewrite ONLY the bio section (3-5 sentences). Return JSON with keys: bio, summary. ' +
                'summary should be 1 sentence explaining the direction.';
        } else if (section === 'preferences') {
            systemPrompt +=
                'Rewrite ONLY the partner preferences section (3-5 sentences). Return JSON with keys: preferences, summary. ' +
                'summary should be 1 sentence explaining the direction.';
        } else {
            systemPrompt +=
                'Rewrite the user draft into a respectful, clear, and authentic profile. ' +
                'Return JSON with keys: bio, preferences, summary. ' +
                'bio should be 3-5 sentences. preferences should be 3-5 sentences. ' +
                'summary should be 1 sentence explaining the profile direction.';
        }

        if (refinement) {
            systemPrompt += ` The user also asked: "${refinement}". Apply this refinement to the output.`;
        }

        const userContent = [
            `Full name: ${payload.full_name ?? ''}`,
            `Gender: ${payload.gender ?? ''}`,
            `Looking for a: ${payload.partner_gender_preference ?? ''}`,
            `Date of birth: ${payload.dob ?? ''}`,
            `Location: ${payload.location ?? ''}`,
            `Profile owner: ${payload.profile_owner ?? ''}`,
            `Height (cm): ${typeof payload.height_cm === 'number' ? payload.height_cm : ''}`,
            `Current bio draft: ${payload.bio ?? ''}`,
            `Current partner preferences draft: ${payload.preferences ?? ''}`,
        ].join('\n');

        const aiResult = await callAzureJsonChat({
            apiKey: env.azureApiKey,
            apiVersion: env.azureApiVersion,
            endpoint: env.azureEndpoint,
            deployment: env.chatDeployment,
            maxTokens: 800,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent },
            ],
        });

        const bio = asString(aiResult.bio);
        const preferences = asString(aiResult.preferences);
        const summary = asString(aiResult.summary);

        if (section === 'bio' && !bio) {
            return json({ error: 'AI response was incomplete for bio section.' }, 500);
        }
        if (section === 'preferences' && !preferences) {
            return json({ error: 'AI response was incomplete for preferences section.' }, 500);
        }
        if (!section && (!bio || !preferences)) {
            return json({ error: 'AI response was incomplete.' }, 500);
        }

        return json({ bio, preferences, summary, tone });
    } catch (error: any) {
        const message = error?.message || error?.details || String(error);
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

    return { supabaseUrl, supabaseAnonKey, azureApiKey, azureApiVersion, azureEndpoint, chatDeployment };
}

function asString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
