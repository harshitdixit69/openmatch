import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// OpenMatch is India-first (locale en-IN). Contact numbers are often stored as bare
// 10-digit local numbers; providers (Retell/Twilio) require full E.164, so we assume
// this country code when a number has no explicit country code / leading +.
const DEFAULT_COUNTRY_CODE = '91';

// If a broker call is still 'queued'/'dialing'/'in_progress' after this long, we treat
// it as stale (the provider likely completed the call but never posted a terminal
// webhook). Stale attempts are auto-expired so they can't permanently block new calls.
const STALE_BROKER_CALL_MS = 15 * 60 * 1000; // 15 minutes

type TriggerOutboundBrokerCallPayload = {
    requestId?: string;
    targetProfileId?: string;
    mode?: 'countdown_nudge' | 'manual';
    channel?: 'voice' | 'sms_whatsapp';
    provider?: 'retell' | 'twilio';
    windowKey?: 't_minus_6h' | 't_minus_1h';
    dryRun?: boolean;
};

type InterestRequestRow = {
    id: string;
    match_id: string;
    sender_id: string;
    receiver_id: string;
    status: 'sent' | 'accepted' | 'declined' | 'expired' | 'ghosted' | 'closed';
};

type BrokerCallRow = {
    id: string;
    attempt_number?: number;
};

type ProfileContactDetailsRow = {
    profile_id: string;
    phone_number: string | null;
    whatsapp_number: string | null;
};

type ParticipantProfileRow = {
    id: string;
    full_name: string;
};

type BrokerDispatchContext = {
    destination: string;
    targetName: string | null;
    counterpartyName: string | null;
};

type BrokerDispatchStatus = 'queued' | 'dialing' | 'in_progress' | 'completed' | 'no_answer' | 'failed' | 'cancelled';

type BrokerDispatchResult = {
    status: BrokerDispatchStatus;
    providerCallId: string | null;
    providerMessageId: string | null;
    metadata: Record<string, unknown>;
    summary?: Record<string, unknown>;
};

type BrokerConsentRow = {
    id: string;
    status: 'consent_granted' | 'declined' | 'queued' | 'consent_required' | 'dialing' | 'in_progress' | 'completed' | 'no_answer' | 'failed' | 'cancelled';
    consent_granted: boolean | null;
    consent_recorded_at: string | null;
    created_at: string;
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

        const authResult = await authorizeRequest(authHeader, env);
        if (!authResult.authorized) {
            return json({ error: authResult.error ?? 'Unauthorized request.' }, 401);
        }

        const payload = (await request.json()) as TriggerOutboundBrokerCallPayload;
        const requestId = payload.requestId?.trim();
        const targetProfileId = payload.targetProfileId?.trim();
        if (!requestId || !targetProfileId) {
            return json({ error: 'requestId and targetProfileId are required.' }, 400);
        }

        const mode = payload.mode === 'manual' ? 'manual' : 'countdown_nudge';
        const channel = payload.channel === 'sms_whatsapp' ? 'sms_whatsapp' : 'voice';
        const provider = resolveProvider(channel, payload.provider);
        const windowKey = payload.windowKey === 't_minus_1h'
            ? 't_minus_1h'
            : payload.windowKey === 't_minus_6h'
                ? 't_minus_6h'
                : null;
        const dryRun = Boolean(payload.dryRun);

        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        const requestResult = await serviceClient
            .from('interest_requests')
            .select('id, match_id, sender_id, receiver_id, status')
            .eq('id', requestId)
            .maybeSingle<InterestRequestRow>();

        if (requestResult.error && !isMissingDatabaseObject(requestResult.error.message)) {
            throw requestResult.error;
        }

        const interestRequest = requestResult.data;
        if (!interestRequest) {
            return json({ error: 'Request not found.' }, 404);
        }

        if (interestRequest.status !== 'accepted') {
            return json({ error: 'Request already resolved for outbound broker calls.' }, 409);
        }

        if (targetProfileId !== interestRequest.sender_id && targetProfileId !== interestRequest.receiver_id) {
            return json({ error: 'targetProfileId must be a participant in this request.' }, 400);
        }

        if (authResult.userId && authResult.userId !== interestRequest.sender_id && authResult.userId !== interestRequest.receiver_id) {
            return json({ error: 'You are not a participant in this request.' }, 401);
        }

        // Auto-expire stale in-flight attempts. If a provider never posted a terminal
        // webhook (e.g. the call actually completed but we never heard back), the row
        // would stay 'queued'/'dialing'/'in_progress' forever and permanently block new
        // attempts. Flip anything older than the stale threshold to 'failed' first so a
        // missing webhook can't lock the channel.
        const staleCutoffIso = new Date(Date.now() - STALE_BROKER_CALL_MS).toISOString();
        const staleReset = await serviceClient
            .from('ai_broker_calls')
            .update({ status: 'failed', ended_at: new Date().toISOString(), last_error: 'auto_expired_no_terminal_webhook' })
            .eq('request_id', requestId)
            .eq('target_profile_id', targetProfileId)
            .eq('channel', channel)
            .in('status', ['queued', 'dialing', 'in_progress'])
            .lt('created_at', staleCutoffIso);

        if (staleReset.error && !isMissingDatabaseObject(staleReset.error.message)) {
            throw staleReset.error;
        }

        const duplicate = await serviceClient
            .from('ai_broker_calls')
            .select('id')
            .eq('request_id', requestId)
            .eq('target_profile_id', targetProfileId)
            .eq('channel', channel)
            .in('status', ['queued', 'dialing', 'in_progress'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle<BrokerCallRow>();

        if (duplicate.error && !isMissingDatabaseObject(duplicate.error.message)) {
            throw duplicate.error;
        }

        if (duplicate.data) {
            return json({ error: 'An active broker attempt already exists for this request/channel.' }, 409);
        }

        const consentResult = await serviceClient
            .from('ai_broker_calls')
            .select('id, status, consent_granted, consent_recorded_at, created_at')
            .eq('request_id', requestId)
            .eq('target_profile_id', targetProfileId)
            .eq('consent_required', true)
            .not('consent_granted', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle<BrokerConsentRow>();

        if (consentResult.error && !isMissingDatabaseObject(consentResult.error.message)) {
            throw consentResult.error;
        }

        const consentRow = consentResult.data;
        if (!consentRow || consentRow.consent_granted !== true) {
            return json({ error: 'Target participant consent is required before outbound broker outreach.' }, 409);
        }

        const latestAttemptResult = await serviceClient
            .from('ai_broker_calls')
            .select('id, attempt_number')
            .eq('request_id', requestId)
            .eq('target_profile_id', targetProfileId)
            .eq('channel', channel)
            .order('attempt_number', { ascending: false })
            .limit(1)
            .maybeSingle<BrokerCallRow>();

        if (latestAttemptResult.error && !isMissingDatabaseObject(latestAttemptResult.error.message)) {
            throw latestAttemptResult.error;
        }

        const nextAttemptNumber = (latestAttemptResult.data?.attempt_number ?? 0) + 1;

        const nowIso = new Date().toISOString();

        if (dryRun) {
            return json({
                brokerCallId: null,
                requestId,
                status: 'queued',
                provider,
                channel,
                scheduledFor: nowIso,
                notice: 'Dry run: outbound broker attempt validated.',
            });
        }

        let brokerCallId: string;

        // The very first dispatch should reuse the consent row so we don't violate
        // the active-attempt unique index while consent status is still active.
        if (consentRow.status === 'consent_granted') {
            const reuseResult = await serviceClient
                .from('ai_broker_calls')
                .update({
                    triggered_by_profile_id: authResult.userId,
                    provider,
                    channel,
                    status: 'queued',
                    consent_required: true,
                    consent_granted: true,
                    consent_recorded_at: consentRow.consent_recorded_at ?? consentRow.created_at,
                    attempt_number: nextAttemptNumber,
                    scheduled_for: nowIso,
                    metadata: {
                        mode,
                        source: 'trigger-outbound-broker-call',
                        windowKey,
                    },
                    last_error: null,
                })
                .eq('id', consentRow.id)
                .select('id')
                .single<BrokerCallRow>();

            if (reuseResult.error || !reuseResult.data?.id) {
                throw reuseResult.error ?? new Error('Could not reuse broker consent row.');
            }

            brokerCallId = reuseResult.data.id;
        } else {
            const insertResult = await serviceClient
                .from('ai_broker_calls')
                .insert({
                    request_id: interestRequest.id,
                    match_id: interestRequest.match_id,
                    sender_profile_id: interestRequest.sender_id,
                    receiver_profile_id: interestRequest.receiver_id,
                    target_profile_id: targetProfileId,
                    triggered_by_profile_id: authResult.userId,
                    provider,
                    channel,
                    status: 'queued',
                    consent_required: false,
                    consent_granted: true,
                    consent_recorded_at: consentRow.consent_recorded_at ?? consentRow.created_at,
                    attempt_number: nextAttemptNumber,
                    scheduled_for: nowIso,
                    metadata: {
                        mode,
                        source: 'trigger-outbound-broker-call',
                        windowKey,
                    },
                })
                .select('id')
                .single<BrokerCallRow>();

            if (insertResult.error || !insertResult.data?.id) {
                throw insertResult.error ?? new Error('Could not create broker call attempt.');
            }

            brokerCallId = insertResult.data.id;
        }

        await safeInsertInterestRequestEvent(serviceClient, interestRequest.id, authResult.userId, 'broker_call_queued', {
            brokerCallId,
            provider,
            channel,
            mode,
            targetProfileId,
            windowKey,
        });

        const dispatchContext = await loadBrokerDispatchContext(
            serviceClient,
            interestRequest,
            targetProfileId,
            channel,
        );

        let dispatchResult: BrokerDispatchResult;
        try {
            dispatchResult = await dispatchBrokerAttempt({
                env,
                brokerCallId,
                requestId,
                matchId: interestRequest.match_id,
                targetProfileId,
                channel,
                provider,
                mode,
                dispatchContext,
            });
        } catch (error) {
            const dispatchError = toDispatchError(error);

            await markBrokerDispatchFailed(serviceClient, brokerCallId, mode, windowKey, dispatchError.message);

            await safeInsertInterestRequestEvent(serviceClient, interestRequest.id, authResult.userId, 'broker_call_dispatch_failed', {
                brokerCallId,
                provider,
                channel,
                mode,
                targetProfileId,
                windowKey,
                error: dispatchError.message,
            });

            return json(
                {
                    error: dispatchError.message,
                    brokerCallId,
                },
                dispatchError.statusCode,
            );
        }

        await updateBrokerDispatchState(serviceClient, brokerCallId, mode, windowKey, dispatchResult);

        await safeInsertInterestRequestEvent(serviceClient, interestRequest.id, authResult.userId, 'broker_call_dispatched', {
            brokerCallId,
            provider,
            channel,
            mode,
            targetProfileId,
            windowKey,
            status: dispatchResult.status,
            providerCallId: dispatchResult.providerCallId,
            providerMessageId: dispatchResult.providerMessageId,
        });

        return json({
            brokerCallId,
            requestId,
            status: dispatchResult.status,
            provider,
            channel,
            scheduledFor: nowIso,
            notice: 'Outbound broker attempt dispatched.',
        });
    } catch (error) {
        if (error instanceof DispatchError) {
            return json({ error: error.message }, error.statusCode);
        }

        const message = extractErrorMessage(error, 'Unknown trigger-outbound-broker-call error.');
        return json({ error: message }, 500);
    }
});

async function authorizeRequest(authHeader: string, env: ReturnType<typeof getEnv>) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
        return { authorized: false, userId: null, error: 'Invalid token.' };
    }

    if (token === env.supabaseServiceRoleKey) {
        return { authorized: true, userId: null };
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
        error,
    } = await userClient.auth.getUser();

    if (error || !user) {
        return { authorized: false, userId: null, error: 'Unauthorized request.' };
    }

    return { authorized: true, userId: user.id };
}

function resolveProvider(
    channel: 'voice' | 'sms_whatsapp',
    provider: TriggerOutboundBrokerCallPayload['provider'],
): 'retell' | 'twilio' {
    if (channel === 'sms_whatsapp') {
        return 'twilio';
    }

    if (provider && provider !== 'retell') {
        throw new Error('Retell is the only supported voice broker provider.');
    }

    return 'retell';
}

async function loadBrokerDispatchContext(
    serviceClient: ReturnType<typeof createClient>,
    interestRequest: InterestRequestRow,
    targetProfileId: string,
    channel: 'voice' | 'sms_whatsapp',
): Promise<BrokerDispatchContext> {
    const otherProfileId = targetProfileId === interestRequest.sender_id
        ? interestRequest.receiver_id
        : interestRequest.sender_id;

    const [contactResult, profileResult] = await Promise.all([
        serviceClient
            .from('profile_contact_details')
            .select('profile_id, phone_number, whatsapp_number')
            .eq('profile_id', targetProfileId)
            .maybeSingle<ProfileContactDetailsRow>(),
        serviceClient
            .from('profiles')
            .select('id, full_name')
            .in('id', [targetProfileId, otherProfileId]),
    ]);

    if (contactResult.error && !isMissingDatabaseObject(contactResult.error.message)) {
        throw contactResult.error;
    }

    if (profileResult.error) {
        throw profileResult.error;
    }

    const contactDetails = contactResult.data;
    const profiles = Array.isArray(profileResult.data) ? profileResult.data as ParticipantProfileRow[] : [];

    const targetProfile = profiles.find((profile) => profile.id === targetProfileId) ?? null;
    const otherProfile = profiles.find((profile) => profile.id === otherProfileId) ?? null;

    const voiceNumber = normalizeContactNumber(contactDetails?.phone_number)
        ?? normalizeContactNumber(contactDetails?.whatsapp_number);
    const whatsappNumber = normalizeContactNumber(contactDetails?.whatsapp_number)
        ?? normalizeContactNumber(contactDetails?.phone_number);

    const destination = channel === 'sms_whatsapp' ? whatsappNumber : voiceNumber;
    if (!destination) {
        throw new DispatchError('Target participant has no reachable contact details for this broker channel.', 409);
    }

    return {
        destination,
        targetName: targetProfile?.full_name ?? null,
        counterpartyName: otherProfile?.full_name ?? null,
    };
}

async function dispatchBrokerAttempt(args: {
    env: ReturnType<typeof getEnv>;
    brokerCallId: string;
    requestId: string;
    matchId: string;
    targetProfileId: string;
    channel: 'voice' | 'sms_whatsapp';
    provider: 'retell' | 'twilio';
    mode: 'countdown_nudge' | 'manual';
    dispatchContext: BrokerDispatchContext;
}): Promise<BrokerDispatchResult> {
    const {
        env,
        brokerCallId,
        requestId,
        matchId,
        targetProfileId,
        channel,
        provider,
        mode,
        dispatchContext,
    } = args;

    if (channel === 'sms_whatsapp') {
        return dispatchTwilioWhatsappMessage({
            env,
            brokerCallId,
            requestId,
            matchId,
            targetProfileId,
            mode,
            dispatchContext,
        });
    }

    if (provider === 'twilio') {
        return dispatchTwilioVoiceCall({
            env,
            brokerCallId,
            requestId,
            matchId,
            targetProfileId,
            mode,
            dispatchContext,
        });
    }

    return dispatchRetellVoiceCall({
        env,
        brokerCallId,
        requestId,
        matchId,
        targetProfileId,
        mode,
        dispatchContext,
    });
}

async function dispatchRetellVoiceCall(args: {
    env: ReturnType<typeof getEnv>;
    brokerCallId: string;
    requestId: string;
    matchId: string;
    targetProfileId: string;
    mode: 'countdown_nudge' | 'manual';
    dispatchContext: BrokerDispatchContext;
}): Promise<BrokerDispatchResult> {
    const {
        env,
        brokerCallId,
        requestId,
        matchId,
        targetProfileId,
        mode,
        dispatchContext,
    } = args;

    if (!env.retellApiKey || !env.retellAgentId || !env.retellFromNumber) {
        throw new DispatchError(
            'Retell broker dispatch requires RETELL_API_KEY, RETELL_AGENT_ID, and RETELL_FROM_NUMBER.',
            500,
        );
    }

    const response = await fetch(`${env.retellApiBaseUrl}/v2/create-phone-call`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.retellApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from_number: env.retellFromNumber,
            to_number: dispatchContext.destination,
            override_agent_id: env.retellAgentId,
            webhook_url: env.brokerWebhookUrl,
            metadata: {
                brokerCallId,
                requestId,
                matchId,
                targetProfileId,
                mode,
                source: 'openmatch_ai_broker',
            },
            retell_llm_dynamic_variables: {
                participant_name: dispatchContext.targetName ?? 'there',
                counterpart_name: dispatchContext.counterpartyName ?? 'your match',
                broker_request_id: requestId,
            },
        }),
    });

    const body = await parseResponseBody(response);
    if (!response.ok) {
        const providerError = extractResponseError(body, 'Retell broker dispatch failed.');
        // Retell rejects the call when `from_number` is not a number provisioned inside
        // the Retell dashboard (e.g. "Item +91... not found from phone-number"). Surface a
        // clear, actionable message instead of the raw provider string.
        if (/not found from phone[- ]?number/i.test(providerError) || /from[_ ]?number/i.test(providerError)) {
            throw new DispatchError(
                `Retell rejected the caller ID "${env.retellFromNumber}". RETELL_FROM_NUMBER must be a phone number you have purchased or imported inside the Retell dashboard (Phone Numbers). Provision a Retell number and set the RETELL_FROM_NUMBER secret to it, then retry.`,
                400,
            );
        }
        throw new DispatchError(providerError, response.status >= 500 ? 502 : 400);
    }

    const providerStatus = asNonEmptyString(body?.call_status) ?? 'registered';

    return {
        status: mapRetellStatus(providerStatus),
        providerCallId: asNonEmptyString(body?.call_id),
        providerMessageId: null,
        metadata: {
            providerStatus,
            agentId: asNonEmptyString(body?.agent_id),
            telephonyIdentifier: isRecord(body?.telephony_identifier) ? body.telephony_identifier : null,
        },
        summary: {
            providerStatus,
        },
    };
}

async function dispatchVapiVoiceCall(args: {
    env: ReturnType<typeof getEnv>;
    brokerCallId: string;
    requestId: string;
    matchId: string;
    targetProfileId: string;
    mode: 'countdown_nudge' | 'manual';
    dispatchContext: BrokerDispatchContext;
}): Promise<BrokerDispatchResult> {
    const {
        env,
        brokerCallId,
        requestId,
        matchId,
        targetProfileId,
        mode,
        dispatchContext,
    } = args;

    if (!env.vapiApiKey || !env.vapiAssistantId || !env.vapiPhoneNumberId) {
        throw new DispatchError(
            'Vapi broker dispatch requires VAPI_API_KEY, VAPI_ASSISTANT_ID, and VAPI_PHONE_NUMBER_ID.',
            500,
        );
    }

    const response = await fetch(`${env.vapiApiBaseUrl}/call`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.vapiApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: `OpenMatch broker ${requestId}`,
            assistantId: env.vapiAssistantId,
            phoneNumberId: env.vapiPhoneNumberId,
            customer: {
                number: dispatchContext.destination,
                name: dispatchContext.targetName ?? undefined,
            },
            assistantOverrides: {
                variableValues: {
                    brokerCallId,
                    requestId,
                    matchId,
                    targetProfileId,
                    mode,
                    participantName: dispatchContext.targetName ?? 'there',
                    counterpartName: dispatchContext.counterpartyName ?? 'your match',
                },
            },
        }),
    });

    const body = await parseResponseBody(response);
    if (!response.ok) {
        throw new DispatchError(extractResponseError(body, 'Vapi broker dispatch failed.'), response.status >= 500 ? 502 : 400);
    }

    const providerStatus = asNonEmptyString(body?.status) ?? 'queued';

    return {
        status: mapVapiStatus(providerStatus),
        providerCallId: asNonEmptyString(body?.id) ?? asNonEmptyString(body?.phoneCallProviderId),
        providerMessageId: null,
        metadata: {
            providerStatus,
            phoneCallProviderId: asNonEmptyString(body?.phoneCallProviderId),
            phoneCallProvider: asNonEmptyString(body?.phoneCallProvider),
        },
        summary: {
            providerStatus,
        },
    };
}

async function dispatchTwilioVoiceCall(args: {
    env: ReturnType<typeof getEnv>;
    brokerCallId: string;
    requestId: string;
    matchId: string;
    targetProfileId: string;
    mode: 'countdown_nudge' | 'manual';
    dispatchContext: BrokerDispatchContext;
}): Promise<BrokerDispatchResult> {
    const {
        env,
        brokerCallId,
        requestId,
        matchId,
        targetProfileId,
        mode,
        dispatchContext,
    } = args;

    if (!env.twilioAccountSid || !env.twilioAuthToken || !env.twilioVoiceFromNumber) {
        throw new DispatchError(
            'Twilio voice broker dispatch requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VOICE_FROM_NUMBER.',
            500,
        );
    }

    if (!env.twilioVoiceTwimlUrl && !env.twilioVoiceTwiml && !env.twilioVoiceApplicationSid) {
        throw new DispatchError(
            'Twilio voice broker dispatch requires TWILIO_VOICE_TWIML_URL, TWILIO_VOICE_TWIML, or TWILIO_VOICE_APPLICATION_SID.',
            500,
        );
    }

    const form = new URLSearchParams();
    form.set('To', dispatchContext.destination);
    form.set('From', normalizeContactNumber(env.twilioVoiceFromNumber) ?? env.twilioVoiceFromNumber);

    if (env.twilioVoiceApplicationSid) {
        form.set('ApplicationSid', env.twilioVoiceApplicationSid);
    } else if (env.twilioVoiceTwimlUrl) {
        form.set('Url', env.twilioVoiceTwimlUrl);
    } else if (env.twilioVoiceTwiml) {
        form.set('Twiml', env.twilioVoiceTwiml);
    }

    form.set('Timeout', '20');

    const response = await fetch(
        `${env.twilioApiBaseUrl}/2010-04-01/Accounts/${env.twilioAccountSid}/Calls.json`,
        {
            method: 'POST',
            headers: {
                Authorization: buildTwilioAuthorizationHeader(env.twilioAccountSid, env.twilioAuthToken),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form.toString(),
        },
    );

    const body = await parseResponseBody(response);
    if (!response.ok) {
        throw new DispatchError(extractResponseError(body, 'Twilio voice broker dispatch failed.'), response.status >= 500 ? 502 : 400);
    }

    const providerStatus = asNonEmptyString(body?.status) ?? 'queued';

    return {
        status: mapTwilioVoiceStatus(providerStatus),
        providerCallId: asNonEmptyString(body?.sid),
        providerMessageId: null,
        metadata: {
            providerStatus,
            direction: asNonEmptyString(body?.direction),
        },
        summary: {
            providerStatus,
        },
    };
}

async function dispatchTwilioWhatsappMessage(args: {
    env: ReturnType<typeof getEnv>;
    brokerCallId: string;
    requestId: string;
    matchId: string;
    targetProfileId: string;
    mode: 'countdown_nudge' | 'manual';
    dispatchContext: BrokerDispatchContext;
}): Promise<BrokerDispatchResult> {
    const {
        env,
        brokerCallId,
        requestId,
        matchId,
        targetProfileId,
        mode,
        dispatchContext,
    } = args;

    if (!env.twilioAccountSid || !env.twilioAuthToken || !env.twilioWhatsappFromNumber) {
        throw new DispatchError(
            'Twilio WhatsApp broker dispatch requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM_NUMBER.',
            500,
        );
    }

    const form = new URLSearchParams();
    form.set('To', formatTwilioWhatsappAddress(dispatchContext.destination));
    form.set('From', formatTwilioWhatsappAddress(env.twilioWhatsappFromNumber));
    form.set(
        'Body',
        buildTwilioWhatsappMessageBody({
            counterpartyName: dispatchContext.counterpartyName,
            appUrl: env.openmatchAppUrl,
        }),
    );

    const response = await fetch(
        `${env.twilioApiBaseUrl}/2010-04-01/Accounts/${env.twilioAccountSid}/Messages.json`,
        {
            method: 'POST',
            headers: {
                Authorization: buildTwilioAuthorizationHeader(env.twilioAccountSid, env.twilioAuthToken),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form.toString(),
        },
    );

    const body = await parseResponseBody(response);
    if (!response.ok) {
        throw new DispatchError(extractResponseError(body, 'Twilio WhatsApp broker dispatch failed.'), response.status >= 500 ? 502 : 400);
    }

    const providerStatus = asNonEmptyString(body?.status) ?? 'queued';

    return {
        status: mapTwilioMessageStatus(providerStatus),
        providerCallId: null,
        providerMessageId: asNonEmptyString(body?.sid),
        metadata: {
            providerStatus,
            brokerCallId,
            requestId,
            matchId,
            targetProfileId,
            mode,
        },
        summary: {
            providerStatus,
        },
    };
}

async function updateBrokerDispatchState(
    serviceClient: ReturnType<typeof createClient>,
    brokerCallId: string,
    mode: 'countdown_nudge' | 'manual',
    windowKey: 't_minus_6h' | 't_minus_1h' | null,
    dispatchResult: BrokerDispatchResult,
) {
    const { error } = await serviceClient
        .from('ai_broker_calls')
        .update({
            status: dispatchResult.status,
            provider_call_id: dispatchResult.providerCallId,
            provider_message_id: dispatchResult.providerMessageId,
            last_error: null,
            metadata: {
                mode,
                source: 'trigger-outbound-broker-call',
                windowKey,
                dispatch: dispatchResult.metadata,
            },
            summary: dispatchResult.summary ?? {},
        })
        .eq('id', brokerCallId);

    if (error) {
        throw error;
    }
}

async function markBrokerDispatchFailed(
    serviceClient: ReturnType<typeof createClient>,
    brokerCallId: string,
    mode: 'countdown_nudge' | 'manual',
    windowKey: 't_minus_6h' | 't_minus_1h' | null,
    errorMessage: string,
) {
    const { error } = await serviceClient
        .from('ai_broker_calls')
        .update({
            status: 'failed',
            last_error: errorMessage,
            metadata: {
                mode,
                source: 'trigger-outbound-broker-call',
                windowKey,
                dispatch: {
                    failedAt: new Date().toISOString(),
                },
            },
            summary: {
                error: errorMessage,
            },
        })
        .eq('id', brokerCallId);

    if (error) {
        throw error;
    }
}

function buildTwilioWhatsappMessageBody(args: { counterpartyName: string | null; appUrl: string | null }) {
    const otherName = args.counterpartyName ? ` with ${args.counterpartyName}` : '';
    const appLink = args.appUrl ? ` Open the app here: ${args.appUrl}` : ' Open OpenMatch to continue in chat.';

    return `OpenMatch check-in: your accepted match${otherName} is waiting for a reply. Reply in the app if you want to continue. Contact exchange still requires mutual unlock.${appLink}`;
}

function buildTwilioAuthorizationHeader(accountSid: string, authToken: string) {
    return `Basic ${btoa(`${accountSid}:${authToken}`)}`;
}

function formatTwilioWhatsappAddress(value: string) {
    const normalized = normalizeContactNumber(value) ?? value.trim();
    return normalized.toLowerCase().startsWith('whatsapp:') ? normalized : `whatsapp:${normalized}`;
}

function normalizeContactNumber(value: string | null | undefined) {
    const trimmed = value?.trim();
    if (!trimmed) {
        return null;
    }

    // Drop the whatsapp: protocol prefix and any human formatting (spaces, dashes, parens).
    const withoutProtocol = trimmed.replace(/^whatsapp:/i, '');
    let cleaned = withoutProtocol.replace(/[^\d+]/g, '');

    // "00" is the international dialing prefix in many regions -> treat it as "+".
    if (cleaned.startsWith('00')) {
        cleaned = `+${cleaned.slice(2)}`;
    }

    // Already E.164 (leading +). Keep the + and the digits only.
    if (cleaned.startsWith('+')) {
        const digits = cleaned.slice(1).replace(/\D/g, '');
        return digits ? `+${digits}` : null;
    }

    const digits = cleaned.replace(/\D/g, '');
    if (!digits) {
        return null;
    }

    // Local number with a trunk "0" prefix (e.g. 0XXXXXXXXXX) -> +<cc><national>.
    if (digits.length === 11 && digits.startsWith('0')) {
        return `+${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
    }

    // Bare 10-digit local mobile number -> assume the default country code.
    if (digits.length === 10) {
        return `+${DEFAULT_COUNTRY_CODE}${digits}`;
    }

    // Country code present but missing the leading + (e.g. 91XXXXXXXXXX, 1XXXXXXXXXX).
    if (digits.length > 10) {
        return `+${digits}`;
    }

    // Too short to be a dialable number.
    return null;
}

function mapRetellStatus(status: string): BrokerDispatchStatus {
    switch (status) {
        case 'registered':
            return 'queued';
        case 'not_connected':
            return 'dialing';
        case 'ongoing':
            return 'in_progress';
        case 'ended':
            return 'completed';
        case 'error':
        default:
            return 'failed';
    }
}

function mapVapiStatus(status: string): BrokerDispatchStatus {
    switch (status) {
        case 'scheduled':
        case 'queued':
            return 'queued';
        case 'ringing':
        case 'forwarding':
            return 'dialing';
        case 'in-progress':
            return 'in_progress';
        case 'ended':
            return 'completed';
        case 'not-found':
        case 'deletion-failed':
        default:
            return 'failed';
    }
}

function mapTwilioVoiceStatus(status: string): BrokerDispatchStatus {
    switch (status) {
        case 'queued':
            return 'queued';
        case 'ringing':
            return 'dialing';
        case 'in-progress':
            return 'in_progress';
        case 'completed':
            return 'completed';
        case 'busy':
        case 'no-answer':
            return 'no_answer';
        case 'canceled':
        case 'cancelled':
            return 'cancelled';
        case 'failed':
        default:
            return 'failed';
    }
}

function mapTwilioMessageStatus(status: string): BrokerDispatchStatus {
    switch (status) {
        case 'failed':
        case 'undelivered':
            return 'failed';
        case 'canceled':
        case 'cancelled':
            return 'cancelled';
        case 'queued':
        case 'accepted':
        case 'scheduled':
        case 'sending':
        case 'sent':
        case 'delivered':
        case 'read':
        default:
            return 'completed';
    }
}

async function parseResponseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

function extractResponseError(body: unknown, fallback: string) {
    if (typeof body === 'string') {
        return body.trim() || fallback;
    }

    if (isRecord(body)) {
        const direct = asNonEmptyString(body.error)
            ?? asNonEmptyString(body.message)
            ?? asNonEmptyString(body.detail)
            ?? asNonEmptyString(body.error_message);

        if (direct) {
            return direct;
        }
    }

    return fallback;
}

function asNonEmptyString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extractErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error) {
        return error.message;
    }

    if (isRecord(error)) {
        return (
            asNonEmptyString(error.message) ??
            asNonEmptyString(error.error) ??
            asNonEmptyString(error.detail) ??
            fallback
        );
    }

    return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toDispatchError(error: unknown) {
    if (error instanceof DispatchError) {
        return error;
    }

    const message = error instanceof Error ? error.message : 'Unknown broker dispatch error.';
    return new DispatchError(message, 502);
}

class DispatchError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
        super(message);
        this.name = 'DispatchError';
        this.statusCode = statusCode;
    }
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

function isMissingDatabaseObject(message: string | undefined) {
    return /does not exist|relation .* does not exist|function .* does not exist/i.test(message ?? '');
}

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const retellApiKey = Deno.env.get('RETELL_API_KEY')?.trim() || null;
    const retellApiBaseUrl = Deno.env.get('RETELL_API_BASE_URL')?.trim() || 'https://api.retellai.com';
    const retellAgentId = Deno.env.get('RETELL_AGENT_ID')?.trim() || null;
    const retellFromNumber = Deno.env.get('RETELL_FROM_NUMBER')?.trim() || null;
    const vapiApiKey = Deno.env.get('VAPI_API_KEY')?.trim() || null;
    const vapiApiBaseUrl = Deno.env.get('VAPI_API_BASE_URL')?.trim() || 'https://api.vapi.ai';
    const vapiAssistantId = Deno.env.get('VAPI_ASSISTANT_ID')?.trim() || null;
    const vapiPhoneNumberId = Deno.env.get('VAPI_PHONE_NUMBER_ID')?.trim() || null;
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID')?.trim() || null;
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN')?.trim() || null;
    const twilioApiBaseUrl = Deno.env.get('TWILIO_API_BASE_URL')?.trim() || 'https://api.twilio.com';
    const twilioVoiceFromNumber = Deno.env.get('TWILIO_VOICE_FROM_NUMBER')?.trim() || null;
    const twilioVoiceTwimlUrl = Deno.env.get('TWILIO_VOICE_TWIML_URL')?.trim() || null;
    const twilioVoiceTwiml = Deno.env.get('TWILIO_VOICE_TWIML')?.trim() || null;
    const twilioVoiceApplicationSid = Deno.env.get('TWILIO_VOICE_APPLICATION_SID')?.trim() || null;
    const twilioWhatsappFromNumber = Deno.env.get('TWILIO_WHATSAPP_FROM_NUMBER')?.trim() || null;
    const openmatchAppUrl = Deno.env.get('OPENMATCH_APP_URL')?.trim() || null;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
        throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.');
    }

    // Where providers should POST call/message status updates. Defaults to this project's
    // handle-broker-call-webhook function so completion events always reach us even if the
    // agent/account-level webhook isn't configured in the provider dashboard.
    const brokerWebhookSecret = Deno.env.get('BROKER_WEBHOOK_SECRET')?.trim() || '';
    const brokerWebhookBase = Deno.env.get('BROKER_WEBHOOK_URL')?.trim()
        || `${supabaseUrl.replace(/\/$/, '')}/functions/v1/handle-broker-call-webhook`;
    // Append the shared-secret token so the webhook can authorize provider callbacks
    // without needing to verify each provider's signature scheme.
    const brokerWebhookUrl = brokerWebhookSecret
        ? `${brokerWebhookBase}${brokerWebhookBase.includes('?') ? '&' : '?'}token=${encodeURIComponent(brokerWebhookSecret)}`
        : brokerWebhookBase;

    return {
        supabaseUrl,
        supabaseAnonKey,
        supabaseServiceRoleKey,
        retellApiKey,
        retellApiBaseUrl,
        retellAgentId,
        retellFromNumber,
        vapiApiKey,
        vapiApiBaseUrl,
        vapiAssistantId,
        vapiPhoneNumberId,
        twilioAccountSid,
        twilioAuthToken,
        twilioApiBaseUrl,
        twilioVoiceFromNumber,
        twilioVoiceTwimlUrl,
        twilioVoiceTwiml,
        twilioVoiceApplicationSid,
        twilioWhatsappFromNumber,
        openmatchAppUrl,
        brokerWebhookUrl,
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
