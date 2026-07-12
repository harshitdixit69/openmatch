import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { callAzureJsonChat, hasChatProvider } from '../_shared/azureChat.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SendEscrowMessagePayload = {
    matchId?: string;
    content?: string;
};

type MatchRow = {
    id: string;
    user_1_id: string;
    user_2_id: string;
    status: string;
    is_unlocked: boolean;
};

type MessageRow = {
    id: string;
    match_id: string;
    sender_id: string;
    content: string;
    is_flagged_by_system: boolean;
    read_at: string | null;
    created_at: string;
};

const MAX_MESSAGE_LENGTH = 2000;

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

        const payload = (await request.json()) as SendEscrowMessagePayload;
        const matchId = payload.matchId?.trim();
        const content = payload.content?.trim();

        if (!matchId) {
            return json({ error: 'Missing matchId.' }, 400);
        }

        if (!content) {
            return json({ error: 'Message content is required.' }, 400);
        }

        if (content.length > MAX_MESSAGE_LENGTH) {
            return json({ error: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.` }, 400);
        }

        const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
            auth: { persistSession: false },
        });

        const { data: match, error: matchError } = await admin
            .from('matches')
            .select('id, user_1_id, user_2_id, status, is_unlocked')
            .eq('id', matchId)
            .single<MatchRow>();

        if (matchError || !match) {
            return json({ error: 'Match not found.' }, 404);
        }

        const isParticipant = match.user_1_id === user.id || match.user_2_id === user.id;
        if (!isParticipant) {
            return json({ error: 'You are not allowed to message in this match.' }, 403);
        }

        const unlocked = Boolean(match.is_unlocked);

        // Contact details are held in escrow until both participants unlock the
        // match. While locked, detect attempts to share direct contact info or
        // move the conversation off-platform, and flag the message so the
        // recipient's client can keep it hidden until unlock.
        let blocked = false;
        if (!unlocked) {
            blocked = await detectContactSharing(content, env);
        }

        // When blocked, store a redacted placeholder instead of the raw
        // contact info so even a direct DB read cannot leak the details.
        const storedContent = blocked
            ? '[Contact details blocked until mutual unlock]'
            : content;

        const { data: inserted, error: insertError } = await admin
            .from('messages')
            .insert({
                match_id: match.id,
                sender_id: user.id,
                content: storedContent,
                is_flagged_by_system: blocked,
            })
            .select('id, match_id, sender_id, content, is_flagged_by_system, read_at, created_at')
            .single<MessageRow>();

        if (insertError || !inserted) {
            return json({ error: insertError?.message ?? 'Could not store the message.' }, 500);
        }

        // Notify the other participant about the new message (fire-and-forget).
        const recipientId = match.user_1_id === user.id ? match.user_2_id : match.user_1_id;
        await safeInsertNotification(admin, recipientId, 'message_received', {
            title: 'New message',
            body: blocked ? 'You have a new message.' : storedContent.slice(0, 80),
            metadata: { matchId: match.id, messageId: inserted.id },
        });

        const notice = blocked
            ? 'Contact details stay hidden until you both unlock this match. Your message was sent, but flagged so it stays private for now.'
            : null;

        return json({
            message: inserted,
            blocked,
            notice,
            unlocked,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown escrow message error.';
        return json({ error: message }, 500);
    }
});

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

/**
 * Returns true when the message appears to share direct contact info or push
 * the conversation off-platform. Uses a deterministic detector first, then
 * (best-effort) refines with the AI provider. AI failures are non-fatal — the
 * deterministic result is always returned so a provider hiccup can never block
 * a legitimate send.
 */
async function detectContactSharing(content: string, env: ReturnType<typeof getEnv>): Promise<boolean> {
    const deterministic = detectContactSharingDeterministic(content);
    if (deterministic) {
        return true;
    }

    if (!hasChatProvider()) {
        return deterministic;
    }

    try {
        const aiResult = await callAzureJsonChat({
            apiKey: env.azureApiKey,
            apiVersion: env.azureApiVersion,
            endpoint: env.azureEndpoint,
            deployment: env.chatDeployment,
            maxTokens: 120,
            messages: [
                {
                    role: 'system',
                    content:
                        'You are a moderation classifier for a matrimonial app\'s pre-unlock escrow chat. Participants may only exchange direct contact information after both unlock the match. Decide whether the user\'s message shares or requests direct personal contact details (phone number, email, social handle, or a named external messaging app such as WhatsApp/Telegram/Instagram), or otherwise tries to move the conversation off-platform. Return only JSON of the form {"sharesContact": true|false}.',
                },
                {
                    role: 'user',
                    content: `Message:\n${content}`,
                },
            ],
        });

        return aiResult.sharesContact === true;
    } catch (_error) {
        // Non-fatal: fall back to the deterministic result.
        return deterministic;
    }
}

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const HANDLE_PATTERN = /(?:^|\s)@[a-z0-9_.]{2,}/i;
const APP_PATTERN =
    /\b(whats\s?app|telegram|signal|insta(?:gram)?|snap(?:chat)?|facebook|messenger|discord|wechat|line id|skype|hangouts|imo)\b/i;
const INTENT_PATTERN =
    /\b(my number|call me|text me|ping me|dm me|email me|reach me|contact me at|here'?s my|whats\s?app me|add me on)\b/i;

function detectContactSharingDeterministic(content: string): boolean {
    if (EMAIL_PATTERN.test(content) || HANDLE_PATTERN.test(content) || APP_PATTERN.test(content) || INTENT_PATTERN.test(content)) {
        return true;
    }

    return containsPhoneNumber(content);
}

/**
 * Detects a plausible phone number: a run of digits (optionally grouped by
 * spaces, dashes, dots, or parentheses, with an optional leading +) that
 * contains at least 7 digits.
 */
function containsPhoneNumber(content: string): boolean {
    const candidatePattern = /\+?\d(?:[\d\s\-().]{5,}\d)/g;
    const matches = content.match(candidatePattern);
    if (!matches) {
        return false;
    }

    return matches.some((candidate) => (candidate.match(/\d/g)?.length ?? 0) >= 7);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeInsertNotification(
    serviceClient: ReturnType<typeof createClient>,
    userId: string,
    type: string,
    opts: { title: string; body: string; metadata: Record<string, string> },
) {
    const { error } = await serviceClient.from('notifications').insert({
        user_id: userId,
        type,
        title: opts.title,
        body: opts.body,
        metadata: opts.metadata,
        is_read: false,
    });

    if (error && !/does not exist/i.test(error.message ?? '')) {
        console.warn('safeInsertNotification failed:', error.message);
    }
}

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const azureApiKey = Deno.env.get('AZURE_OPENAI_API_KEY');
    const azureApiVersion = Deno.env.get('AZURE_OPENAI_API_VERSION') ?? '2025-01-01-preview';
    const azureEndpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT');
    const chatDeployment = Deno.env.get('AZURE_OPENAI_CHAT_DEPLOYMENT');

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
        throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.');
    }

    return {
        supabaseUrl,
        supabaseAnonKey,
        serviceRoleKey,
        azureApiKey,
        azureApiVersion,
        azureEndpoint,
        chatDeployment,
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
