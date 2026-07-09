import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SendBrokerConsentPayload = {
    requestId?: string;
    consent?: boolean;
    preferredChannel?: 'voice' | 'sms_whatsapp';
    preferredProvider?: 'retell' | 'twilio';
    locale?: string;
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

        const payload = (await request.json()) as SendBrokerConsentPayload;
        const requestId = payload.requestId?.trim();
        if (!requestId) {
            return json({ error: 'requestId is required.' }, 400);
        }

        if (typeof payload.consent !== 'boolean') {
            return json({ error: 'consent (boolean) is required.' }, 400);
        }

        const channel = payload.preferredChannel === 'sms_whatsapp' ? 'sms_whatsapp' : 'voice';
        const provider = resolveProvider(channel, payload.preferredProvider);
        const locale = typeof payload.locale === 'string' && payload.locale.trim() ? payload.locale.trim() : 'en-IN';

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

        const isParticipant = user.id === interestRequest.sender_id || user.id === interestRequest.receiver_id;
        if (!isParticipant) {
            return json({ error: 'You are not a participant in this request.' }, 403);
        }

        if (interestRequest.status !== 'accepted') {
            return json({ error: 'Request is no longer eligible for broker consent.' }, 409);
        }

        const nowIso = new Date().toISOString();

        if (!payload.consent) {
            const declinedInsert = await serviceClient
                .from('ai_broker_calls')
                .insert({
                    request_id: interestRequest.id,
                    match_id: interestRequest.match_id,
                    sender_profile_id: interestRequest.sender_id,
                    receiver_profile_id: interestRequest.receiver_id,
                    target_profile_id: user.id,
                    triggered_by_profile_id: user.id,
                    provider,
                    channel,
                    status: 'declined',
                    consent_required: true,
                    consent_granted: false,
                    consent_recorded_at: nowIso,
                    scheduled_for: null,
                    metadata: {
                        locale,
                        source: 'send-broker-consent',
                    },
                })
                .select('id')
                .single<BrokerCallRow>();

            if (declinedInsert.error && !isMissingDatabaseObject(declinedInsert.error.message)) {
                throw declinedInsert.error;
            }

            await safeInsertInterestRequestEvent(serviceClient, interestRequest.id, user.id, 'broker_consent_declined', {
                provider,
                channel,
                locale,
            });

            return json({
                requestId: interestRequest.id,
                consentRecorded: true,
                consentStatus: 'declined',
                preferredChannel: channel,
                nextAction: 'none',
                brokerCallId: declinedInsert.data?.id ?? null,
            });
        }

        const queuedInsert = await serviceClient
            .from('ai_broker_calls')
            .insert({
                request_id: interestRequest.id,
                match_id: interestRequest.match_id,
                sender_profile_id: interestRequest.sender_id,
                receiver_profile_id: interestRequest.receiver_id,
                target_profile_id: user.id,
                triggered_by_profile_id: user.id,
                provider,
                channel,
                status: 'consent_granted',
                consent_required: true,
                consent_granted: true,
                consent_recorded_at: nowIso,
                scheduled_for: null,
                metadata: {
                    locale,
                    source: 'send-broker-consent',
                },
            })
            .select('id')
            .single<BrokerCallRow>();

        if (queuedInsert.error) {
            throw queuedInsert.error;
        }

        await safeInsertInterestRequestEvent(serviceClient, interestRequest.id, user.id, 'broker_consent_granted', {
            provider,
            channel,
            locale,
            brokerCallId: queuedInsert.data.id,
        });

        return json({
            requestId: interestRequest.id,
            consentRecorded: true,
            consentStatus: 'granted',
            preferredChannel: channel,
            nextAction: 'broker_call_queued',
            brokerCallId: queuedInsert.data.id,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown send-broker-consent error.';
        return json({ error: message }, 500);
    }
});

function resolveProvider(
    channel: 'voice' | 'sms_whatsapp',
    preferredProvider: SendBrokerConsentPayload['preferredProvider'],
): 'retell' | 'twilio' {
    if (channel === 'sms_whatsapp') {
        return 'twilio';
    }

    if (preferredProvider && preferredProvider !== 'retell') {
        throw new Error('Retell is the only supported voice broker provider.');
    }

    return 'retell';
}

async function safeInsertInterestRequestEvent(
    serviceClient: ReturnType<typeof createClient>,
    requestId: string,
    actorId: string,
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

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
        throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.');
    }

    return {
        supabaseUrl,
        supabaseAnonKey,
        supabaseServiceRoleKey,
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
