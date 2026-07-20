import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateEmbedding } from '../_shared/embedding.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type IntakePayload = {
    transcript?: string;
    text?: string;
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

        // Create user-scoped client to verify token
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

        const payload = (await request.json()) as IntakePayload;
        const transcript = payload.transcript ?? payload.text ?? '';

        if (!transcript.trim()) {
            return json({ error: 'Raw interview transcript is required.' }, 400);
        }

        // Create admin client for profile queries and updates
        const adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        // 1. Fetch user's qualitative profile fields
        const { data: profile, error: fetchProfileError } = await adminClient
            .from('profiles')
            .select('occupation, education, diet, smokes, drinks_alcohol')
            .eq('id', user.id)
            .single();

        if (fetchProfileError) {
            return json({ error: `Failed to fetch profile context: ${fetchProfileError.message}` }, 500);
        }

        const occupation = profile?.occupation || 'Not specified';
        const education = profile?.education || 'Not specified';
        const diet = profile?.diet || 'Not specified';
        const smokes = profile?.smokes !== null && profile?.smokes !== undefined ? (profile.smokes ? 'Yes' : 'No') : 'Not specified';
        const drinks_alcohol = profile?.drinks_alcohol !== null && profile?.drinks_alcohol !== undefined ? (profile.drinks_alcohol ? 'Yes' : 'No') : 'Not specified';

        // 2. Build structured combined text payload
        const combinedPayload = `[QUALITATIVE CONTEXT]
Profession: ${occupation}
Education: ${education}
Diet: ${diet}
Smoking Habit: ${smokes}
Drinking Habit: ${drinks_alcohol}

[CONCIERGE INTERVIEW TRANSCRIPT]
${transcript}`;

        // 3. Generate vector embedding of the combined payload
        const embedding = await generateEmbedding({
            apiKey: env.azureApiKey,
            apiVersion: env.azureApiVersion,
            endpoint: env.azureEndpoint,
            deployment: env.embeddingDeployment,
            input: combinedPayload,
        });

        // Update profiles table
        const { error: profileError } = await adminClient
            .from('profiles')
            .update({
                embedding: embedding,
                membership_tier: 'assisted',
                subscription_tier: 'assisted',
            })
            .eq('id', user.id);

        if (profileError) {
            throw profileError;
        }

        // Update or insert concierge session
        const { error: sessionError } = await adminClient
            .from('assisted_concierge_sessions')
            .upsert({
                user_id: user.id,
                intake_notes: transcript,
                status: 'AWAITING_SHORTLIST',
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'user_id',
            });

        if (sessionError) {
            throw sessionError;
        }

        return json({ success: true, status: 'AWAITING_SHORTLIST' });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown concierge intake error.';
        return json({ error: message }, 500);
    }
});

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const azureApiKey = Deno.env.get('AZURE_OPENAI_API_KEY');
    const azureApiVersion = Deno.env.get('AZURE_OPENAI_API_VERSION') ?? '2025-01-01-preview';
    const azureEndpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT');
    const embeddingDeployment = Deno.env.get('AZURE_OPENAI_EMBEDDING_DEPLOYMENT');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !embeddingDeployment) {
        throw new Error(
            'Missing SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, or embedding deployment.',
        );
    }

    return {
        supabaseUrl,
        supabaseAnonKey,
        supabaseServiceRoleKey,
        azureApiKey,
        azureApiVersion,
        azureEndpoint,
        embeddingDeployment,
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
