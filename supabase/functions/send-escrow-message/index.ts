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

        const { data: block, error: blockError } = await admin
            .from('user_blocks')
            .select('id')
            .or(`and(blocker_id.eq.${match.user_1_id},blocked_id.eq.${match.user_2_id}),and(blocker_id.eq.${match.user_2_id},blocked_id.eq.${match.user_1_id})`)
            .maybeSingle();

        if (blockError) {
            return json({ error: blockError.message }, 500);
        }

        if (block) {
            return json({ error: 'Match not found.' }, 404);
        }

        const unlocked = Boolean(match.is_unlocked);

        // Contact details are held in escrow until both participants unlock the
        // match. While locked, detect attempts to share direct contact info or
        // move the conversation off-platform, and flag the message so the
        // recipient's client can keep it hidden until unlock.
        let blocked = false;
        if (!unlocked) {
            // Fetch recent messages in this match to analyze multi-message circumvention
            const { data: recentMessages, error: recentError } = await admin
                .from('messages')
                .select('content, sender_id')
                .eq('match_id', match.id)
                .order('created_at', { ascending: false })
                .limit(10);

            if (recentError) {
                console.warn('Failed to load recent messages for history check:', recentError);
            }

            // Extract consecutive messages from the same sender (ending if other participant replied)
            const consecutiveContents: string[] = [content];
            if (recentMessages) {
                for (const msg of recentMessages) {
                    if (msg.sender_id === user.id) {
                        consecutiveContents.push(msg.content);
                    } else {
                        break;
                    }
                }
            }

            const combinedContent = consecutiveContents.reverse().join(' ');
            blocked = await detectContactSharing(combinedContent, env);
        }

        // When blocked, store a redacted placeholder instead of the raw
        // contact info so even a direct DB read cannot leak the details.
        const storedContent = blocked
            ? await redactPII(content, env)
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
            piiDetected: blocked,
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
                        'You are a moderation classifier for a matrimonial app\'s pre-unlock escrow chat. Participants may only exchange direct contact details after both unlock the match. Check if the text (which may be a combination of consecutive messages) shares or requests direct contact details (phone, email, social handles, or external chat apps like WhatsApp/Instagram/Telegram). Specifically flag circumvention attempts, such as: 1) writing numbers in words (e.g., "nine eight seven...", "eight two one"), 2) writing numbers in Roman numerals (e.g., "Viii ii i", "IX VIII VII"), or 3) splitting a number across lines/messages. Return only JSON of the form {"sharesContact": true|false}.',
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

function normalizeText(text: string): string {
    // Convert fullwidth digits (０-９) to standard digits (0-9)
    let normalized = text.replace(/[\uff10-\uff19]/g, (ch) => {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    });

    // Arabic-Indic digits (٠-٩) -> U+0660 to U+0669
    normalized = normalized.replace(/[\u0660-\u0669]/g, (ch) => {
        return String.fromCharCode(ch.charCodeAt(0) - 0x0660 + 48);
    });

    // Eastern Arabic-Indic digits (۰-۹) -> U+06f0 to U+06f9
    normalized = normalized.replace(/[\u06f0-\u06f9]/g, (ch) => {
        return String.fromCharCode(ch.charCodeAt(0) - 0x06f0 + 48);
    });

    // Devanagari digits (०-९) -> U+0966 to U+096f
    normalized = normalized.replace(/[\u0966-\u096f]/g, (ch) => {
        return String.fromCharCode(ch.charCodeAt(0) - 0x0966 + 48);
    });

    return normalized;
}

function countDigitIndicators(text: string): number {
    const normalized = normalizeText(text);
    
    // First, count all actual digits (0-9) in the normalized text
    const digitsCount = normalized.match(/\d/g)?.length ?? 0;
    
    // Tokenize the normalized text to check for spelled-out words and Roman numerals
    const tokens = normalized.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    
    const numberWords = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']);
    const multiRoman = new Set(['viii', 'vii', 'iii', 'ii', 'iv', 'vi', 'ix']);
    
    // Helper to check if a token at a given index is a candidate
    const isCandidate = (idx: number): boolean => {
        if (idx < 0 || idx >= tokens.length) return false;
        const token = tokens[idx];
        return /\d/.test(token) || numberWords.has(token) || multiRoman.has(token);
    };
    
    let wordAndRomanCount = 0;
    
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        
        // If it's a digit token, we already counted its digits using the global regex
        if (/\d/.test(token)) {
            continue;
        }
        
        if (multiRoman.has(token)) {
            // Multi-character Roman numerals are rare enough in common English to always count
            wordAndRomanCount++;
            continue;
        }
        
        if (numberWords.has(token)) {
            // For spelled-out number words, only count them if they are near another candidate
            // (within a distance of 2 tokens: i-2, i-1, i+1, i+2)
            let hasNearbyCandidate = false;
            for (const offset of [-2, -1, 1, 2]) {
                if (isCandidate(i + offset)) {
                    hasNearbyCandidate = true;
                    break;
                }
            }
            if (hasNearbyCandidate) {
                wordAndRomanCount++;
            }
        }
    }
    
    return digitsCount + wordAndRomanCount;
}

function detectContactSharingDeterministic(content: string): boolean {
    const normalized = normalizeText(content);

    if (EMAIL_PATTERN.test(normalized) || HANDLE_PATTERN.test(normalized) || APP_PATTERN.test(normalized) || INTENT_PATTERN.test(normalized)) {
        return true;
    }

    if (countDigitIndicators(normalized) >= 7) {
        return true;
    }

    return containsPhoneNumber(normalized);
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

async function redactPII(content: string, env: ReturnType<typeof getEnv>): Promise<string> {
    const deterministic = deterministicRedact(content);
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
                        'You are a redact tool for a matrimonial app. Your job is to replace any phone numbers, email addresses, social media handles, or messaging app info with the exact token "[Contact Details Hidden]". Keep all other words and structure exactly the same. Return a JSON object of the form {"redactedText": "..."}.',
                },
                {
                    role: 'user',
                    content: `Message:\n${content}`,
                },
            ],
        });

        if (aiResult.redactedText && aiResult.redactedText.includes('[Contact Details Hidden]')) {
            return aiResult.redactedText;
        }
        return deterministic;
    } catch (_error) {
        return deterministic;
    }
}

function deterministicRedact(content: string): string {
    let text = content;
    // Replace emails
    text = text.replace(EMAIL_PATTERN, '[Contact Details Hidden]');
    // Replace social handles
    text = text.replace(HANDLE_PATTERN, (match) => {
        const prefix = match.match(/^\s/);
        return (prefix ? prefix[0] : '') + '@[Contact Details Hidden]';
    });
    // Replace app patterns
    text = text.replace(APP_PATTERN, '[Contact Details Hidden]');
    // Replace phone numbers/runs of 7+ digits
    const candidatePattern = /\+?\d(?:[\d\s\-().]{5,}\d)/g;
    text = text.replace(candidatePattern, '[Contact Details Hidden]');
    
    if (text === content) {
        return '[Contact Details Hidden]';
    }
    return text;
}
