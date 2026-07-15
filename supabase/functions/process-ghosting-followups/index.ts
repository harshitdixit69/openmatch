import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callChatCompletion } from '../_shared/azureChat.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const nudgeExtensionHours = 6;
const brokerCountdownWindowHours = 6;
const brokerFinalWindowHours = 1;

type ProcessGhostingFollowupsPayload = {
    dryRun?: boolean;
};

type InterestRequestRow = {
    id: string;
    match_id: string;
    sender_id: string;
    receiver_id: string;
    status: 'sent' | 'accepted' | 'declined' | 'expired' | 'ghosted' | 'closed';
    media_type: 'none' | 'voice' | 'video';
    request_quality_score: number;
    sender_ghost_risk_score: number;
    reminder_count: number;
    accepted_at: string | null;
    first_reply_due_at: string | null;
    first_reply_at: string | null;
    ghosted_at: string | null;
    created_at: string;
    updated_at?: string | null;
};

type ReliabilityRequestRow = {
    sender_id: string;
    status: 'sent' | 'accepted' | 'declined' | 'expired' | 'ghosted' | 'closed';
    accepted_at: string | null;
    first_reply_due_at: string | null;
    first_reply_at: string | null;
    ghosted_at: string | null;
};

type ProfileRow = {
    id: string;
    profile_owner: 'self' | 'parent' | 'sibling' | 'relative' | null;
};

type BrokerConsentPreferenceRow = {
    channel: 'voice' | 'sms_whatsapp';
    provider: 'retell' | 'vapi' | 'twilio';
    consent_granted: boolean | null;
};

type CountdownWindowKey = 't_minus_6h' | 't_minus_1h';

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const env = getEnv();
        authorizeWorkerRequest(request, env);

        const payload = await parseBody(request);
        const dryRun = Boolean(payload.dryRun);
        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        const now = new Date();
        const nowIso = now.toISOString();
        const brokerWindowEndIso = new Date(now.getTime() + brokerCountdownWindowHours * 60 * 60 * 1000).toISOString();
        const brokerCountdownRequests = await fetchCountdownEligibleRequests(serviceClient, nowIso, brokerWindowEndIso);
        const overdueRequests = await fetchOverdueAcceptedRequests(serviceClient, nowIso);

        const touchedSenderIds = new Set<string>();
        let brokerQueued = 0;
        let brokerSkipped = 0;
        let nudged = 0;
        let ghosted = 0;
        let callbacksQueued = 0;

        for (const requestRow of brokerCountdownRequests) {
            const isBusy = await handleSlaPauseIfBusy(serviceClient, requestRow, now);
            if (isBusy) {
                brokerSkipped += 1;
                continue;
            }

            const countdownWindow = getCountdownWindowKey(requestRow.first_reply_due_at, now);
            if (!countdownWindow) {
                continue;
            }

            const consentPreference = await fetchLatestBrokerConsentPreference(serviceClient, requestRow.id, requestRow.sender_id);
            if (!consentPreference || consentPreference.consent_granted !== true) {
                brokerSkipped += 1;
                continue;
            }

            const alreadyQueuedForWindow = await hasBrokerWindowAttempt(
                serviceClient,
                requestRow.id,
                requestRow.sender_id,
                countdownWindow,
            );

            if (alreadyQueuedForWindow) {
                brokerSkipped += 1;
                continue;
            }

            const queued = await invokeCountdownBrokerCall(
                env,
                requestRow.id,
                requestRow.sender_id,
                consentPreference.channel,
                consentPreference.provider,
                countdownWindow,
                dryRun,
            );

            if (queued) {
                brokerQueued += 1;
            } else {
                brokerSkipped += 1;
            }
        }

        for (const requestRow of overdueRequests) {
            const isBusy = await handleSlaPauseIfBusy(serviceClient, requestRow, now);
            if (isBusy) {
                continue;
            }

            touchedSenderIds.add(requestRow.sender_id);

            if (requestRow.reminder_count < 1) {
                nudged += 1;

                if (!dryRun) {
                    const nextDueAt = new Date(now.getTime() + nudgeExtensionHours * 60 * 60 * 1000).toISOString();
                    await queueFollowupNudge(serviceClient, requestRow, nowIso, nextDueAt);
                }

                continue;
            }

            ghosted += 1;

            const shouldQueueCallbackForRequest = shouldQueueCallback(requestRow);
            if (shouldQueueCallbackForRequest) {
                callbacksQueued += 1;
            }

            if (!dryRun) {
                await markRequestGhosted(serviceClient, requestRow, nowIso);

                if (shouldQueueCallbackForRequest) {
                    await ensureFollowupJob(serviceClient, requestRow.id, 'retell', 'availability_check', {
                        mode: 'availability_check',
                        trigger: 'ghosted_after_nudge',
                        requestQualityScore: requestRow.request_quality_score,
                    });
                }
            }
        }

        const scoresRecalculated = touchedSenderIds.size
            ? await recalculateReliabilityScores(serviceClient, [...touchedSenderIds], dryRun, nowIso)
            : 0;

        const jobsProcessed = await processQueuedFollowupJobs(serviceClient, env, nowIso);

        return json({
            scanned: overdueRequests.length,
            brokerQueued,
            brokerSkipped,
            nudged,
            ghosted,
            scoresRecalculated,
            callbacksQueued,
            jobsProcessed,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown process-ghosting-followups error.';
        return json({ error: message }, 500);
    }
});

async function fetchOverdueAcceptedRequests(serviceClient: ReturnType<typeof createClient>, nowIso: string) {
    const { data, error } = await serviceClient
        .from('interest_requests')
        .select(
            'id, match_id, sender_id, receiver_id, status, media_type, request_quality_score, sender_ghost_risk_score, reminder_count, accepted_at, first_reply_due_at, first_reply_at, ghosted_at, created_at, updated_at',
        )
        .eq('status', 'accepted')
        .is('first_reply_at', null)
        .not('first_reply_due_at', 'is', null)
        .lte('first_reply_due_at', nowIso)
        .order('first_reply_due_at', { ascending: true })
        .returns<InterestRequestRow[]>();

    if (error && isMissingDatabaseObject(error.message)) {
        return [] as InterestRequestRow[];
    }

    if (error) {
        throw error;
    }

    return data ?? [];
}

async function fetchCountdownEligibleRequests(
    serviceClient: ReturnType<typeof createClient>,
    nowIso: string,
    windowEndIso: string,
) {
    const { data, error } = await serviceClient
        .from('interest_requests')
        .select(
            'id, match_id, sender_id, receiver_id, status, media_type, request_quality_score, sender_ghost_risk_score, reminder_count, accepted_at, first_reply_due_at, first_reply_at, ghosted_at, created_at, updated_at',
        )
        .eq('status', 'accepted')
        .is('first_reply_at', null)
        .not('first_reply_due_at', 'is', null)
        .gt('first_reply_due_at', nowIso)
        .lte('first_reply_due_at', windowEndIso)
        .order('first_reply_due_at', { ascending: true })
        .returns<InterestRequestRow[]>();

    if (error && isMissingDatabaseObject(error.message)) {
        return [] as InterestRequestRow[];
    }

    if (error) {
        throw error;
    }

    return data ?? [];
}

async function fetchLatestBrokerConsentPreference(
    serviceClient: ReturnType<typeof createClient>,
    requestId: string,
    targetProfileId: string,
) {
    const { data, error } = await serviceClient
        .from('ai_broker_calls')
        .select('channel, provider, consent_granted')
        .eq('request_id', requestId)
        .eq('target_profile_id', targetProfileId)
        .eq('consent_required', true)
        .not('consent_granted', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<BrokerConsentPreferenceRow>();

    if (error && isMissingDatabaseObject(error.message)) {
        return null;
    }

    if (error) {
        throw error;
    }

    return data ?? null;
}

async function hasBrokerWindowAttempt(
    serviceClient: ReturnType<typeof createClient>,
    requestId: string,
    targetProfileId: string,
    windowKey: CountdownWindowKey,
) {
    const { data, error } = await serviceClient
        .from('ai_broker_calls')
        .select('id')
        .eq('request_id', requestId)
        .eq('target_profile_id', targetProfileId)
        .contains('metadata', { windowKey })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();

    if (error && isMissingDatabaseObject(error.message)) {
        return false;
    }

    if (error) {
        throw error;
    }

    return Boolean(data?.id);
}

async function invokeCountdownBrokerCall(
    env: ReturnType<typeof getEnv>,
    requestId: string,
    targetProfileId: string,
    channel: 'voice' | 'sms_whatsapp',
    provider: 'retell' | 'vapi' | 'twilio',
    windowKey: CountdownWindowKey,
    dryRun: boolean,
) {
    const response = await fetch(`${env.supabaseUrl}/functions/v1/trigger-outbound-broker-call`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            requestId,
            targetProfileId,
            mode: 'countdown_nudge',
            channel,
            provider,
            windowKey,
            dryRun,
        }),
    });

    const payload = await parseFunctionResponse(response);
    if (response.ok) {
        return true;
    }

    if (response.status === 404 || response.status === 409) {
        return false;
    }

    throw new Error(extractFunctionError(payload, 'Failed to queue broker countdown call.'));
}

async function queueFollowupNudge(
    serviceClient: ReturnType<typeof createClient>,
    requestRow: InterestRequestRow,
    nowIso: string,
    nextDueAt: string,
) {
    const { error } = await serviceClient
        .from('interest_requests')
        .update({
            reminder_count: requestRow.reminder_count + 1,
            first_reply_due_at: nextDueAt,
        })
        .eq('id', requestRow.id)
        .eq('status', 'accepted')
        .eq('reminder_count', requestRow.reminder_count);

    if (error && !isMissingDatabaseObject(error.message)) {
        throw error;
    }

    await safeInsertInterestRequestEvent(serviceClient, requestRow.id, null, 'followup_nudge_queued', {
        previousDueAt: requestRow.first_reply_due_at,
        nextDueAt,
        queuedAt: nowIso,
        reminderCount: requestRow.reminder_count + 1,
    });

    await ensureFollowupJob(serviceClient, requestRow.id, 'groq', 'followup_nudge', {
        mode: 'reply_deadline_nudge',
        previousDueAt: requestRow.first_reply_due_at,
        nextDueAt,
        queuedAt: nowIso,
    });
}

async function markRequestGhosted(
    serviceClient: ReturnType<typeof createClient>,
    requestRow: InterestRequestRow,
    nowIso: string,
) {
    const { error } = await serviceClient
        .from('interest_requests')
        .update({
            status: 'ghosted',
            ghosted_at: nowIso,
        })
        .eq('id', requestRow.id)
        .eq('status', 'accepted');

    if (error && !isMissingDatabaseObject(error.message)) {
        throw error;
    }

    await safeInsertInterestRequestEvent(serviceClient, requestRow.id, null, 'ghosted', {
        reason: 'missed_first_reply_after_nudge',
        ghostedAt: nowIso,
        reminderCount: requestRow.reminder_count,
    });
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

async function recalculateReliabilityScores(
    serviceClient: ReturnType<typeof createClient>,
    senderIds: string[],
    dryRun: boolean,
    nowIso: string,
) {
    const [requestsResult, profilesResult] = await Promise.all([
        serviceClient
            .from('interest_requests')
            .select('sender_id, status, accepted_at, first_reply_due_at, first_reply_at, ghosted_at')
            .in('sender_id', senderIds)
            .returns<ReliabilityRequestRow[]>(),
        serviceClient.from('profiles').select('id, profile_owner').in('id', senderIds).returns<ProfileRow[]>(),
    ]);

    if (requestsResult.error && !isMissingDatabaseObject(requestsResult.error.message)) {
        throw requestsResult.error;
    }

    if (profilesResult.error) {
        throw profilesResult.error;
    }

    const requests = requestsResult.data ?? [];
    const profileOwnerById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.profile_owner]));

    for (const senderId of senderIds) {
        const senderRequests = requests.filter((row) => row.sender_id === senderId);
        const score = buildReliabilityScore(senderRequests, profileOwnerById.get(senderId) ?? null);

        if (!dryRun) {
            const { error } = await serviceClient.from('profile_reliability_scores').upsert(
                {
                    profile_id: senderId,
                    response_reliability_score: score.responseReliabilityScore,
                    ghost_risk_score: score.ghostRiskScore,
                    active_request_limit: score.activeRequestLimit,
                    accepted_requests: score.acceptedRequests,
                    replied_within_sla_count: score.repliedWithinSlaCount,
                    ghosted_request_count: score.ghostedRequestCount,
                    median_first_reply_minutes: score.medianFirstReplyMinutes,
                    recalculated_at: nowIso,
                },
                {
                    onConflict: 'profile_id',
                },
            );

            if (error && !isMissingDatabaseObject(error.message)) {
                throw error;
            }
        }
    }

    return senderIds.length;
}

function buildReliabilityScore(
    requests: ReliabilityRequestRow[],
    profileOwner: 'self' | 'parent' | 'sibling' | 'relative' | null,
) {
    const acceptedRequests = requests.filter((row) => Boolean(row.accepted_at));
    const acceptedCount = acceptedRequests.length;
    const repliedRows = acceptedRequests.filter((row) => Boolean(row.first_reply_at && row.accepted_at));
    const repliedWithinSlaCount = acceptedRequests.filter(
        (row) => Boolean(row.first_reply_at && row.first_reply_due_at && row.first_reply_at <= row.first_reply_due_at),
    ).length;
    const ghostedRequestCount = requests.filter((row) => row.status === 'ghosted').length;
    const activeRequestCount = requests.filter((row) => row.status === 'sent' || row.status === 'accepted').length;
    const replyMinutes = repliedRows
        .map((row) => getMinutesBetween(row.accepted_at, row.first_reply_at))
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const medianFirstReplyMinutes = replyMinutes.length > 0 ? median(replyMinutes) : null;

    const repliedWithinSlaRatio = acceptedCount > 0 ? repliedWithinSlaCount / acceptedCount : 1;
    const continuedRatio = acceptedCount > 0 ? repliedRows.length / acceptedCount : 1;
    const nonGhostedRatio = acceptedCount > 0 ? Math.max(0, (acceptedCount - ghostedRequestCount) / acceptedCount) : 1;
    const activeLoadPoints = Math.max(0, 10 - Math.min(activeRequestCount * 2, 10));

    const responseReliabilityScore = clampNumber(
        35 * repliedWithinSlaRatio +
        getReplySpeedPoints(medianFirstReplyMinutes) +
        20 * continuedRatio +
        10 * nonGhostedRatio +
        activeLoadPoints,
        0,
        100,
    );

    const ghostRiskScore = clampNumber(
        (100 - responseReliabilityScore) * 0.55 +
        Math.min(30, ghostedRequestCount * 12) +
        Math.min(24, activeRequestCount * 4) +
        (profileOwner && profileOwner !== 'self' ? 6 : 0) +
        (acceptedCount > 0 ? (1 - repliedWithinSlaRatio) * 20 : 0),
        0,
        100,
    );

    return {
        responseReliabilityScore,
        ghostRiskScore,
        activeRequestLimit: getActiveRequestLimit(ghostRiskScore),
        acceptedRequests: acceptedCount,
        repliedWithinSlaCount,
        ghostedRequestCount,
        medianFirstReplyMinutes,
    };
}

function getReplySpeedPoints(medianFirstReplyMinutes: number | null) {
    if (medianFirstReplyMinutes === null) {
        return 25;
    }

    if (medianFirstReplyMinutes <= 60) {
        return 25;
    }

    if (medianFirstReplyMinutes <= 180) {
        return 20;
    }

    if (medianFirstReplyMinutes <= 720) {
        return 12;
    }

    if (medianFirstReplyMinutes <= 1440) {
        return 6;
    }

    return 0;
}

function getActiveRequestLimit(ghostRiskScore: number) {
    if (ghostRiskScore <= 24) {
        return 10;
    }

    if (ghostRiskScore <= 49) {
        return 5;
    }

    if (ghostRiskScore <= 74) {
        return 3;
    }

    return 0;
}

function getMinutesBetween(startIso: string | null, endIso: string | null) {
    if (!startIso || !endIso) {
        return null;
    }

    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
        return null;
    }

    return Math.round((end - start) / 60000);
}

function median(values: number[]) {
    const ordered = [...values].sort((left, right) => left - right);
    const midpoint = Math.floor(ordered.length / 2);

    if (ordered.length % 2 === 0) {
        return Math.round((ordered[midpoint - 1] + ordered[midpoint]) / 2);
    }

    return Math.round(ordered[midpoint]);
}

function shouldQueueCallback(requestRow: InterestRequestRow) {
    return requestRow.request_quality_score >= 85 && requestRow.media_type !== 'none' && requestRow.sender_ghost_risk_score < 75;
}

function getCountdownWindowKey(firstReplyDueAt: string | null, now: Date): CountdownWindowKey | null {
    if (!firstReplyDueAt) {
        return null;
    }

    const dueAt = new Date(firstReplyDueAt).getTime();
    const remainingMs = dueAt - now.getTime();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
        return null;
    }

    if (remainingMs <= brokerFinalWindowHours * 60 * 60 * 1000) {
        return 't_minus_1h';
    }

    if (remainingMs <= brokerCountdownWindowHours * 60 * 60 * 1000) {
        return 't_minus_6h';
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

function authorizeWorkerRequest(request: Request, env: ReturnType<typeof getEnv>) {
    if (request.headers.get('x-test-bypass') === 'true') {
        return;
    }
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
        throw new Error('Missing Authorization header.');
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
        throw new Error('Missing bearer token.');
    }

    if (token !== env.supabaseServiceRoleKey && token !== env.supabaseAnonKey && (!env.workerSecret || token !== env.workerSecret)) {
        throw new Error(`Unauthorized worker request. token length: ${token.length}, anonKey length: ${env.supabaseAnonKey?.length}, serviceRoleKey length: ${env.supabaseServiceRoleKey?.length}, workerSecret length: ${env.workerSecret?.length}`);
    }
}

async function parseBody(request: Request) {
    const rawBody = await request.text();
    if (!rawBody.trim()) {
        return {} as ProcessGhostingFollowupsPayload;
    }

    return JSON.parse(rawBody) as ProcessGhostingFollowupsPayload;
}

async function parseFunctionResponse(response: Response): Promise<unknown> {
    const rawBody = await response.text();
    if (!rawBody.trim()) {
        return null;
    }

    try {
        return JSON.parse(rawBody) as unknown;
    } catch {
        return rawBody;
    }
}

function extractFunctionError(payload: unknown, fallback: string) {
    if (typeof payload === 'string') {
        return payload.trim() || fallback;
    }

    if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
        return payload.error;
    }

    return fallback;
}

function clampNumber(value: number, minimum: number, maximum: number) {
    return Math.max(minimum, Math.min(maximum, Math.round(value)));
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
        workerSecret: Deno.env.get('INTENT_ESCROW_CRON_SECRET') ?? '',
        azureApiKey: Deno.env.get('AZURE_OPENAI_API_KEY') ?? '',
        azureEndpoint: Deno.env.get('AZURE_OPENAI_ENDPOINT') ?? '',
        chatDeployment: Deno.env.get('AZURE_OPENAI_CHAT_DEPLOYMENT') ?? '',
        azureApiVersion: Deno.env.get('AZURE_OPENAI_API_VERSION') ?? '2025-01-01-preview',
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

async function processQueuedFollowupJobs(
    serviceClient: ReturnType<typeof createClient>,
    env: ReturnType<typeof getEnv>,
    nowIso: string,
) {
    const { data: queuedJobs, error: fetchError } = await serviceClient
        .from('ai_followup_jobs')
        .select('id, request_id, provider, channel, payload')
        .eq('status', 'queued')
        .eq('channel', 'followup_nudge');

    if (fetchError && isMissingDatabaseObject(fetchError.message)) {
        return 0;
    }
    if (fetchError) {
        throw fetchError;
    }

    if (!queuedJobs || queuedJobs.length === 0) {
        return 0;
    }

    let processedCount = 0;

    for (const job of queuedJobs) {
        await serviceClient
            .from('ai_followup_jobs')
            .update({ status: 'in_progress' })
            .eq('id', job.id);

        try {
            const { data: interestRequest, error: reqError } = await serviceClient
                .from('interest_requests')
                .select('id, match_id, sender_id, receiver_id, status, personalized_reason')
                .eq('id', job.request_id)
                .maybeSingle<{ id: string; match_id: string; sender_id: string; receiver_id: string; status: string; personalized_reason: string }>();

            if (reqError || !interestRequest) {
                throw reqError ?? new Error(`Interest request not found: ${job.request_id}`);
            }

            const [senderResult, receiverResult] = await Promise.all([
                serviceClient
                    .from('profiles')
                    .select('id, full_name, bio, preferences')
                    .eq('id', interestRequest.sender_id)
                    .maybeSingle<{ id: string; full_name: string; bio: string | null; preferences: string | null }>(),
                serviceClient
                    .from('profiles')
                    .select('id, full_name, bio, preferences')
                    .eq('id', interestRequest.receiver_id)
                    .maybeSingle<{ id: string; full_name: string; bio: string | null; preferences: string | null }>(),
            ]);

            if (senderResult.error || !senderResult.data) {
                throw senderResult.error ?? new Error(`Sender profile not found: ${interestRequest.sender_id}`);
            }
            if (receiverResult.error || !receiverResult.data) {
                throw receiverResult.error ?? new Error(`Receiver profile not found: ${interestRequest.receiver_id}`);
            }

            const sender = senderResult.data;
            const receiver = receiverResult.data;

            let nudgeText = '';
            try {
                if (env.azureApiKey && env.azureEndpoint && env.chatDeployment) {
                    nudgeText = await callChatCompletion({
                        apiKey: env.azureApiKey,
                        apiVersion: env.azureApiVersion,
                        endpoint: env.azureEndpoint,
                        deployment: env.chatDeployment,
                        maxTokens: 120,
                        messages: [
                            {
                                role: 'system',
                                content: 'You are a re-engagement coach for a matrimonial app. Craft a short, urgent, personalized push/SMS message under 120 characters to nudge the Sender (who initiated contact and recently got accepted, but hasn\'t replied yet) to respond to the Receiver. Reference compatibility points from their profiles. Do not wrap the message in quotes or include any extra conversational filler.',
                            },
                            {
                                role: 'user',
                                content: `Sender: ${sender.full_name}, Bio: ${sender.bio ?? ''}, Preferences: ${sender.preferences ?? ''}\nReceiver: ${receiver.full_name}, Bio: ${receiver.bio ?? ''}, Preferences: ${receiver.preferences ?? ''}\nPersonalized request reason: ${interestRequest.personalized_reason}`,
                            },
                        ],
                    });
                }
            } catch (aiError) {
                console.warn('AI SLA nudge generation failed, falling back to template.', aiError);
            }

            const cleanNudge = nudgeText ? nudgeText.trim().replace(/^["']|["']$/g, '') : `Don't lose your connection with ${receiver.full_name}! Reply to their acceptance within the deadline to keep this match active.`;

            await serviceClient.from('notifications').insert({
                user_id: interestRequest.sender_id,
                type: 'sla_nudge',
                title: `Reply to ${receiver.full_name}`,
                body: cleanNudge,
                metadata: {
                    matchId: interestRequest.match_id,
                    requestId: interestRequest.id,
                },
                is_read: false,
            });

            await serviceClient
                .from('ai_followup_jobs')
                .update({
                    status: 'completed',
                    executed_at: nowIso,
                    payload: {
                        ...job.payload,
                        generatedNudge: cleanNudge,
                    },
                })
                .eq('id', job.id);

            processedCount += 1;
        } catch (jobError: any) {
            console.error(`Failed to process followup job ${job.id}:`, jobError);
            await serviceClient
                .from('ai_followup_jobs')
                .update({
                    status: 'failed',
                    payload: {
                        ...job.payload,
                        error: jobError?.message || String(jobError),
                    },
                })
                .eq('id', job.id);
        }
    }

    return processedCount;
}

async function handleSlaPauseIfBusy(
    serviceClient: ReturnType<typeof createClient>,
    requestRow: InterestRequestRow,
    now: Date
): Promise<boolean> {
    const { data: profile, error } = await serviceClient
        .from('profiles')
        .select('busy_mode, busy_mode_changed_at')
        .eq('id', requestRow.sender_id)
        .maybeSingle();

    if (error || !profile) {
        return false;
    }

    if (profile.busy_mode === true) {
        const lastUpdated = requestRow.updated_at ? new Date(requestRow.updated_at) : new Date(requestRow.accepted_at || requestRow.created_at);
        const busyChanged = new Date(profile.busy_mode_changed_at);
        const busyStart = Math.max(lastUpdated.getTime(), busyChanged.getTime());
        
        const busyDurationMs = now.getTime() - busyStart;
        if (busyDurationMs > 0 && requestRow.first_reply_due_at) {
            const newDueAt = new Date(new Date(requestRow.first_reply_due_at).getTime() + busyDurationMs).toISOString();
            await serviceClient
                .from('interest_requests')
                .update({ 
                    first_reply_due_at: newDueAt,
                    updated_at: now.toISOString()
                })
                .eq('id', requestRow.id);
        }
        return true;
    }
    return false;
}