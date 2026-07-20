import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callTextChat } from '../_shared/azureChat.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ChatRequestPayload = {
    candidate_id?: string;
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
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

        // 1. Get authenticated user
        const userClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
            auth: { persistSession: false },
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: userError } = await userClient.auth.getUser();
        if (userError || !user) {
            return json({ error: 'Unauthorized request.' }, 401);
        }

        const body = (await request.json().catch(() => ({}))) as ChatRequestPayload;
        const candidateId = body.candidate_id;
        const chatHistory = body.messages ?? [];

        if (!candidateId) {
            return json({ error: 'Missing candidate_id parameter.' }, 400);
        }

        const adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        // 2. Fetch seeker profile and intake notes
        const { data: seeker, error: seekerErr } = await adminClient
            .from('profiles')
            .select('full_name')
            .eq('id', user.id)
            .single();

        if (seekerErr || !seeker) {
            return json({ error: 'Seeker profile not found.' }, 404);
        }

        const { data: session, error: sessionErr } = await adminClient
            .from('assisted_concierge_sessions')
            .select('intake_notes')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        const intakeNotes = session?.intake_notes || 'Not specified';

        // 3. Fetch candidate profile details
        const { data: candidate, error: candidateErr } = await adminClient
            .from('profiles')
            .select('*')
            .eq('id', candidateId)
            .single();

        if (candidateErr || !candidate) {
            return json({ error: 'Candidate profile not found.' }, 404);
        }

        // 4. Fetch RM pitch rationale
        const { data: shortlistItems, error: itemsErr } = await adminClient
            .from('assisted_shortlist_items')
            .select(`
                match_rationale,
                assisted_shortlists (
                    user_id
                )
            `)
            .eq('candidate_id', candidateId);

        const activeShortlistItem = (shortlistItems || []).find((item: any) =>
            item.assisted_shortlists && item.assisted_shortlists.user_id === user.id
        );
        const matchRationale = activeShortlistItem?.match_rationale || 'Not specified';

        // 5. Build system prompt with all context
        const age = candidate.dob
            ? Math.floor((Date.now() - new Date(candidate.dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
            : 30;

        const occupation = candidate.occupation || 'Not specified';
        const education = candidate.education || 'Not specified';
        const diet = candidate.diet || 'Not specified';
        const smokes = candidate.smokes !== null ? (candidate.smokes ? 'Yes' : 'No') : 'Not specified';
        const drinks_alcohol = candidate.drinks_alcohol !== null ? (candidate.drinks_alcohol ? 'Yes' : 'No') : 'Not specified';

        const systemPrompt = `You are the Dedicated AI Relationship Manager (RM) for OpenMatch, a premium matrimonial matchmaking service. The user (Seeker), ${seeker.full_name}, is reviewing candidate ${candidate.full_name}'s profile and wants to discuss their compatibility.

Your goal is to help ${seeker.full_name} evaluate ${candidate.full_name} by answering questions about compatibility, lifestyle, career balance, values, and in-law expectations.

[SEEKER SOFT PREFERENCES (INTAKE NOTES)]
${intakeNotes}

[CANDIDATE DETAILS]
Name: ${candidate.full_name}
Age: ${age}
Location: ${candidate.location}
Bio: ${candidate.bio || 'Not specified'}
Profession: ${occupation}
Education: ${education}
Diet: ${diet}
Smokes: ${smokes}
Drinks: ${drinks_alcohol}
Looking For: ${candidate.preferences || 'Not specified'}

[YOUR ORIGINAL MATCH RATIONALE PITCH]
${matchRationale}

Rules:
1. Maintain a warm, empathetic, and professional Dedicated RM persona.
2. Rely strictly on the Seeker's preferences and Candidate's details to evaluate alignment or friction points.
3. Be honest and balanced: call out strong alignments (e.g. both vegetarian, both career-focused) but also note any potential friction points or details they should ask the candidate about.
4. Keep responses concise (3-4 sentences max) to keep the chat highly readable.`;

        // 6. Call Azure OpenAI Completions
        const messages = [
            { role: 'system', content: systemPrompt },
            ...chatHistory.map(m => ({ role: m.role, content: m.content }))
        ];

        const reply = await callTextChat({
            apiKey: env.azureApiKey,
            apiVersion: env.azureApiVersion,
            endpoint: env.azureEndpoint,
            deployment: env.azureChatDeployment,
            messages,
            maxTokens: 300,
            temperature: 0.6,
        });

        return json({ reply });

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown chat error.';
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
    const azureChatDeployment = Deno.env.get('AZURE_OPENAI_CHAT_DEPLOYMENT');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !azureChatDeployment) {
        throw new Error(
            'Missing SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, or Azure chat deployment.',
        );
    }

    return {
        supabaseUrl,
        supabaseAnonKey,
        supabaseServiceRoleKey,
        azureApiKey,
        azureApiVersion,
        azureEndpoint,
        azureChatDeployment,
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
