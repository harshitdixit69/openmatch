// supabase/functions/send-push/index.ts
//
// Relays an in-app notification to the user's registered devices through the
// Expo Push API (which in turn talks to APNs / FCM).
//
// Invoked server-to-server by the `trg_notifications_push` trigger with the
// service-role key. It is NOT meant to be called by end-user clients.
//
// Payload (from the trigger):
//   {
//     notification_id: string,
//     user_id: string,
//     type: string,
//     title: string,
//     body: string,
//     metadata: Record<string, unknown>
//   }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

type PushPayload = {
    notification_id?: string;
    user_id?: string;
    type?: string;
    title?: string;
    body?: string;
    metadata?: Record<string, unknown>;
};

type TokenRow = { token: string };

type ExpoMessage = {
    to: string;
    title: string;
    body: string;
    sound: 'default';
    data: Record<string, unknown>;
    channelId: 'default';
};

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    }
    return { supabaseUrl, serviceRoleKey };
}

/** Only accept calls whose bearer token is a valid service_role JWT. */
function isAuthorized(request: Request): boolean {
    const auth = request.headers.get('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    if (!token) return false;
    try {
        const payloadPart = token.split('.')[1];
        if (!payloadPart) return false;
        // base64url -> JSON. The Functions gateway already verified the signature
        // is valid for this project, so a role check is sufficient here.
        const padded = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
        const json = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
        const claims = JSON.parse(json) as { role?: string };
        return claims.role === 'service_role';
    } catch {
        return false;
    }
}

async function sendExpoBatch(messages: ExpoMessage[]): Promise<unknown> {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
    });
    return res.json().catch(() => ({}));
}

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const env = getEnv();

        if (!isAuthorized(request)) {
            return json({ error: 'Unauthorized.' }, 401);
        }

        const payload = (await request.json()) as PushPayload;
        if (!payload.user_id || !payload.title || !payload.body) {
            return json({ error: 'user_id, title and body are required.' }, 400);
        }

        const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
            auth: { persistSession: false },
        });

        // Fetch enabled device tokens for this user.
        const { data: tokens, error: tokenErr } = await admin
            .from('push_tokens')
            .select('token')
            .eq('user_id', payload.user_id)
            .eq('enabled', true)
            .returns<TokenRow[]>();

        if (tokenErr) {
            return json({ error: tokenErr.message }, 500);
        }
        if (!tokens || tokens.length === 0) {
            return json({ sent: 0, reason: 'no_tokens' });
        }

        const data = {
            notification_id: payload.notification_id ?? null,
            type: payload.type ?? 'system',
            ...(payload.metadata ?? {}),
        };

        const messages: ExpoMessage[] = tokens.map((t) => ({
            to: t.token,
            title: payload.title!,
            body: payload.body!,
            sound: 'default',
            channelId: 'default',
            data,
        }));

        // Expo accepts up to 100 messages per request.
        const chunks: ExpoMessage[][] = [];
        for (let i = 0; i < messages.length; i += 100) {
            chunks.push(messages.slice(i, i + 100));
        }
        const receipts = await Promise.all(chunks.map(sendExpoBatch));

        return json({ sent: messages.length, receipts });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unexpected error.';
        return json({ error: message }, 500);
    }
});
