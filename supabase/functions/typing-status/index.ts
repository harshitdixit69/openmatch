import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Edge Function: typing-status
 *
 * Thin wrapper around the `set_typing_indicator` and `clear_typing_indicator`
 * Postgres RPC functions.  The React Native client already calls these RPCs
 * directly via `supabase.rpc(...)`, so this Edge Function exists only as a
 * REST-callable alternative (e.g. for web clients or external integrations).
 *
 * POST body:
 *   { "matchId": "<uuid>", "action": "set" | "clear" }
 */

type TypingStatusPayload = {
    matchId?: string;
    action?: 'set' | 'clear';
};

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

        if (!supabaseUrl || !supabaseAnonKey) {
            return json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY.' }, 500);
        }

        const authHeader = request.headers.get('Authorization') ?? '';
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
            auth: { persistSession: false },
        });

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return json({ error: 'Not authenticated.' }, 401);
        }

        const body: TypingStatusPayload = await request.json().catch(() => ({}));
        const matchId = body.matchId;
        const action = body.action ?? 'set';

        if (!matchId) {
            return json({ error: 'matchId is required.' }, 400);
        }

        if (action === 'clear') {
            const { error } = await supabase.rpc('clear_typing_indicator', { p_match_id: matchId });
            if (error) throw error;
            return json({ cleared: true, matchId });
        }

        const { error } = await supabase.rpc('set_typing_indicator', { p_match_id: matchId });
        if (error) throw error;
        return json({ set: true, matchId });
    } catch (error: any) {
        const message = error?.message || error?.details || String(error);
        return json({ error: message }, 500);
    }
});

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
