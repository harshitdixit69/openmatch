type AzureChatMessage = {
    role: string;
    content: string;
};

type ChatConnection = {
    apiKey?: string;
    apiVersion?: string;
    endpoint?: string;
    deployment?: string;
};

// ---------------------------------------------------------------------------
// Provider resolution: Cisco Enterprise AI (preferred) or Azure OpenAI (fallback)
// ---------------------------------------------------------------------------

type CiscoConfig = {
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
    baseUrl: string;
    deployment: string;
    appKey: string;
};

/**
 * Reads Cisco Enterprise AI configuration from the environment.
 * Returns null when the required Cisco secrets are not set, so callers can
 * transparently fall back to Azure OpenAI.
 */
export function getCiscoConfig(): CiscoConfig | null {
    const clientId = Deno.env.get('CISCO_CLIENT_ID');
    const clientSecret = Deno.env.get('CISCO_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
        return null;
    }

    return {
        clientId,
        clientSecret,
        tokenUrl: Deno.env.get('CISCO_TOKEN_URL') ?? 'https://id.cisco.com/oauth2/default/v1/token',
        baseUrl: (Deno.env.get('CISCO_AI_BASE_URL') ?? 'https://chat-ai.cisco.com').replace(/\/+$/, ''),
        deployment: Deno.env.get('CISCO_AI_DEPLOYMENT') ?? 'gemini-3.1-flash-lite',
        appKey: Deno.env.get('CISCO_APP_KEY') ?? '',
    };
}

/**
 * Returns true when at least one chat provider (Cisco or Azure OpenAI) is
 * configured. Edge functions use this to validate configuration without
 * failing when only one provider's secrets are present.
 */
export function hasChatProvider(): boolean {
    if (getCiscoConfig()) {
        return true;
    }

    const azureApiKey = Deno.env.get('AZURE_OPENAI_API_KEY');
    const azureEndpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT');
    const chatDeployment = Deno.env.get('AZURE_OPENAI_CHAT_DEPLOYMENT');
    return Boolean(azureApiKey && azureEndpoint && chatDeployment);
}

// ---------------------------------------------------------------------------
// Cisco access-token minting (cached across warm invocations)
// ---------------------------------------------------------------------------

let cachedCiscoToken: { token: string; expiresAt: number } | null = null;

async function getCiscoAccessToken(config: CiscoConfig): Promise<string> {
    const now = Date.now();
    // Reuse the cached token until 60s before expiry to avoid mid-request expiry.
    if (cachedCiscoToken && cachedCiscoToken.expiresAt > now + 60_000) {
        return cachedCiscoToken.token;
    }

    const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
            Accept: '*/*',
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
        },
        body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cisco token request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const token = typeof data?.access_token === 'string' ? data.access_token : '';
    if (!token) {
        throw new Error('Cisco token response did not include an access_token.');
    }

    const ttlSeconds = Number(data?.expires_in) || 3600;
    cachedCiscoToken = { token, expiresAt: now + ttlSeconds * 1000 };
    return token;
}

// ---------------------------------------------------------------------------
// Low-level chat completion (returns raw assistant text for either provider)
// ---------------------------------------------------------------------------

export async function callChatCompletion({
    apiKey,
    apiVersion,
    endpoint,
    deployment,
    messages,
    maxTokens = 500,
    temperature = 0.3,
    jsonMode = false,
}: ChatConnection & {
    messages: AzureChatMessage[];
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
}): Promise<string> {
    const cisco = getCiscoConfig();

    let url: string;
    let headers: Record<string, string>;
    let body: Record<string, unknown>;

    if (cisco) {
        const token = await getCiscoAccessToken(cisco);
        url = `${cisco.baseUrl}/openai/deployments/${encodeURIComponent(cisco.deployment)}/chat/completions`;
        headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'api-key': token,
        };
        // Cisco's Gemini proxy does not support response_format; JSON is requested
        // via the system prompt and extracted defensively by parseJsonObject().
        body = {
            messages,
            max_tokens: maxTokens,
            temperature,
            user: JSON.stringify({ appkey: cisco.appKey }),
            stop: ['<|im_end|>'],
        };
    } else {
        if (!apiKey || !endpoint || !deployment) {
            throw new Error('No AI chat provider configured (set CISCO_* or AZURE_OPENAI_* secrets).');
        }

        const normalizedEndpoint = endpoint.replace(/\/+$/, '');
        headers = {
            'api-key': apiKey,
            'Content-Type': 'application/json',
        };

        const baseBody: Record<string, unknown> = {
            messages,
            max_completion_tokens: maxTokens,
            temperature,
        };
        if (jsonMode) {
            baseBody.response_format = { type: 'json_object' };
        }

        if (normalizedEndpoint.endsWith('/openai/v1')) {
            url = `${normalizedEndpoint}/chat/completions`;
            body = { model: deployment, ...baseBody };
        } else {
            url = `${normalizedEndpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion ?? '2025-01-01-preview')}`;
            body = baseBody;
        }
    }

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${cisco ? 'Cisco' : 'Azure'} chat request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const rawText = extractMessageText(data);
    if (!rawText.trim()) {
        throw new Error('Chat response did not include any content.');
    }

    return rawText;
}

// ---------------------------------------------------------------------------
// JSON chat — parses the assistant text into an object (backwards-compatible API)
// ---------------------------------------------------------------------------

export async function callAzureJsonChat({
    apiKey,
    apiVersion,
    endpoint,
    deployment,
    messages,
    maxTokens = 500,
}: ChatConnection & {
    messages: AzureChatMessage[];
    maxTokens?: number;
}): Promise<Record<string, unknown>> {
    const rawText = await callChatCompletion({
        apiKey,
        apiVersion,
        endpoint,
        deployment,
        messages,
        maxTokens,
        jsonMode: true,
    });

    const parsed = parseJsonObject(rawText);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Chat response did not include valid JSON output.');
    }

    return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Plain-text chat — returns trimmed assistant text (for summary-style outputs)
// ---------------------------------------------------------------------------

export async function callTextChat({
    apiKey,
    apiVersion,
    endpoint,
    deployment,
    messages,
    maxTokens = 200,
    temperature = 0.4,
}: ChatConnection & {
    messages: AzureChatMessage[];
    maxTokens?: number;
    temperature?: number;
}): Promise<string> {
    const rawText = await callChatCompletion({
        apiKey,
        apiVersion,
        endpoint,
        deployment,
        messages,
        maxTokens,
        temperature,
    });

    return rawText.trim();
}

function extractMessageText(data: unknown) {
    if (!data || typeof data !== 'object' || !('choices' in data) || !Array.isArray(data.choices)) {
        return '';
    }

    const firstChoice = data.choices[0];
    const content = firstChoice?.message?.content;

    return Array.isArray(content)
        ? content
            .map((part) => {
                if (typeof part === 'string') {
                    return part;
                }

                if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
                    return part.text;
                }

                return '';
            })
            .join(' ')
        : typeof content === 'string'
            ? content
            : '';
}

function parseJsonObject(text: string) {
    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
            return null;
        }

        try {
            return JSON.parse(match[0]);
        } catch {
            return null;
        }
    }
}