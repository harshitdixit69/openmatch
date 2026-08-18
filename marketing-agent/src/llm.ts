import OpenAI from 'openai';
import { config } from './config.js';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * Calls the configured LLM and returns a parsed JSON object.
 *
 * Provider resolution mirrors the edge function (`_shared/azureChat.ts`):
 *   1. Cisco Enterprise AI when CISCO_CLIENT_ID + CISCO_CLIENT_SECRET are set
 *      (no OpenAI key required — same creds as the deployed functions).
 *   2. OpenAI otherwise (OPENAI_API_KEY).
 */
export async function callJson<T = Record<string, unknown>>(
    messages: ChatMessage[],
    maxTokens = 900,
): Promise<T> {
    const raw = config.hasCisco
        ? await callCiscoChat(messages, maxTokens)
        : await callOpenAiChat(messages, maxTokens);

    return parseJsonObject<T>(raw);
}

// ---------------------------------------------------------------------------
// OpenAI (fallback)
// ---------------------------------------------------------------------------
let _openai: OpenAI | null = null;
function openaiClient(): OpenAI {
    if (!_openai) _openai = new OpenAI({ apiKey: config.openaiApiKey });
    return _openai;
}

async function callOpenAiChat(messages: ChatMessage[], maxTokens: number): Promise<string> {
    const completion = await openaiClient().chat.completions.create({
        model: config.openaiModel,
        messages,
        max_tokens: maxTokens,
        temperature: 0.8,
        response_format: { type: 'json_object' },
    });
    return completion.choices[0]?.message?.content ?? '{}';
}

// ---------------------------------------------------------------------------
// Cisco Enterprise AI (preferred)
// ---------------------------------------------------------------------------
let cachedCiscoToken: { token: string; expiresAt: number } | null = null;

async function getCiscoAccessToken(): Promise<string> {
    const now = Date.now();
    if (cachedCiscoToken && cachedCiscoToken.expiresAt > now + 60_000) {
        return cachedCiscoToken.token;
    }

    const basic = Buffer.from(`${config.ciscoClientId}:${config.ciscoClientSecret}`).toString('base64');
    const response = await fetch(config.ciscoTokenUrl, {
        method: 'POST',
        headers: {
            Accept: '*/*',
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basic}`,
        },
        body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
        throw new Error(`Cisco token request failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
        throw new Error('Cisco token response did not include an access_token.');
    }

    const ttlSeconds = Number(data.expires_in) || 3600;
    cachedCiscoToken = { token: data.access_token, expiresAt: now + ttlSeconds * 1000 };
    return data.access_token;
}

async function callCiscoChat(messages: ChatMessage[], maxTokens: number): Promise<string> {
    const token = await getCiscoAccessToken();
    const url = `${config.ciscoBaseUrl}/openai/deployments/${encodeURIComponent(config.ciscoDeployment)}/chat/completions`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'api-key': token,
        },
        // Cisco's proxy does not support response_format; JSON is requested via
        // the prompt and extracted defensively by parseJsonObject().
        body: JSON.stringify({
            messages,
            max_tokens: maxTokens,
            temperature: 0.8,
            user: JSON.stringify({ appkey: config.ciscoAppKey }),
            stop: ['<|im_end|>'],
        }),
    });

    if (!response.ok) {
        throw new Error(`Cisco chat request failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '{}';
}

// ---------------------------------------------------------------------------
// Shared JSON extraction
// ---------------------------------------------------------------------------
function parseJsonObject<T>(raw: string): T {
    try {
        return JSON.parse(raw) as T;
    } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]) as T;
        throw new Error('LLM did not return valid JSON.');
    }
}
