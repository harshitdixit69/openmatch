import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

async function generateEmbedding({
    apiKey,
    apiVersion,
    endpoint,
    deployment,
    input,
}: {
    apiKey: string;
    apiVersion: string;
    endpoint: string;
    deployment: string;
    input: string;
}) {
    const request = buildEmbeddingsRequest(endpoint, apiVersion, deployment);

    const response = await fetch(request.url, {
        method: 'POST',
        headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request.body(input)),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Azure embedding request failed: ${errorText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data?.data) || !Array.isArray(data.data[0]?.embedding)) {
        throw new Error('Azure embedding response did not include a valid embedding vector.');
    }

    return data.data[0].embedding as number[];
}

function buildEmbeddingsUrl(endpoint: string, apiVersion: string) {
    const normalizedEndpoint = endpoint.replace(/\/+$/, '');

    if (normalizedEndpoint.endsWith('/openai/v1')) {
        return normalizedEndpoint;
    }

    return `${normalizedEndpoint}/openai/deployments`;
}

function buildEmbeddingsRequest(endpoint: string, apiVersion: string, deployment: string) {
    const normalizedBaseUrl = buildEmbeddingsUrl(endpoint, apiVersion);

    if (normalizedBaseUrl.endsWith('/openai/v1')) {
        return {
            url: `${normalizedBaseUrl}/embeddings`,
            body: (input: string) => ({
                model: deployment,
                input: [input],
            }),
        };
    }

    const encodedDeployment = encodeURIComponent(deployment);

    return {
        url: `${normalizedBaseUrl}/${encodedDeployment}/embeddings?api-version=${encodeURIComponent(apiVersion)}`,
        body: (input: string) => ({
            input: [input],
        }),
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
