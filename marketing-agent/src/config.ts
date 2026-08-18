import 'dotenv/config';

function required(name: string): string {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(`Missing required env var: ${name} (copy .env.example to .env and fill it in)`);
    }
    return value.trim();
}

function optional(name: string, fallback = ''): string {
    return (process.env[name] ?? fallback).trim();
}

/**
 * Lazy config: required vars are only validated when first accessed, so
 * `help` and other no-secret paths work without a populated .env.
 */
export const config = {
    get supabaseUrl() {
        return required('SUPABASE_URL');
    },
    get supabaseServiceRoleKey() {
        return required('SUPABASE_SERVICE_ROLE_KEY');
    },
    get openaiApiKey() {
        return required('OPENAI_API_KEY');
    },
    get openaiModel() {
        return optional('OPENAI_MODEL', 'gpt-4o-mini');
    },
    // ── Cisco Enterprise AI (preferred; same creds as the edge functions) ──
    // When CISCO_CLIENT_ID + CISCO_CLIENT_SECRET are set, the agent uses Cisco
    // and OPENAI_API_KEY is not required.
    get ciscoClientId() {
        return optional('CISCO_CLIENT_ID');
    },
    get ciscoClientSecret() {
        return optional('CISCO_CLIENT_SECRET');
    },
    get ciscoTokenUrl() {
        return optional('CISCO_TOKEN_URL', 'https://id.cisco.com/oauth2/default/v1/token');
    },
    get ciscoBaseUrl() {
        return optional('CISCO_AI_BASE_URL', 'https://chat-ai.cisco.com').replace(/\/+$/, '');
    },
    get ciscoDeployment() {
        return optional('CISCO_AI_DEPLOYMENT', 'gemini-3.1-flash-lite');
    },
    get ciscoAppKey() {
        return optional('CISCO_APP_KEY');
    },
    get hasCisco() {
        return Boolean(optional('CISCO_CLIENT_ID') && optional('CISCO_CLIENT_SECRET'));
    },
    get aggregatorUrl() {
        return optional('MARKETING_AGGREGATOR_URL');
    },
    get aggregatorKey() {
        return optional('MARKETING_AGGREGATOR_KEY');
    },
    get appStoreUrl() {
        return optional('APP_STORE_URL');
    },
    get playStoreUrl() {
        return optional('PLAY_STORE_URL');
    },
};

export type AppConfig = typeof config;
