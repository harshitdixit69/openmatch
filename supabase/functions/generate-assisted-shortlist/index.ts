import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callTextChat } from '../_shared/azureChat.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SourcingRequestPayload = {
    user_id?: string;
    session_id?: string;
};

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const env = getEnv();
        const authHeader = request.headers.get('Authorization');
        
        let userId = '';
        let sessionId = '';
        let isAuthorized = false;

        // Create admin client for session lookup and updates
        const adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        // 1. Check Service Role Key Authorization
        if (authHeader === `Bearer ${env.supabaseServiceRoleKey}`) {
            isAuthorized = true;
            // Service Role call, read from request body
            const body = (await request.json().catch(() => ({}))) as SourcingRequestPayload;
            userId = body.user_id ?? '';
            sessionId = body.session_id ?? '';
        } else if (authHeader) {
            // User JWT validation
            const userClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
                auth: { persistSession: false },
                global: { headers: { Authorization: authHeader } },
            });

            const { data: { user }, error: userError } = await userClient.auth.getUser();
            if (!userError && user) {
                userId = user.id;
                isAuthorized = true;

                // Query their active session ID
                const { data: activeSession, error: activeSessionError } = await adminClient
                    .from('assisted_concierge_sessions')
                    .select('id')
                    .eq('user_id', userId)
                    .eq('status', 'AWAITING_SHORTLIST')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (!activeSessionError && activeSession) {
                    sessionId = activeSession.id;
                } else {
                    return json({ error: 'No active AWAITING_SHORTLIST session found for this user.' }, 400);
                }
            }
        }

        if (!isAuthorized || !userId || !sessionId) {
            return json({ error: 'Unauthorized request or missing parameters.' }, 401);
        }

        // 2. Fetch user's intake notes
        const { data: sessionData, error: sessionFetchError } = await adminClient
            .from('assisted_concierge_sessions')
            .select('intake_notes')
            .eq('id', sessionId)
            .single();

        if (sessionFetchError || !sessionData) {
            return json({ error: 'Failed to retrieve session intake notes.' }, 404);
        }

        const intakeNotes = sessionData.intake_notes || '';
        if (!intakeNotes.trim()) {
            return json({ error: 'Intake interview notes are empty. Finish the intake first.' }, 400);
        }

        // 3. Call get_sourcing_candidates RPC
        const { data: candidates, error: rpcError } = await adminClient.rpc('get_sourcing_candidates', {
            p_user_id: userId,
            p_limit: 5,
        });

        if (rpcError) {
            return json({ error: `Failed to fetch match candidates: ${rpcError.message}` }, 500);
        }

        if (!candidates || candidates.length === 0) {
            return json({ error: 'No match candidates found matching your filters.' }, 404);
        }

        // 4. Generate Match Rationales & Insert/Update Shortlist Transactionally
        // Insert Shortlist header
        const { data: shortlist, error: shortlistError } = await adminClient
            .from('assisted_shortlists')
            .upsert({
                user_id: userId,
                session_id: sessionId,
                status: 'active',
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'user_id,session_id',
            })
            .select('id')
            .single();

        if (shortlistError || !shortlist) {
            return json({ error: `Failed to create shortlist header: ${shortlistError?.message}` }, 500);
        }

        const itemsToInsert = [];

        for (const candidate of candidates) {
            const occupation = candidate.occupation || 'Not specified';
            const education = candidate.education || 'Not specified';
            const diet = candidate.diet || 'Not specified';
            const smokes = candidate.smokes !== null ? (candidate.smokes ? 'Yes' : 'No') : 'Not specified';
            const drinks_alcohol = candidate.drinks_alcohol !== null ? (candidate.drinks_alcohol ? 'Yes' : 'No') : 'Not specified';

            const candidateContext = `Name: ${candidate.full_name}
Location: ${candidate.location}
Age: ${dateToAge(candidate.dob)}
Bio: ${candidate.bio || 'Not specified'}
Profession: ${occupation}
Education: ${education}
Diet: ${diet}
Smokes: ${smokes}
Drinks: ${drinks_alcohol}`;

            // Generate Pitch using LLM
            const systemPrompt = "You are an empathetic, warm, world-class Dedicated Relationship Manager (RM) at OpenMatch, an elite matrimonial matchmaking service.";
            const userPrompt = `I need you to write a warm, highly personalized 2-3 sentence match rationale/pitch explaining specifically why I curated this candidate for the user. 
Speak directly to the user (e.g. "I hand-selected [Candidate Name] for you because...").
Use their intake notes to explain how their lifestyles, expectations, or personalities align.

[USER'S CONCIERGE INTAKE NOTES]
${intakeNotes}

[CANDIDATE PROFILE DETAILS]
${candidateContext}

Match rationale pitch:`;

            let matchRationale = '';
            try {
                matchRationale = await callTextChat({
                    apiKey: env.azureApiKey,
                    apiVersion: env.azureApiVersion,
                    endpoint: env.azureEndpoint,
                    deployment: env.azureChatDeployment,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    maxTokens: 250,
                    temperature: 0.5,
                });
            } catch (err) {
                console.error(`Error generating LLM pitch for ${candidate.full_name}:`, err);
                matchRationale = `I hand-selected ${candidate.full_name} for you because they are a strong match for your preferences and live in ${candidate.location}.`;
            }

            itemsToInsert.push({
                shortlist_id: shortlist.id,
                candidate_id: candidate.id,
                match_score: candidate.match_score,
                match_rationale: matchRationale,
                feedback_status: 'pending',
            });
        }

        // Bulk insert shortlist items
        const { error: itemsError } = await adminClient
            .from('assisted_shortlist_items')
            .upsert(itemsToInsert, {
                onConflict: 'shortlist_id,candidate_id',
            });

        if (itemsError) {
            return json({ error: `Failed to insert shortlist items: ${itemsError.message}` }, 500);
        }

        // Update concierge session status to SHORTLIST_READY
        const { error: sessionUpdateError } = await adminClient
            .from('assisted_concierge_sessions')
            .update({
                status: 'SHORTLIST_READY',
                updated_at: new Date().toISOString(),
            })
            .eq('id', sessionId);

        if (sessionUpdateError) {
            return json({ error: `Failed to update concierge session status: ${sessionUpdateError.message}` }, 500);
        }

        return json({
            success: true,
            shortlist_id: shortlist.id,
            status: 'SHORTLIST_READY',
            itemsCount: itemsToInsert.length,
        });

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown shortlist generation error.';
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

function dateToAge(dobString: string): number {
    if (!dobString) return 30;
    const dob = new Date(dobString);
    const diff = Date.now() - dob.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
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
