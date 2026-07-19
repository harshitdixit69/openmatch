import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateEmbedding } from '../_shared/embedding.ts';


const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ProfileWebhookPayload = {
    type?: 'INSERT' | 'UPDATE' | 'DELETE';
    record?: {
        id?: string;
        bio?: string | null;
        preferences?: string | null;
        location?: string | null;
        profile_owner?: string | null;
    };
    old_record?: {
        id?: string;
        bio?: string | null;
        preferences?: string | null;
        location?: string | null;
        profile_owner?: string | null;
    };
};

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const payload = (await request.json()) as ProfileWebhookPayload;
        const profile = payload.record;
        const previousProfile = payload.old_record;

        if (!profile?.id) {
            return json({ error: 'Missing profile id in webhook payload.' }, 400);
        }

        if (
            payload.type === 'UPDATE' &&
            previousProfile &&
            !hasEmbeddingInputsChanged(profile, previousProfile)
        ) {
            return json({
                skipped: true,
                reason: 'Embedding inputs did not change, skipping recursive update.',
            });
        }

        const sourceText = buildEmbeddingSource(profile);
        if (!sourceText.trim()) {
            return json({ skipped: true, reason: 'No profile text available for embedding.' });
        }

        const azureApiKey = Deno.env.get('AZURE_OPENAI_API_KEY');
        const azureApiVersion = Deno.env.get('AZURE_OPENAI_API_VERSION') ?? '2025-01-01-preview';
        const azureEndpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT');
        const embeddingDeployment = Deno.env.get('AZURE_OPENAI_EMBEDDING_DEPLOYMENT');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (
            !azureApiKey ||
            !azureEndpoint ||
            !embeddingDeployment ||
            !supabaseUrl ||
            !serviceRoleKey
        ) {
            return json(
                {
                    error:
                        'Missing AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_EMBEDDING_DEPLOYMENT, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY.',
                },
                500,
            );
        }

        const embedding = await generateEmbedding({
            apiKey: azureApiKey,
            apiVersion: azureApiVersion,
            endpoint: azureEndpoint,
            deployment: embeddingDeployment,
            input: sourceText,
        });

        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false },
        });

        const { error } = await supabase
            .from('profiles')
            .update({ embedding })
            .eq('id', profile.id);

        if (error) {
            throw error;
        }

        return json({ success: true, profileId: profile.id });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown embedding error.';
        return json({ error: message }, 500);
    }
});

function buildEmbeddingSource(profile: NonNullable<ProfileWebhookPayload['record']>) {
    return [
        profile.bio ?? '',
        profile.preferences ?? '',
        profile.location ?? '',
        profile.profile_owner ?? '',
    ]
        .map((part) => part.trim())
        .filter(Boolean)
        .join('\n');
}

function hasEmbeddingInputsChanged(
    nextProfile: NonNullable<ProfileWebhookPayload['record']>,
    previousProfile: NonNullable<ProfileWebhookPayload['old_record']>,
) {
    return (
        normalizePart(nextProfile.bio) !== normalizePart(previousProfile.bio) ||
        normalizePart(nextProfile.preferences) !== normalizePart(previousProfile.preferences) ||
        normalizePart(nextProfile.location) !== normalizePart(previousProfile.location) ||
        normalizePart(nextProfile.profile_owner) !== normalizePart(previousProfile.profile_owner)
    );
}

function normalizePart(value: string | null | undefined) {
    return (value ?? '').trim();
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
