import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callAzureJsonChat, hasChatProvider } from '../_shared/azureChat.ts';
import { generateEmbedding } from '../_shared/embedding.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type IntakeChatRequest = {
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

        // Create user-scoped Supabase client to verify authorization
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

        // Create admin client for session lookup and updates
        const adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        // Verify active concierge session
        const { data: session, error: sessionError } = await adminClient
            .from('assisted_concierge_sessions')
            .select('id, status')
            .eq('user_id', user.id)
            .eq('status', 'INTAKE_IN_PROGRESS')
            .maybeSingle();

        if (sessionError || !session) {
            return json({ error: 'No active intake session.' }, 403);
        }

        const payload = (await request.json()) as IntakeChatRequest;
        const messages = payload.messages ?? [];

        // Dynamic Interview system prompt
        const systemPrompt = `You are an AI Relationship Manager (RM) for OpenMatch, a premium matrimonial matchmaking service. You are conducting a deep-dive intake interview with a new Assisted-tier subscriber to understand their soft preferences — nuances that structured profile fields cannot capture.

Your goal is to extract preferences across these dimensions:
- Lifestyle & daily routine (morning person vs night owl, travel habits, social energy)
- Family dynamics & expectations (joint vs nuclear family, in-law involvement, parenting)
- Communication style & conflict resolution approach
- Career ambitions vs family priorities balance
- Cultural flexibility (traditional vs progressive outlook)
- Deal-breakers beyond religion/caste/education
- Emotional compatibility signals (attachment style, love languages)
- Long-term vision (ideal city, financial goals, retirement dreams)

Rules:
1. Ask ONE question at a time. Be warm, professional, and non-judgmental.
2. Acknowledge and build on previous answers before asking the next question.
3. After 8-12 exchanges, provide a comprehensive summary of what you've captured and ask if they'd like to add or change anything.
4. When the user confirms they are satisfied and the interview is complete, respond with EXACTLY this JSON format:
   {"status": "COMPLETE", "summary": "<comprehensive paragraph summarizing all soft preferences>"}
5. Until the interview is complete, respond with EXACTLY this JSON format:
   {"status": "IN_PROGRESS", "message": "<your next question or acknowledgment>"}
6. ALWAYS respond in valid JSON using one of the two formats above. No other format is acceptable.`;

        const userMessages = messages.map(m => ({ role: m.role, content: m.content }));
        if (userMessages.length === 0) {
            userMessages.push({ role: 'user', content: 'Hello, please start the interview.' });
        }

        const chatMessages = [
            { role: 'system', content: systemPrompt },
            ...userMessages
        ];

        // Call AI Chat Completion
        const aiResult = await callAzureJsonChat({
            apiKey: env.azureApiKey,
            apiVersion: env.azureApiVersion,
            endpoint: env.azureEndpoint,
            deployment: env.chatDeployment,
            maxTokens: 800,
            messages: chatMessages,
        });

        const status = aiResult.status as string;

        if (status === 'COMPLETE') {
            const summary = aiResult.summary as string;
            if (!summary?.trim()) {
                return json({ error: 'AI completed session but did not return a valid summary.' }, 500);
            }

            // Generate vector embedding of the soft preferences summary
            const embedding = await generateEmbedding({
                apiKey: env.azureApiKey,
                apiVersion: env.azureApiVersion,
                endpoint: env.azureEndpoint,
                deployment: env.embeddingDeployment,
                input: summary,
            });

            // Update session status to INTAKE_COMPLETE and store summary & embedding
            const { error: updateError } = await adminClient
                .from('assisted_concierge_sessions')
                .update({
                    status: 'INTAKE_COMPLETE',
                    intake_notes: summary,
                    intake_embedding: embedding,
                    intake_completed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', session.id);

            if (updateError) {
                throw updateError;
            }

            return json({
                status: 'COMPLETE',
                message: summary,
                summary,
                sessionId: session.id,
            });
        } else if (status === 'IN_PROGRESS') {
            const message = aiResult.message as string;
            if (!message?.trim()) {
                return json({ error: 'AI returned IN_PROGRESS but missing message.' }, 500);
            }
            return json({
                status: 'IN_PROGRESS',
                message,
            });
        } else {
            return json({ error: 'AI response was incomplete.' }, 500);
        }
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
    const chatDeployment = Deno.env.get('AZURE_OPENAI_CHAT_DEPLOYMENT');
    const embeddingDeployment = Deno.env.get('AZURE_OPENAI_EMBEDDING_DEPLOYMENT');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !hasChatProvider() || !embeddingDeployment) {
        throw new Error(
            'Missing SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, embedding deployment, or a chat provider.',
        );
    }

    return {
        supabaseUrl,
        supabaseAnonKey,
        supabaseServiceRoleKey,
        azureApiKey,
        azureApiVersion,
        azureEndpoint,
        chatDeployment,
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
