import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { callTextChat, hasChatProvider } from '../_shared/azureChat.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type CompatibilityRequest = {
    candidateProfileId?: string;
};

type CompatibilityProfile = {
    id: string;
    full_name: string;
    bio: string | null;
    preferences: string | null;
    location: string;
    profile_owner: string | null;
};

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        const azureApiKey = Deno.env.get('AZURE_OPENAI_API_KEY');
        const azureApiVersion = Deno.env.get('AZURE_OPENAI_API_VERSION') ?? '2025-01-01-preview';
        const azureEndpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT');
        const chatDeployment = Deno.env.get('AZURE_OPENAI_CHAT_DEPLOYMENT');
        const authHeader = request.headers.get('Authorization');

        if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !hasChatProvider()) {
            return json(
                {
                    error:
                        'Missing SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, or an AI chat provider (set CISCO_* or AZURE_OPENAI_* secrets).',
                },
                500,
            );
        }

        if (!authHeader) {
            return json({ error: 'Missing Authorization header.' }, 401);
        }

        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
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

        const payload = (await request.json()) as CompatibilityRequest;
        const candidateProfileId = payload.candidateProfileId?.trim();

        if (!candidateProfileId) {
            return json({ error: 'Missing candidateProfileId.' }, 400);
        }

        if (candidateProfileId === user.id) {
            return json({ error: 'Cannot generate compatibility for the same profile.' }, 400);
        }

        const [user1Id, user2Id] = [user.id, candidateProfileId].sort();

        const admin = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false },
        });

        const { data: cachedSnapshot, error: cachedError } = await admin
            .from('compatibility_snapshots')
            .select('summary')
            .eq('user_1_id', user1Id)
            .eq('user_2_id', user2Id)
            .maybeSingle();

        if (cachedError) {
            throw cachedError;
        }

        if (cachedSnapshot?.summary) {
            return json({ summary: normalizeSummary(cachedSnapshot.summary), cached: true });
        }

        const { data: profiles, error: profilesError } = await admin
            .from('profiles')
            .select('id, full_name, bio, preferences, location, profile_owner')
            .in('id', [user.id, candidateProfileId]);

        if (profilesError) {
            throw profilesError;
        }

        const viewerProfile = profiles?.find((profile) => profile.id === user.id) as CompatibilityProfile | undefined;
        const candidateProfile = profiles?.find(
            (profile) => profile.id === candidateProfileId,
        ) as CompatibilityProfile | undefined;

        if (!viewerProfile || !candidateProfile) {
            return json({ error: 'Could not load both profiles for comparison.' }, 404);
        }

        const summary = await generateCompatibilitySummary({
            apiKey: azureApiKey,
            apiVersion: azureApiVersion,
            endpoint: azureEndpoint,
            deployment: chatDeployment,
            viewerProfile,
            candidateProfile,
        });

        const { error: upsertError } = await admin.from('compatibility_snapshots').upsert(
            {
                user_1_id: user1Id,
                user_2_id: user2Id,
                summary,
                updated_at: new Date().toISOString(),
            },
            {
                onConflict: 'user_1_id,user_2_id',
            },
        );

        if (upsertError) {
            throw upsertError;
        }

        return json({ summary, cached: false });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown compatibility summary error.';
        return json({ error: message }, 500);
    }
});

async function generateCompatibilitySummary({
    apiKey,
    apiVersion,
    endpoint,
    deployment,
    viewerProfile,
    candidateProfile,
}: {
    apiKey?: string;
    apiVersion?: string;
    endpoint?: string;
    deployment?: string;
    viewerProfile: CompatibilityProfile;
    candidateProfile: CompatibilityProfile;
}) {
    const rawSummary = await callTextChat({
        apiKey,
        apiVersion,
        endpoint,
        deployment,
        maxTokens: 160,
        temperature: 0.4,
        messages: [
            {
                role: 'system',
                content:
                    'You are an expert matchmaker. Read Profile A and Profile B. Return exactly two plain-text sentences, no bullets, no markdown, no labels, and no quotation marks. The first sentence should describe one concrete shared trait or value. The second sentence should describe one complementary trait or practical point of alignment that makes a first conversation promising. Be positive but realistic.',
            },
            {
                role: 'user',
                content: [buildProfileSummary('Profile A', viewerProfile), buildProfileSummary('Profile B', candidateProfile)].join('\n\n'),
            },
        ],
    });

    const summary = normalizeSummary(rawSummary);

    if (!summary) {
        throw new Error('Compatibility response did not include summary text.');
    }

    return summary;
}

function buildProfileSummary(label: string, profile: CompatibilityProfile) {
    return [
        `${label} name: ${profile.full_name}`,
        `${label} location: ${profile.location}`,
        `${label} profile owner: ${profile.profile_owner ?? 'self'}`,
        `${label} bio: ${profile.bio ?? 'Not provided.'}`,
        `${label} preferences: ${profile.preferences ?? 'Not provided.'}`,
    ].join('\n');
}

function normalizeSummary(summary: string) {
    const cleaned = summary.replace(/^"|"$/g, '').replace(/\s+/g, ' ').trim();
    const sentences = cleaned
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean)
        .map((sentence) => ensureSentenceTerminator(sentence))
        .slice(0, 2);

    if (sentences.length === 0) {
        return '';
    }

    if (sentences.length === 1) {
        sentences.push('A first conversation should feel grounded because the match shows clear intent and enough overlap to explore further.');
    }

    return sentences.join(' ');
}

function ensureSentenceTerminator(sentence: string) {
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
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