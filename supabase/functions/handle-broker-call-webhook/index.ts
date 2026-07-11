import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-broker-signature, x-retell-signature, x-vapi-signature, x-twilio-signature',
};

type HandleBrokerCallWebhookPayload = {
    provider?: 'retell' | 'vapi' | 'twilio';
    eventType?: string;
    providerCallId?: string | null;
    providerMessageId?: string | null;
    status?: 'queued' | 'dialing' | 'in_progress' | 'completed' | 'declined' | 'no_answer' | 'failed' | 'cancelled';
    durationSeconds?: number | null;
    targetProfileId?: string | null;
    requestId?: string | null;
    outcome?: string | null;
    transcript?: string | null;
    summary?: Record<string, unknown>;
    rawPayload?: Record<string, unknown>;
};

type BrokerCallRow = {
    id: string;
    request_id: string;
    status: NonNullable<HandleBrokerCallWebhookPayload['status']> | 'consent_required' | 'consent_granted' | 'queued';
};

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const env = getEnv();
        const rawBody = await request.text();
        const payload = parseWebhookPayload(request, rawBody);
        if (!payload) {
            return json({ error: 'Malformed webhook body.' }, 400);
        }

        if (!payload.provider || !payload.eventType || !payload.status) {
            return json({ error: 'provider, eventType, and status are required.' }, 400);
        }

        if (!(await isWebhookAuthorized(request, env, payload.provider, rawBody))) {
            return json({ error: 'Invalid webhook signature/auth.' }, 401);
        }

        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        const brokerCall = await findBrokerCall(serviceClient, payload);
        if (!brokerCall) {
            return json({ error: 'No matching broker call found.' }, 404);
        }

        if (isTerminalBrokerStatus(brokerCall.status) && brokerCall.status === payload.status) {
            return json({ error: 'Stale or duplicate webhook event.' }, 409);
        }

        const nowIso = new Date().toISOString();
        const nextPatch: Record<string, unknown> = {
            status: payload.status,
            outcome: payload.outcome ?? null,
            transcript: payload.transcript ?? null,
            summary: payload.summary ?? {},
            metadata: {
                eventType: payload.eventType,
                durationSeconds: payload.durationSeconds ?? null,
                rawPayload: payload.rawPayload ?? {},
            },
            provider_call_id: payload.providerCallId ?? null,
            provider_message_id: payload.providerMessageId ?? null,
            last_error: payload.status === 'failed' ? 'provider_reported_failure' : null,
        };

        if (payload.status === 'in_progress') {
            nextPatch.started_at = nowIso;
        }

        if (
            payload.status === 'completed' ||
            payload.status === 'declined' ||
            payload.status === 'no_answer' ||
            payload.status === 'failed' ||
            payload.status === 'cancelled'
        ) {
            nextPatch.ended_at = nowIso;
        }

        const updateResult = await serviceClient
            .from('ai_broker_calls')
            .update(nextPatch)
            .eq('id', brokerCall.id)
            .select('id, request_id, status')
            .single<BrokerCallRow>();

        if (updateResult.error) {
            throw updateResult.error;
        }

        await safeInsertInterestRequestEvent(serviceClient, brokerCall.request_id, null, 'broker_webhook_processed', {
            brokerCallId: brokerCall.id,
            provider: payload.provider,
            eventType: payload.eventType,
            status: payload.status,
            outcome: payload.outcome ?? null,
        });

        const nextAction = deriveNextAction(payload);
        const requestStatus = await handleNextAction(serviceClient, brokerCall.request_id, {
            brokerCallId: brokerCall.id,
            nextAction,
            provider: payload.provider,
            outcome: payload.outcome ?? null,
            summary: payload.summary ?? {},
        });

        return json({
            processed: true,
            brokerCallId: brokerCall.id,
            status: payload.status,
            nextAction,
            requestStatus,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown handle-broker-call-webhook error.';
        return json({ error: message }, 500);
    }
});

async function findBrokerCall(serviceClient: ReturnType<typeof createClient>, payload: HandleBrokerCallWebhookPayload) {
    if (payload.providerCallId) {
        const byCallId = await serviceClient
            .from('ai_broker_calls')
            .select('id, request_id, status')
            .eq('provider_call_id', payload.providerCallId)
            .maybeSingle<BrokerCallRow>();

        if (byCallId.error && !isMissingDatabaseObject(byCallId.error.message)) {
            throw byCallId.error;
        }

        if (byCallId.data) {
            return byCallId.data;
        }
    }

    if (payload.providerMessageId) {
        const byMessageId = await serviceClient
            .from('ai_broker_calls')
            .select('id, request_id, status')
            .eq('provider_message_id', payload.providerMessageId)
            .maybeSingle<BrokerCallRow>();

        if (byMessageId.error && !isMissingDatabaseObject(byMessageId.error.message)) {
            throw byMessageId.error;
        }

        if (byMessageId.data) {
            return byMessageId.data;
        }
    }

    if (payload.requestId && payload.targetProfileId) {
        const byRequestTarget = await serviceClient
            .from('ai_broker_calls')
            .select('id, request_id, status')
            .eq('request_id', payload.requestId)
            .eq('target_profile_id', payload.targetProfileId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle<BrokerCallRow>();

        if (byRequestTarget.error && !isMissingDatabaseObject(byRequestTarget.error.message)) {
            throw byRequestTarget.error;
        }

        if (byRequestTarget.data) {
            return byRequestTarget.data;
        }
    }

    return null;
}

async function safeInsertInterestRequestEvent(
    serviceClient: ReturnType<typeof createClient>,
    requestId: string,
    actorId: string | null,
    eventType: string,
    payload: Record<string, unknown>,
) {
    const { error } = await serviceClient.from('interest_request_events').insert({
        request_id: requestId,
        actor_id: actorId,
        event_type: eventType,
        payload,
    });

    if (error && !isMissingDatabaseObject(error.message)) {
        throw error;
    }
}

async function postBrokerClosureMessage(
    serviceClient: ReturnType<typeof createClient>,
    requestId: string,
    brokerCallId: string,
    summary: Record<string, unknown>,
) {
    // Look up the thread + participants for this request.
    const requestResult = await serviceClient
        .from('interest_requests')
        .select('match_id, sender_id, receiver_id')
        .eq('id', requestId)
        .maybeSingle<{ match_id: string | null; sender_id: string; receiver_id: string }>();

    if (requestResult.error) {
        if (isMissingDatabaseObject(requestResult.error.message)) {
            return;
        }
        throw requestResult.error;
    }

    const matchId = requestResult.data?.match_id ?? null;
    if (!matchId) {
        return;
    }

    // The broker called the target participant; relay their decision from their profile.
    const callResult = await serviceClient
        .from('ai_broker_calls')
        .select('target_profile_id')
        .eq('id', brokerCallId)
        .maybeSingle<{ target_profile_id: string | null }>();

    if (callResult.error && !isMissingDatabaseObject(callResult.error.message)) {
        throw callResult.error;
    }

    const relaySenderId = callResult.data?.target_profile_id ?? requestResult.data?.receiver_id ?? null;
    if (!relaySenderId) {
        return;
    }

    const noteFromSummary = typeof summary?.note === 'string' && summary.note.trim()
        ? ` They shared: "${summary.note.trim()}"`
        : '';

    const content =
        `OpenMatch broker update: they let us know they can't continue this match right now, so this request has been closed.${noteFromSummary}`;

    const { error: insertError } = await serviceClient.from('messages').insert({
        match_id: matchId,
        sender_id: relaySenderId,
        content,
        is_flagged_by_system: false,
    });

    if (insertError && !isMissingDatabaseObject(insertError.message)) {
        throw insertError;
    }
}

async function handleNextAction(
    serviceClient: ReturnType<typeof createClient>,
    requestId: string,
    args: {
        brokerCallId: string;
        nextAction: 'notify_counterparty' | 'mutual_unlock_prompt' | 'schedule_call' | 'close_request' | 'none';
        provider: NonNullable<HandleBrokerCallWebhookPayload['provider']>;
        outcome: string | null;
        summary: Record<string, unknown>;
    },
) {
    const { brokerCallId, nextAction, provider, outcome, summary } = args;

    if (nextAction === 'none') {
        return 'accepted';
    }

    if (nextAction === 'close_request') {
        const { error } = await serviceClient
            .from('interest_requests')
            .update({
                status: 'closed',
            })
            .eq('id', requestId)
            .in('status', ['accepted', 'ghosted']);

        if (error && !isMissingDatabaseObject(error.message)) {
            throw error;
        }

        await safeInsertInterestRequestEvent(serviceClient, requestId, null, 'broker_request_closed', {
            brokerCallId,
            provider,
            outcome,
            summary,
        });

        await postBrokerClosureMessage(serviceClient, requestId, brokerCallId, summary);

        return 'closed';
    }

    const channel = nextAction === 'schedule_call'
        ? 'broker_schedule_call'
        : nextAction === 'mutual_unlock_prompt'
            ? 'broker_mutual_unlock_prompt'
            : 'broker_notify_counterparty';

    await ensureFollowupJob(serviceClient, requestId, 'broker', channel, {
        brokerCallId,
        provider,
        outcome,
        summary,
    });

    await safeInsertInterestRequestEvent(serviceClient, requestId, null, `${channel}_queued`, {
        brokerCallId,
        provider,
        outcome,
        summary,
    });

    return 'accepted';
}

async function ensureFollowupJob(
    serviceClient: ReturnType<typeof createClient>,
    requestId: string,
    provider: string,
    channel: string,
    payload: Record<string, unknown>,
) {
    const existing = await serviceClient
        .from('ai_followup_jobs')
        .select('id')
        .eq('request_id', requestId)
        .eq('channel', channel)
        .in('status', ['queued', 'completed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();

    if (!existing.error && existing.data) {
        return false;
    }

    if (existing.error && isMissingDatabaseObject(existing.error.message)) {
        return false;
    }

    if (existing.error) {
        throw existing.error;
    }

    const { error } = await serviceClient.from('ai_followup_jobs').insert({
        request_id: requestId,
        provider,
        channel,
        status: 'queued',
        payload,
    });

    if (error && !isMissingDatabaseObject(error.message)) {
        throw error;
    }

    return !error;
}

function deriveNextAction(payload: HandleBrokerCallWebhookPayload) {
    if (payload.status !== 'completed') {
        return 'none' as const;
    }

    const intent = normalizeIntentValue(payload.summary?.intent, payload.outcome ?? null);
    const preferredContactMode = normalizeIntentValue(payload.summary?.preferredContactMode, null);

    if (intent && /decline|closed|stop|not[_\s-]?interested|pause/.test(intent)) {
        return 'close_request' as const;
    }

    if (preferredContactMode && /unlock|contact|whatsapp_after_unlock|call_after_unlock/.test(preferredContactMode)) {
        return 'mutual_unlock_prompt' as const;
    }

    if (preferredContactMode && /schedule|call|availability/.test(preferredContactMode)) {
        return 'schedule_call' as const;
    }

    if (intent && /continue|interested|resume|wants_to_continue|user_wants_to_continue/.test(intent)) {
        return 'notify_counterparty' as const;
    }

    return 'none' as const;
}

function normalizeIntentValue(summaryValue: unknown, fallback: string | null) {
    if (typeof summaryValue === 'string' && summaryValue.trim()) {
        return summaryValue.trim().toLowerCase();
    }

    return fallback?.trim().toLowerCase() ?? null;
}

async function isWebhookAuthorized(
    request: Request,
    env: ReturnType<typeof getEnv>,
    provider: NonNullable<HandleBrokerCallWebhookPayload['provider']>,
    rawBody: string,
) {
    // Shared-secret token passed in the webhook URL query string (e.g.
    // ...?token=SECRET). We set this token when we hand Retell/Twilio the per-call
    // webhook_url, so we don't have to reverse-engineer each provider's signature scheme.
    if (env.brokerWebhookSecret) {
        try {
            const urlToken = new URL(request.url).searchParams.get('token')?.trim();
            if (urlToken && safeCompare(urlToken, env.brokerWebhookSecret)) {
                return true;
            }
        } catch (_error) {
            // Ignore malformed URLs and fall through to the other auth methods.
        }
    }

    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (token && token === env.supabaseServiceRoleKey) {
        return true;
    }

    if (token && env.brokerWebhookSecret && safeCompare(token, env.brokerWebhookSecret)) {
        return true;
    }

    const signature = request.headers.get('x-broker-signature');
    if (env.brokerWebhookSecret && signature && safeCompare(signature, env.brokerWebhookSecret)) {
        return true;
    }

    const providerSecret = getProviderSecret(env, provider);
    if (!providerSecret) {
        return false;
    }

    if (provider === 'twilio') {
        return await validateTwilioWebhookSignature(request, rawBody, providerSecret);
    }

    const providerHeaderSignatures = getProviderSignatureHeaders(request, provider);

    for (const incoming of providerHeaderSignatures) {
        if (safeCompare(incoming, providerSecret)) {
            return true;
        }

        const normalized = normalizeSignature(incoming);
        for (const value of normalized) {
            if (safeCompare(value, providerSecret)) {
                return true;
            }
        }
    }

    const hmac = await computeHmacSha256(rawBody, providerSecret);
    for (const incoming of providerHeaderSignatures) {
        const normalized = normalizeSignature(incoming);
        for (const value of normalized) {
            if (safeCompare(value, hmac.hex) || safeCompare(value, hmac.base64)) {
                return true;
            }
        }
    }

    return false;
}

function getProviderSignatureHeaders(
    request: Request,
    provider: NonNullable<HandleBrokerCallWebhookPayload['provider']>,
) {
    const providerSpecificHeader = provider === 'retell'
        ? request.headers.get('x-retell-signature')
        : provider === 'vapi'
            ? request.headers.get('x-vapi-signature')
            : request.headers.get('x-twilio-signature');

    return [providerSpecificHeader, request.headers.get('x-broker-signature')]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim());
}

function getProviderSecret(
    env: ReturnType<typeof getEnv>,
    provider: NonNullable<HandleBrokerCallWebhookPayload['provider']>,
) {
    if (provider === 'retell') {
        return env.retellWebhookSecret || env.brokerWebhookSecret;
    }

    if (provider === 'vapi') {
        return env.vapiWebhookSecret || env.brokerWebhookSecret;
    }

    return env.twilioWebhookSecret || env.brokerWebhookSecret;
}

function normalizeSignature(signature: string) {
    const trimmed = signature.trim();
    const values = new Set<string>([trimmed]);

    for (const part of trimmed.split(',')) {
        const segment = part.trim();
        if (!segment) {
            continue;
        }

        values.add(segment);

        const separatorIndex = segment.indexOf('=');
        if (separatorIndex > 0 && separatorIndex < segment.length - 1) {
            values.add(segment.slice(separatorIndex + 1).trim());
        }
    }

    return [...values];
}

async function computeHmacSha256(rawBody: string, secret: string) {
    return await computeHmac(rawBody, secret, 'SHA-256');
}

async function computeHmacSha1(value: string, secret: string) {
    return await computeHmac(value, secret, 'SHA-1');
}

async function computeHmac(value: string, secret: string, hash: 'SHA-1' | 'SHA-256') {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        {
            name: 'HMAC',
            hash,
        },
        false,
        ['sign'],
    );

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
    const bytes = new Uint8Array(signature);

    return {
        hex: bytesToHex(bytes),
        base64: bytesToBase64(bytes),
    };
}

async function computeSha256Hex(value: string) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array) {
    return Array.from(bytes)
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
}

function bytesToBase64(bytes: Uint8Array) {
    let binary = '';
    for (const value of bytes) {
        binary += String.fromCharCode(value);
    }

    return btoa(binary);
}

function safeCompare(left: string, right: string) {
    if (left.length !== right.length) {
        return false;
    }

    let mismatch = 0;
    for (let index = 0; index < left.length; index += 1) {
        mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }

    return mismatch === 0;
}

async function validateTwilioWebhookSignature(request: Request, rawBody: string, authToken: string) {
    const incomingSignature = request.headers.get('x-twilio-signature')?.trim();
    if (!incomingSignature) {
        return false;
    }

    const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
    const formPayload = parseUrlEncodedBody(rawBody);

    if (contentType.includes('application/json')) {
        const bodySha = new URL(request.url).searchParams.get('bodySHA256');
        if (bodySha) {
            const computedBodySha = await computeSha256Hex(rawBody);
            if (!safeCompare(computedBodySha.toLowerCase(), bodySha.toLowerCase())) {
                return false;
            }
        }

        const signature = await computeHmacSha1(request.url, authToken);
        return safeCompare(signature.base64, incomingSignature);
    }

    if (!formPayload) {
        return false;
    }

    const signatureBase = buildTwilioSignatureBase(request.url, formPayload);
    const signature = await computeHmacSha1(signatureBase, authToken);
    return safeCompare(signature.base64, incomingSignature);
}

function buildTwilioSignatureBase(url: string, formPayload: Record<string, string[]>) {
    let value = url;

    for (const key of Object.keys(formPayload).sort()) {
        for (const entry of formPayload[key]) {
            value += `${key}${entry}`;
        }
    }

    return value;
}

function parseWebhookPayload(request: Request, rawBody: string): HandleBrokerCallWebhookPayload | null {
    const jsonPayload = safeParseJsonRecord(rawBody);
    const formPayload = parseUrlEncodedBody(rawBody);
    const provider = inferWebhookProvider(request, jsonPayload, formPayload);

    if (provider === 'twilio') {
        return normalizeTwilioWebhookPayload(request, rawBody, formPayload, jsonPayload);
    }

    if (provider === 'vapi') {
        return normalizeVapiWebhookPayload(jsonPayload);
    }

    if (provider === 'retell') {
        return normalizeRetellWebhookPayload(jsonPayload);
    }

    if (jsonPayload) {
        return normalizeGenericWebhookPayload(jsonPayload, provider);
    }

    return formPayload ? normalizeTwilioWebhookPayload(request, rawBody, formPayload, jsonPayload) : null;
}

function safeParseJsonRecord(rawBody: string) {
    try {
        const parsed = JSON.parse(rawBody) as unknown;
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function parseUrlEncodedBody(rawBody: string) {
    const params = new URLSearchParams(rawBody);
    const entries = [...params.entries()];
    if (entries.length === 0) {
        return null;
    }

    const body: Record<string, string[]> = {};
    for (const [key, value] of entries) {
        if (!body[key]) {
            body[key] = [];
        }

        body[key].push(value);
    }

    return body;
}

function inferWebhookProvider(
    request: Request,
    jsonPayload: Record<string, unknown> | null,
    formPayload: Record<string, string[]> | null,
): HandleBrokerCallWebhookPayload['provider'] | null {
    if (request.headers.get('x-twilio-signature')) {
        return 'twilio';
    }

    if (request.headers.get('x-vapi-signature')) {
        return 'vapi';
    }

    if (request.headers.get('x-retell-signature')) {
        return 'retell';
    }

    if (jsonPayload) {
        const provider = asProvider(jsonPayload.provider);
        if (provider) {
            return provider;
        }

        if (isRecord(jsonPayload.message) && asNonEmptyString(jsonPayload.message.type)) {
            return 'vapi';
        }

        if (asNonEmptyString(jsonPayload.call_id) || (isRecord(jsonPayload.call) && asNonEmptyString(jsonPayload.call.call_id))) {
            return 'retell';
        }
    }

    if (formPayload && (formPayload.CallSid || formPayload.MessageSid || formPayload.SmsSid)) {
        return 'twilio';
    }

    return null;
}

function normalizeGenericWebhookPayload(
    jsonPayload: Record<string, unknown>,
    providerHint: HandleBrokerCallWebhookPayload['provider'] | null,
): HandleBrokerCallWebhookPayload | null {
    const provider = asProvider(jsonPayload.provider) ?? providerHint;
    const eventType = asNonEmptyString(jsonPayload.eventType)
        ?? asNonEmptyString(jsonPayload.event_type)
        ?? asNonEmptyString(jsonPayload.type);
    const status = asBrokerStatus(jsonPayload.status);

    if (!provider || !eventType || !status) {
        return null;
    }

    return {
        provider,
        eventType,
        providerCallId: asNonEmptyString(jsonPayload.providerCallId) ?? asNonEmptyString(jsonPayload.provider_call_id),
        providerMessageId: asNonEmptyString(jsonPayload.providerMessageId) ?? asNonEmptyString(jsonPayload.provider_message_id),
        status,
        durationSeconds: asPositiveNumber(jsonPayload.durationSeconds) ?? null,
        targetProfileId: asNonEmptyString(jsonPayload.targetProfileId) ?? asNonEmptyString(jsonPayload.target_profile_id),
        requestId: asNonEmptyString(jsonPayload.requestId) ?? asNonEmptyString(jsonPayload.request_id),
        outcome: asNonEmptyString(jsonPayload.outcome),
        transcript: asNonEmptyString(jsonPayload.transcript),
        summary: isRecord(jsonPayload.summary) ? jsonPayload.summary : {},
        rawPayload: isRecord(jsonPayload.rawPayload) ? jsonPayload.rawPayload : jsonPayload,
    };
}

function normalizeTwilioWebhookPayload(
    request: Request,
    rawBody: string,
    formPayload: Record<string, string[]> | null,
    jsonPayload: Record<string, unknown> | null,
): HandleBrokerCallWebhookPayload | null {
    if (!formPayload) {
        return jsonPayload ? normalizeGenericWebhookPayload(jsonPayload, 'twilio') : null;
    }

    const url = new URL(request.url);
    const providerCallId = getFirstFormValue(formPayload, 'CallSid');
    const providerMessageId = getFirstFormValue(formPayload, 'MessageSid') ?? getFirstFormValue(formPayload, 'SmsSid');
    const callStatus = getFirstFormValue(formPayload, 'CallStatus');
    const messageStatus = getFirstFormValue(formPayload, 'MessageStatus') ?? getFirstFormValue(formPayload, 'SmsStatus');
    const rawPayload = buildSummaryRecord(
        Object.fromEntries(Object.entries(formPayload).map(([key, values]) => [key, values.length > 1 ? values : values[0] ?? null])),
    );

    if (providerCallId) {
        return {
            provider: 'twilio',
            eventType: callStatus ? 'twilio.call.status' : 'twilio.call.webhook',
            providerCallId,
            providerMessageId: null,
            status: mapTwilioVoiceWebhookStatus(callStatus ?? 'queued'),
            durationSeconds: asPositiveNumber(getFirstFormValue(formPayload, 'CallDuration')) ?? null,
            targetProfileId: asNonEmptyString(url.searchParams.get('targetProfileId')),
            requestId: asNonEmptyString(url.searchParams.get('requestId')),
            outcome: callStatus,
            transcript: null,
            summary: buildSummaryRecord({
                callStatus,
                direction: getFirstFormValue(formPayload, 'Direction'),
                callDuration: getFirstFormValue(formPayload, 'CallDuration'),
            }),
            rawPayload,
        };
    }

    if (providerMessageId) {
        return {
            provider: 'twilio',
            eventType: messageStatus ? 'twilio.message.status' : 'twilio.message.webhook',
            providerCallId: null,
            providerMessageId,
            status: mapTwilioMessageWebhookStatus(messageStatus ?? 'queued'),
            durationSeconds: null,
            targetProfileId: asNonEmptyString(url.searchParams.get('targetProfileId')),
            requestId: asNonEmptyString(url.searchParams.get('requestId')),
            outcome: messageStatus,
            transcript: null,
            summary: buildSummaryRecord({
                messageStatus,
                errorCode: getFirstFormValue(formPayload, 'ErrorCode'),
                errorMessage: getFirstFormValue(formPayload, 'ErrorMessage'),
            }),
            rawPayload,
        };
    }

    return null;
}

function normalizeVapiWebhookPayload(jsonPayload: Record<string, unknown> | null): HandleBrokerCallWebhookPayload | null {
    if (!jsonPayload) {
        return null;
    }

    const message = isRecord(jsonPayload.message) ? jsonPayload.message : jsonPayload;
    const call = isRecord(message.call) ? message.call : null;
    const artifact = isRecord(message.artifact) ? message.artifact : null;
    const metadata = getNestedRecord(call, ['metadata']) ?? getNestedRecord(message, ['metadata']);
    const variableValues = getNestedRecord(call, ['assistantOverrides', 'variableValues'])
        ?? getNestedRecord(call, ['assistant', 'assistantOverrides', 'variableValues'])
        ?? getNestedRecord(message, ['assistantOverrides', 'variableValues'])
        ?? getNestedRecord(message, ['assistant', 'assistantOverrides', 'variableValues']);
    const eventType = asNonEmptyString(message.type) ?? 'vapi.webhook';
    const rawStatus = asNonEmptyString(message.status);
    const endedReason = asNonEmptyString(message.endedReason);

    return {
        provider: 'vapi',
        eventType,
        providerCallId: asNonEmptyString(call?.id) ?? asNonEmptyString(call?.phoneCallProviderId) ?? asNonEmptyString(jsonPayload.id),
        providerMessageId: null,
        status: mapVapiWebhookStatus(eventType, rawStatus, endedReason),
        durationSeconds:
            asPositiveNumber(message.durationSeconds)
            ?? asPositiveNumber(call?.durationSeconds)
            ?? ((asPositiveNumber(call?.durationMs) ?? asPositiveNumber(message.durationMs)) ? ((asPositiveNumber(call?.durationMs) ?? asPositiveNumber(message.durationMs)) as number) / 1000 : null),
        targetProfileId: asNonEmptyString(variableValues?.targetProfileId) ?? asNonEmptyString(metadata?.targetProfileId),
        requestId: asNonEmptyString(variableValues?.requestId) ?? asNonEmptyString(metadata?.requestId),
        outcome: endedReason ?? rawStatus,
        transcript: asNonEmptyString(artifact?.transcript) ?? asNonEmptyString(message.transcript),
        summary: buildSummaryRecord({
            status: rawStatus,
            endedReason,
            intent: getNestedString(artifact, ['summary', 'intent']),
            preferredContactMode: getNestedString(artifact, ['summary', 'preferredContactMode']),
        }),
        rawPayload: jsonPayload,
    };
}

function normalizeRetellWebhookPayload(jsonPayload: Record<string, unknown> | null): HandleBrokerCallWebhookPayload | null {
    if (!jsonPayload) {
        return null;
    }

    const call = isRecord(jsonPayload.call) ? jsonPayload.call : jsonPayload;
    const metadata = getNestedRecord(call, ['metadata']) ?? getNestedRecord(jsonPayload, ['metadata']);
    const dynamicVariables = getNestedRecord(call, ['retell_llm_dynamic_variables'])
        ?? getNestedRecord(jsonPayload, ['retell_llm_dynamic_variables']);
    const callAnalysis = getNestedRecord(call, ['call_analysis']) ?? getNestedRecord(jsonPayload, ['call_analysis']);
    const customAnalysis = getNestedRecord(callAnalysis, ['custom_analysis_data']);
    const rawStatus = asNonEmptyString(call.call_status) ?? asNonEmptyString(jsonPayload.call_status) ?? asNonEmptyString(jsonPayload.status);
    const eventType = asNonEmptyString(jsonPayload.event)
        ?? asNonEmptyString(jsonPayload.event_type)
        ?? asNonEmptyString(jsonPayload.type)
        ?? rawStatus
        ?? 'retell.webhook';
    const disconnectionReason = asNonEmptyString(call.disconnection_reason)
        ?? asNonEmptyString(jsonPayload.disconnection_reason)
        ?? asNonEmptyString(jsonPayload.outcome);

    return {
        provider: 'retell',
        eventType,
        providerCallId: asNonEmptyString(call.call_id) ?? asNonEmptyString(jsonPayload.call_id),
        providerMessageId: null,
        status: mapRetellWebhookStatus(rawStatus, eventType, disconnectionReason),
        durationSeconds:
            ((asPositiveNumber(call.duration_ms) ?? asPositiveNumber(jsonPayload.duration_ms))
                ? ((asPositiveNumber(call.duration_ms) ?? asPositiveNumber(jsonPayload.duration_ms)) as number) / 1000
                : null),
        targetProfileId:
            asNonEmptyString(metadata?.targetProfileId)
            ?? asNonEmptyString(metadata?.target_profile_id),
        requestId:
            asNonEmptyString(metadata?.requestId)
            ?? asNonEmptyString(metadata?.request_id)
            ?? asNonEmptyString(dynamicVariables?.broker_request_id),
        outcome: disconnectionReason,
        transcript: asNonEmptyString(call.transcript) ?? asNonEmptyString(jsonPayload.transcript),
        summary: buildSummaryRecord({
            callSummary: getNestedString(callAnalysis, ['call_summary']),
            userSentiment: getNestedString(callAnalysis, ['user_sentiment']),
            intent: getNestedString(customAnalysis, ['intent']),
            preferredContactMode: getNestedString(customAnalysis, ['preferredContactMode']),
            disconnectionReason,
        }),
        rawPayload: jsonPayload,
    };
}

function buildSummaryRecord(values: Record<string, unknown>) {
    const summary: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(values)) {
        if (value === null || value === undefined) {
            continue;
        }

        if (typeof value === 'string' && !value.trim()) {
            continue;
        }

        summary[key] = value;
    }

    return summary;
}

function asProvider(value: unknown): HandleBrokerCallWebhookPayload['provider'] | null {
    if (value === 'retell' || value === 'vapi' || value === 'twilio') {
        return value;
    }

    return null;
}

function asBrokerStatus(value: unknown): HandleBrokerCallWebhookPayload['status'] | null {
    const normalized = asNonEmptyString(value)?.toLowerCase();
    if (!normalized) {
        return null;
    }

    if (normalized === 'queued') {
        return 'queued';
    }

    if (normalized === 'dialing' || normalized === 'ringing') {
        return 'dialing';
    }

    if (normalized === 'in_progress' || normalized === 'in-progress' || normalized === 'ongoing') {
        return 'in_progress';
    }

    if (normalized === 'completed' || normalized === 'ended' || normalized === 'sent' || normalized === 'delivered' || normalized === 'read') {
        return 'completed';
    }

    if (normalized === 'declined') {
        return 'declined';
    }

    if (normalized === 'no_answer' || normalized === 'no-answer' || normalized === 'busy') {
        return 'no_answer';
    }

    if (normalized === 'failed' || normalized === 'error' || normalized === 'undelivered') {
        return 'failed';
    }

    if (normalized === 'cancelled' || normalized === 'canceled') {
        return 'cancelled';
    }

    return null;
}

function mapRetellWebhookStatus(rawStatus: string | null, eventType: string | null, disconnectionReason: string | null) {
    const normalizedStatus = rawStatus?.toLowerCase() ?? null;
    const normalizedReason = disconnectionReason?.toLowerCase() ?? null;

    if (normalizedStatus === 'registered') {
        return 'queued';
    }

    if (normalizedStatus === 'not_connected') {
        return 'dialing';
    }

    if (normalizedStatus === 'ongoing') {
        return 'in_progress';
    }

    if (normalizedStatus === 'ended' || eventType === 'call_analyzed') {
        if (normalizedReason && /declined|user_declined/.test(normalizedReason)) {
            return 'declined';
        }

        if (normalizedReason && /dial_no_answer|no_answer|busy|voicemail/.test(normalizedReason)) {
            return 'no_answer';
        }

        return 'completed';
    }

    if (normalizedStatus === 'error') {
        return 'failed';
    }

    return 'failed';
}

function mapVapiWebhookStatus(eventType: string, rawStatus: string | null, endedReason: string | null) {
    const normalizedStatus = rawStatus?.toLowerCase() ?? null;
    const normalizedReason = endedReason?.toLowerCase() ?? null;

    if (eventType === 'end-of-call-report') {
        if (normalizedReason && /declined|rejected/.test(normalizedReason)) {
            return 'declined';
        }

        if (normalizedReason && /no_answer|busy|voicemail/.test(normalizedReason)) {
            return 'no_answer';
        }

        return 'completed';
    }

    if (eventType === 'hang') {
        return 'cancelled';
    }

    if (normalizedStatus === 'scheduled' || normalizedStatus === 'queued') {
        return 'queued';
    }

    if (normalizedStatus === 'ringing' || normalizedStatus === 'forwarding') {
        return 'dialing';
    }

    if (normalizedStatus === 'in-progress') {
        return 'in_progress';
    }

    if (normalizedStatus === 'ended') {
        if (normalizedReason && /declined|rejected/.test(normalizedReason)) {
            return 'declined';
        }

        if (normalizedReason && /no_answer|busy|voicemail/.test(normalizedReason)) {
            return 'no_answer';
        }

        return 'completed';
    }

    return 'failed';
}

function mapTwilioVoiceWebhookStatus(rawStatus: string) {
    const normalizedStatus = rawStatus.toLowerCase();
    if (normalizedStatus === 'queued') {
        return 'queued';
    }

    if (normalizedStatus === 'ringing') {
        return 'dialing';
    }

    if (normalizedStatus === 'in-progress') {
        return 'in_progress';
    }

    if (normalizedStatus === 'completed') {
        return 'completed';
    }

    if (normalizedStatus === 'busy' || normalizedStatus === 'no-answer') {
        return 'no_answer';
    }

    if (normalizedStatus === 'canceled' || normalizedStatus === 'cancelled') {
        return 'cancelled';
    }

    return 'failed';
}

function mapTwilioMessageWebhookStatus(rawStatus: string) {
    const normalizedStatus = rawStatus.toLowerCase();
    if (normalizedStatus === 'failed' || normalizedStatus === 'undelivered') {
        return 'failed';
    }

    if (normalizedStatus === 'canceled' || normalizedStatus === 'cancelled') {
        return 'cancelled';
    }

    if (normalizedStatus === 'queued' || normalizedStatus === 'scheduled' || normalizedStatus === 'accepted' || normalizedStatus === 'sending') {
        return 'queued';
    }

    return 'completed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getNestedRecord(root: Record<string, unknown> | null, path: string[]) {
    let current: unknown = root;

    for (const key of path) {
        if (!isRecord(current)) {
            return null;
        }

        current = current[key];
    }

    return isRecord(current) ? current : null;
}

function getNestedString(root: Record<string, unknown> | null, path: string[]) {
    let current: unknown = root;

    for (const key of path) {
        if (!isRecord(current)) {
            return null;
        }

        current = current[key];
    }

    return asNonEmptyString(current);
}

function asNonEmptyString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asPositiveNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return value;
    }

    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
        }
    }

    return null;
}

function getFirstFormValue(formPayload: Record<string, string[]>, key: string) {
    const value = formPayload[key]?.[0];
    return asNonEmptyString(value);
}

function isTerminalBrokerStatus(status: BrokerCallRow['status']) {
    return status === 'completed' || status === 'declined' || status === 'no_answer' || status === 'failed' || status === 'cancelled';
}

function isMissingDatabaseObject(message: string | undefined) {
    return /does not exist|relation .* does not exist|function .* does not exist/i.test(message ?? '');
}

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const brokerWebhookSecret = Deno.env.get('BROKER_WEBHOOK_SECRET') ?? '';
    const retellWebhookSecret = Deno.env.get('RETELL_WEBHOOK_SECRET') ?? '';
    const vapiWebhookSecret = Deno.env.get('VAPI_WEBHOOK_SECRET') ?? '';
    const twilioWebhookSecret = Deno.env.get('TWILIO_WEBHOOK_SECRET') ?? '';

    if (!supabaseUrl || !supabaseServiceRoleKey) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    }

    return {
        supabaseUrl,
        supabaseServiceRoleKey,
        brokerWebhookSecret,
        retellWebhookSecret,
        vapiWebhookSecret,
        twilioWebhookSecret,
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
