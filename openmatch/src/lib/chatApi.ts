import { RealtimeChannel } from '@supabase/supabase-js';

import {
    BrokerCallStatus,
    BrokerCallSummary,
    ChatMatch,
    MatchInterestRequest,
    ChatMessage,
    FollowupJobSummary,
    MatchUnlockAction,
    MatchRequestState,
    MatchUnlockState,
    SendEscrowMessageResult,
    TriggerIntentCallbackMode,
    TriggerIntentCallbackResult,
    UnlockPaymentIntent,
    UpdateMatchUnlockResult,
} from './chat';
import { supabase } from './supabase';

// In-memory cache of the currently authenticated user. supabase.auth.getUser()
// hits the network on web, and almost every helper below needs the user, so we
// verify once then reuse. The cache is invalidated automatically on any auth
// state change (sign in / sign out / token refresh) so it never goes stale.
type CachedUser = Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'];
let cachedCurrentUser: CachedUser | null = null;
let cachedCurrentUserPromise: Promise<NonNullable<CachedUser>> | null = null;

supabase.auth.onAuthStateChange(() => {
    cachedCurrentUser = null;
    cachedCurrentUserPromise = null;
    cachedChatMatches = null;
});

type MatchRow = {
    id: string;
    user_1_id: string;
    user_2_id: string;
    status: string;
    is_unlocked: boolean;
    created_at: string;
};

type MatchUnlockRow = {
    match_id: string;
    requested_by: string;
    status: Exclude<MatchUnlockState['status'], 'none'>;
    user_1_accepted_at: string | null;
    user_2_accepted_at: string | null;
    user_1_paid_at: string | null;
    user_2_paid_at: string | null;
    declined_by: string | null;
};

type ProfileRow = {
    id: string;
    full_name: string;
    photo_urls: string[] | null;
    location: string;
    bio: string | null;
    preferences: string | null;
    profile_owner: ChatMatch['otherUserProfileOwner'];
    verification_status?: 'unverified' | 'pending' | 'verified' | 'rejected';
};

type ProfileContactRow = {
    profile_id: string;
    phone_number: string | null;
    whatsapp_number: string | null;
};

type MessageRow = {
    id: string;
    match_id: string;
    sender_id: string;
    content: string;
    is_flagged_by_system: boolean;
    read_at?: string | null;
    created_at: string;
};

type MatchListMessageRow = Pick<MessageRow, 'id' | 'match_id' | 'sender_id' | 'read_at' | 'created_at'>;

type InterestRequestRow = {
    id: string;
    match_id: string;
    sender_id: string;
    receiver_id: string;
    status: MatchInterestRequest['status'];
    personalized_reason: string;
    media_type: MatchInterestRequest['mediaType'];
    media_url: string | null;
    request_quality_score: number;
    sender_ghost_risk_score: number;
    accepted_at: string | null;
    first_reply_due_at: string | null;
    first_reply_at: string | null;
    ghosted_at: string | null;
    created_at: string;
    updated_at: string;
    sla_extended?: boolean;
};

type SendEscrowMessageResponse = {
    message?: MessageRow;
    blocked?: boolean;
    notice?: string | null;
    unlocked?: boolean;
};

type CreateUnlockPaymentIntentResponse = {
    alreadyUnlocked?: boolean;
    clientSecret?: string | null;
    paymentIntentId?: string | null;
    amount?: number;
    currency?: string;
    merchantDisplayName?: string;
    reused?: boolean;
};

type UpdateMatchUnlockResponse = {
    message?: string | null;
    state?: MatchUnlockState | null;
};

type ManageMatchRequestResponse = {
    action?: string;
    notice?: string | null;
};

type RespondInterestRequestResponse = {
    action?: string;
    requestId?: string | null;
    matchId?: string;
    notice?: string | null;
    firstReplyDueAt?: string | null;
};

type TriggerIntentCallbackResponse = {
    jobId?: string;
    provider?: string;
    status?: string;
};

type SendBrokerConsentResponse = {
    requestId?: string;
    consentRecorded?: boolean;
    consentStatus?: 'granted' | 'declined';
    preferredChannel?: 'voice' | 'sms_whatsapp';
    nextAction?: string;
    brokerCallId?: string | null;
};

type TriggerOutboundBrokerCallResponse = {
    brokerCallId?: string | null;
    requestId?: string;
    status?: string;
    provider?: string;
    channel?: 'voice' | 'sms_whatsapp';
    scheduledFor?: string;
    notice?: string;
};

type BrokerCallRow = {
    request_id: string;
    sender_profile_id: string;
    receiver_profile_id: string;
    target_profile_id: string;
    status: BrokerCallStatus;
    consent_required: boolean;
    consent_granted: boolean | null;
    channel: 'voice' | 'sms_whatsapp';
    provider: 'retell' | 'vapi' | 'twilio';
    scheduled_for: string | null;
    ended_at: string | null;
    outcome: string | null;
    summary: Record<string, unknown> | null;
    created_at: string;
};

type FollowupJobRow = {
    request_id: string;
    provider: string;
    channel: string;
    status: string;
    payload: Record<string, unknown> | null;
    executed_at: string | null;
    created_at: string;
};

function buildDefaultUnlockState(isUnlocked: boolean): MatchUnlockState {
    if (isUnlocked) {
        return {
            status: 'completed',
            requestedByUserId: null,
            declinedByUserId: null,
            hasCurrentUserAccepted: true,
            hasOtherUserAccepted: true,
            hasCurrentUserPaid: true,
            hasOtherUserPaid: true,
            canRequest: false,
            canAccept: false,
            canPay: false,
            waitingOn: 'none',
        };
    }

    return {
        status: 'none',
        requestedByUserId: null,
        declinedByUserId: null,
        hasCurrentUserAccepted: false,
        hasOtherUserAccepted: false,
        hasCurrentUserPaid: false,
        hasOtherUserPaid: false,
        canRequest: true,
        canAccept: false,
        canPay: false,
        waitingOn: 'none',
    };
}

function buildUnlockState(match: MatchRow, unlock: MatchUnlockRow | null, currentUserId: string): MatchUnlockState {
    if (match.is_unlocked) {
        return buildDefaultUnlockState(true);
    }

    if (!unlock) {
        return buildDefaultUnlockState(false);
    }

    const isUser1 = match.user_1_id === currentUserId;
    const currentAcceptedAt = isUser1 ? unlock.user_1_accepted_at : unlock.user_2_accepted_at;
    const otherAcceptedAt = isUser1 ? unlock.user_2_accepted_at : unlock.user_1_accepted_at;
    const currentPaidAt = isUser1 ? unlock.user_1_paid_at : unlock.user_2_paid_at;
    const otherPaidAt = isUser1 ? unlock.user_2_paid_at : unlock.user_1_paid_at;

    let waitingOn: MatchUnlockState['waitingOn'] = 'none';
    if (unlock.status === 'awaiting_response' && currentAcceptedAt) {
        waitingOn = 'other_acceptance';
    }

    if (unlock.status === 'awaiting_payment') {
        if (!currentPaidAt) {
            waitingOn = 'your_payment';
        } else if (!otherPaidAt) {
            waitingOn = 'other_payment';
        }
    }

    return {
        status: unlock.status,
        requestedByUserId: unlock.requested_by,
        declinedByUserId: unlock.declined_by,
        hasCurrentUserAccepted: Boolean(currentAcceptedAt),
        hasOtherUserAccepted: Boolean(otherAcceptedAt),
        hasCurrentUserPaid: Boolean(currentPaidAt),
        hasOtherUserPaid: Boolean(otherPaidAt),
        canRequest: unlock.status === 'declined',
        canAccept: unlock.status === 'awaiting_response' && !currentAcceptedAt,
        canPay: unlock.status === 'awaiting_payment' && !currentPaidAt,
        waitingOn,
    };
}

function isMissingMatchUnlockTable(error: { message?: string } | null | undefined) {
    const message = error?.message ?? '';
    return /match_unlocks|match_unlock_payment_attempts/i.test(message) && /(does not exist|relation)/i.test(message);
}

function isMissingInterestRequestsTable(error: { message?: string } | null | undefined) {
    const message = error?.message ?? '';
    return /interest_requests/i.test(message) && /(does not exist|relation)/i.test(message);
}

function isMissingBrokerCallsTable(error: { message?: string } | null | undefined) {
    const message = error?.message ?? '';
    return /ai_broker_calls/i.test(message) && /(does not exist|relation)/i.test(message);
}

function isMissingFollowupJobsTable(error: { message?: string } | null | undefined) {
    const message = error?.message ?? '';
    return /ai_followup_jobs/i.test(message) && /(does not exist|relation)/i.test(message);
}

function buildEmptyBrokerSummary(requestId: string): BrokerCallSummary {
    return {
        requestId,
        currentUserConsent: 'unknown',
        otherUserConsent: 'unknown',
        latestStatus: null,
        latestChannel: null,
        latestProvider: null,
        latestScheduledFor: null,
        latestEndedAt: null,
        latestOutcome: null,
        latestSummary: null,
        attemptCount: 0,
    };
}

function summarizeBrokerCallRows(requestId: string, currentUserId: string, brokerRows: BrokerCallRow[]): BrokerCallSummary {
    if (brokerRows.length === 0) {
        return buildEmptyBrokerSummary(requestId);
    }

    const latest = brokerRows[0];
    const otherUserId = latest.sender_profile_id === currentUserId ? latest.receiver_profile_id : latest.sender_profile_id;

    return {
        requestId,
        currentUserConsent: resolveConsentStatus(brokerRows, currentUserId),
        otherUserConsent: resolveConsentStatus(brokerRows, otherUserId),
        latestStatus: latest.status,
        latestChannel: latest.channel,
        latestProvider: latest.provider,
        latestScheduledFor: latest.scheduled_for,
        latestEndedAt: latest.ended_at,
        latestOutcome: latest.outcome,
        latestSummary: latest.summary ?? null,
        attemptCount: brokerRows.filter((row) => isAttemptStatus(row.status)).length,
    };
}

function summarizeFollowupJobRows(requestId: string, followupRows: FollowupJobRow[]): FollowupJobSummary | null {
    if (followupRows.length === 0) {
        return null;
    }

    const latest = followupRows[0];

    return {
        requestId,
        latestJob: {
            channel: latest.channel,
            status: latest.status,
            provider: latest.provider,
            createdAt: latest.created_at,
            executedAt: latest.executed_at ?? null,
            payload: latest.payload ?? null,
        },
        jobCount: followupRows.length,
    };
}

function mapMessage(row: MessageRow): ChatMessage {
    return {
        id: row.id,
        matchId: row.match_id,
        senderId: row.sender_id,
        content: row.content,
        isFlaggedBySystem: row.is_flagged_by_system,
        readAt: row.read_at ?? null,
        createdAt: row.created_at,
    };
}

function mapInterestRequest(row: InterestRequestRow): MatchInterestRequest {
    return {
        id: row.id,
        matchId: row.match_id,
        senderId: row.sender_id,
        receiverId: row.receiver_id,
        status: row.status,
        personalizedReason: row.personalized_reason,
        mediaType: row.media_type,
        mediaUrl: row.media_url ?? null,
        requestQualityScore: row.request_quality_score,
        senderGhostRiskScore: row.sender_ghost_risk_score,
        acceptedAt: row.accepted_at ?? null,
        firstReplyDueAt: row.first_reply_due_at ?? null,
        firstReplyAt: row.first_reply_at ?? null,
        ghostedAt: row.ghosted_at ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        slaExtended: row.sla_extended,
    };
}

async function requireCurrentUser() {
    // supabase.auth.getUser() performs a network round-trip on web (it verifies
    // the access token with the auth server). Nearly every helper in this file
    // calls it, so the same "user" request was firing many times per screen
    // open. Cache the verified user in memory for the lifetime of the session
    // and invalidate it whenever auth state changes, so behaviour is identical
    // but we avoid the redundant round-trips.
    if (cachedCurrentUser) {
        return cachedCurrentUser;
    }

    if (!cachedCurrentUserPromise) {
        cachedCurrentUserPromise = (async () => {
            const {
                data: { user },
                error,
            } = await supabase.auth.getUser();

            if (error) {
                throw error;
            }

            if (!user) {
                throw new Error('You must be signed in to continue.');
            }

            cachedCurrentUser = user;
            return user;
        })().finally(() => {
            cachedCurrentUserPromise = null;
        });
    }

    return cachedCurrentUserPromise;
}

// Cache of the last successfully fetched match list. This lets the Inbox/Chat
// screens paint instantly from cache (stale-while-revalidate) instead of
// showing a full-screen spinner on every open, while a fresh fetch runs in the
// background. Cleared on sign out so no data leaks between accounts.
let cachedChatMatches: ChatMatch[] | null = null;
// Deduplicate concurrent fetchChatMatches calls — if one is already in-flight,
// all additional callers attach to the same promise instead of firing new DB queries.
let cachedFetchMatchesPromise: Promise<ChatMatch[]> | null = null;

export function getCachedChatMatches() {
    return cachedChatMatches;
}

export async function fetchChatMatches(): Promise<ChatMatch[]> {
    if (cachedFetchMatchesPromise) {
        return cachedFetchMatchesPromise;
    }

    cachedFetchMatchesPromise = _doFetchChatMatches().finally(() => {
        cachedFetchMatchesPromise = null;
    });

    return cachedFetchMatchesPromise;
}

async function _doFetchChatMatches(): Promise<ChatMatch[]> {
    const user = await requireCurrentUser();

    const { data: matchRows, error: matchesError } = await supabase
        .from('matches')
        .select('id, user_1_id, user_2_id, status, is_unlocked, created_at')
        .or(`user_1_id.eq.${user.id},user_2_id.eq.${user.id}`)
        .order('created_at', { ascending: false })
        .returns<MatchRow[]>();

    if (matchesError) {
        throw matchesError;
    }

    const { data: blockRows, error: blocksError } = await supabase
        .from('user_blocks')
        .select('blocker_id, blocked_id')
        .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`);

    if (blocksError) {
        throw blocksError;
    }

    const blockedUserIds = new Set<string>();
    if (blockRows) {
        for (const block of blockRows) {
            blockedUserIds.add(block.blocker_id === user.id ? block.blocked_id : block.blocker_id);
        }
    }

    if (!matchRows || matchRows.length === 0) {
        return [] as ChatMatch[];
    }

    const activeMatchRows = matchRows.filter((match) => {
        const otherId = match.user_1_id === user.id ? match.user_2_id : match.user_1_id;
        return !blockedUserIds.has(otherId);
    });

    if (activeMatchRows.length === 0) {
        return [] as ChatMatch[];
    }

    const matchIds = activeMatchRows.map((match) => match.id);

    const otherUserIds = [...new Set(activeMatchRows.map((match) => (match.user_1_id === user.id ? match.user_2_id : match.user_1_id)))];

    // These five queries are independent (they only depend on matchIds /
    // otherUserIds), so run them concurrently instead of as a sequential
    // waterfall. This collapses ~5 round-trips into a single round-trip worth
    // of latency, which is the biggest win for Inbox/Chat open time.
    const [
        { data: profileRows, error: profilesError },
        { data: profileContactRows, error: profileContactsError },
        unlocksResult,
        messagesResult,
        interestRequestsResult,
    ] = await Promise.all([
        supabase
            .from('profiles')
            .select('id, full_name, photo_urls, location, bio, preferences, profile_owner, verification_status')
            .in('id', otherUserIds)
            .returns<ProfileRow[]>(),
        supabase
            .from('profile_contact_details')
            .select('profile_id, phone_number, whatsapp_number')
            .in('profile_id', otherUserIds)
            .returns<ProfileContactRow[]>(),
        supabase
            .from('match_unlocks')
            .select('match_id, requested_by, status, user_1_accepted_at, user_2_accepted_at, user_1_paid_at, user_2_paid_at, declined_by')
            .in('match_id', matchIds)
            .returns<MatchUnlockRow[]>(),
        supabase
            .from('messages')
            .select('id, match_id, sender_id, read_at, created_at')
            .in('match_id', matchIds)
            .order('created_at', { ascending: true })
            .limit(500)
            .returns<MatchListMessageRow[]>(),
        supabase
            .from('interest_requests')
            .select('id, match_id, sender_id, receiver_id, status, personalized_reason, media_type, media_url, request_quality_score, sender_ghost_risk_score, accepted_at, first_reply_due_at, first_reply_at, ghosted_at, created_at, updated_at, sla_extended')
            .in('match_id', matchIds)
            .order('created_at', { ascending: false })
            .returns<InterestRequestRow[]>(),
    ]);

    if (profilesError) {
        throw profilesError;
    }

    if (profileContactsError) {
        throw profileContactsError;
    }

    if (unlocksResult.error && !isMissingMatchUnlockTable(unlocksResult.error)) {
        throw unlocksResult.error;
    }

    if (messagesResult.error) {
        throw messagesResult.error;
    }

    if (interestRequestsResult.error && !isMissingInterestRequestsTable(interestRequestsResult.error)) {
        throw interestRequestsResult.error;
    }

    const requestIds = [...new Set((interestRequestsResult.data ?? []).map((request) => request.id))];
    const brokerCallSummariesByRequestId = new Map<string, BrokerCallSummary>();
    const followupJobSummariesByRequestId = new Map<string, FollowupJobSummary>();

    if (requestIds.length > 0) {
        const [brokerCallsResult, followupJobsResult] = await Promise.all([
            supabase
                .from('ai_broker_calls')
                .select(
                    'request_id, sender_profile_id, receiver_profile_id, target_profile_id, status, consent_required, consent_granted, channel, provider, scheduled_for, ended_at, outcome, summary, created_at',
                )
                .in('request_id', requestIds)
                .order('created_at', { ascending: false })
                .returns<BrokerCallRow[]>(),
            supabase
                .from('ai_followup_jobs')
                .select('request_id, provider, channel, status, payload, executed_at, created_at')
                .in('request_id', requestIds)
                .order('created_at', { ascending: false })
                .returns<FollowupJobRow[]>(),
        ]);

        if (brokerCallsResult.error && !isMissingBrokerCallsTable(brokerCallsResult.error)) {
            throw brokerCallsResult.error;
        }

        if (followupJobsResult.error && !isMissingFollowupJobsTable(followupJobsResult.error)) {
            throw followupJobsResult.error;
        }

        const brokerRowsByRequestId = new Map<string, BrokerCallRow[]>();
        for (const row of brokerCallsResult.data ?? []) {
            const rows = brokerRowsByRequestId.get(row.request_id) ?? [];
            rows.push(row);
            brokerRowsByRequestId.set(row.request_id, rows);
        }

        const followupRowsByRequestId = new Map<string, FollowupJobRow[]>();
        for (const row of followupJobsResult.data ?? []) {
            const rows = followupRowsByRequestId.get(row.request_id) ?? [];
            rows.push(row);
            followupRowsByRequestId.set(row.request_id, rows);
        }

        for (const requestId of requestIds) {
            brokerCallSummariesByRequestId.set(
                requestId,
                summarizeBrokerCallRows(requestId, user.id, brokerRowsByRequestId.get(requestId) ?? []),
            );

            const followupSummary = summarizeFollowupJobRows(requestId, followupRowsByRequestId.get(requestId) ?? []);
            if (followupSummary) {
                followupJobSummariesByRequestId.set(requestId, followupSummary);
            }
        }
    }

    const profilesById = new Map(profileRows?.map((profile) => [profile.id, profile]));
    const profileContactsById = new Map((profileContactRows ?? []).map((contact) => [contact.profile_id, contact]));
    const unlocksByMatchId = new Map((unlocksResult.data ?? []).map((unlock) => [unlock.match_id, unlock]));
    const unreadCountByMatchId = new Map<string, number>();
    const firstMessageSenderByMatchId = new Map<string, string>();
    const interestRequestByMatchId = new Map<string, MatchInterestRequest>();

    for (const request of interestRequestsResult.data ?? []) {
        if (!interestRequestByMatchId.has(request.match_id)) {
            interestRequestByMatchId.set(request.match_id, mapInterestRequest(request));
        }
    }

    for (const message of messagesResult.data ?? []) {
        if (!firstMessageSenderByMatchId.has(message.match_id)) {
            firstMessageSenderByMatchId.set(message.match_id, message.sender_id);
        }

        if (message.sender_id !== user.id && !message.read_at) {
            unreadCountByMatchId.set(
                message.match_id,
                (unreadCountByMatchId.get(message.match_id) ?? 0) + 1,
            );
        }
    }

    const result = matchRows
        .map((match) => {
            const otherUserId = match.user_1_id === user.id ? match.user_2_id : match.user_1_id;
            const profile = profilesById.get(otherUserId);
            const contactDetails = profileContactsById.get(otherUserId);
            const firstMessageSenderId = firstMessageSenderByMatchId.get(match.id) ?? null;
            const interestRequest = interestRequestByMatchId.get(match.id) ?? null;

            if (!profile) {
                return null;
            }

            let matchRequestState: MatchRequestState = 'none';
            if (interestRequest?.status === 'sent') {
                if (interestRequest.senderId === user.id) {
                    matchRequestState = 'sent';
                } else if (interestRequest.receiverId === user.id) {
                    matchRequestState = 'received';
                }
            } else if (match.status === 'pending') {
                if (firstMessageSenderId === user.id) {
                    matchRequestState = 'sent';
                } else if (typeof firstMessageSenderId === 'string') {
                    matchRequestState = 'received';
                }
            }

            return {
                id: match.id,
                otherUserId,
                otherUserName: profile.full_name,
                otherUserPhotoUrls: Array.isArray(profile.photo_urls)
                    ? profile.photo_urls.filter((photoUrl): photoUrl is string => typeof photoUrl === 'string')
                    : [],
                otherUserPhoneNumber: contactDetails?.phone_number ?? null,
                otherUserWhatsappNumber: contactDetails?.whatsapp_number ?? null,
                otherUserLocation: profile.location,
                otherUserBio: profile.bio,
                otherUserPreferences: profile.preferences,
                otherUserProfileOwner: profile.profile_owner,
                status: match.status,
                matchRequestState,
                interestRequest,
                brokerSummary: interestRequest
                    ? brokerCallSummariesByRequestId.get(interestRequest.id) ?? buildEmptyBrokerSummary(interestRequest.id)
                    : null,
                followupJobSummary: interestRequest ? followupJobSummariesByRequestId.get(interestRequest.id) ?? null : null,
                isUnlocked: match.is_unlocked,
                unreadCount: unreadCountByMatchId.get(match.id) ?? 0,
                unlockState: buildUnlockState(match, unlocksByMatchId.get(match.id) ?? null, user.id),
                createdAt: match.created_at,
                otherUserVerificationStatus: profile.verification_status || 'unverified',
            } satisfies ChatMatch;
        })
        .filter((match): match is ChatMatch => Boolean(match));

    cachedChatMatches = result;
    return result;
}

export async function fetchChatMessages(matchId: string) {
    const { data, error } = await supabase
        .from('messages')
        .select('id, match_id, sender_id, content, is_flagged_by_system, read_at, created_at')
        .eq('match_id', matchId)
        .order('created_at', { ascending: true })
        .returns<MessageRow[]>();

    if (error) {
        throw error;
    }

    return (data ?? []).map(mapMessage);
}

export async function sendEscrowMessage(matchId: string, content: string): Promise<SendEscrowMessageResult> {
    const { data, error } = await supabase.functions.invoke('send-escrow-message', {
        body: { matchId, content },
    });

    if (error) {
        throw error;
    }

    const payload = data as SendEscrowMessageResponse | null;
    if (!payload?.message) {
        throw new Error('Escrow send response did not include a stored message.');
    }

    return {
        message: mapMessage(payload.message),
        blocked: Boolean(payload.blocked),
        notice: payload.notice ?? null,
        unlocked: Boolean(payload.unlocked),
    };
}

export async function extendSlaDeadline(requestId: string): Promise<MatchInterestRequest> {
    const { data, error } = await supabase.functions.invoke('extend-sla', {
        body: { requestId },
    });

    if (error) {
        throw error;
    }

    const payload = data as { success: boolean; updatedRequest: InterestRequestRow } | null;
    if (!payload?.updatedRequest) {
        throw new Error('SLA extension response did not include the updated request.');
    }

    return mapInterestRequest(payload.updatedRequest);
}

export async function createUnlockPaymentIntent(matchId: string): Promise<UnlockPaymentIntent> {
    const { data, error } = await supabase.functions.invoke('create-unlock-payment-intent', {
        body: { matchId },
    });

    if (error) {
        throw error;
    }

    const payload = data as CreateUnlockPaymentIntentResponse | null;
    if (
        !payload ||
        typeof payload.alreadyUnlocked !== 'boolean' ||
        typeof payload.amount !== 'number' ||
        typeof payload.currency !== 'string' ||
        typeof payload.merchantDisplayName !== 'string'
    ) {
        throw new Error('Unlock payment response was incomplete.');
    }

    if (!payload.alreadyUnlocked && typeof payload.clientSecret !== 'string') {
        throw new Error('Unlock payment response did not include a client secret.');
    }

    return {
        alreadyUnlocked: payload.alreadyUnlocked,
        clientSecret: typeof payload.clientSecret === 'string' ? payload.clientSecret : null,
        paymentIntentId: typeof payload.paymentIntentId === 'string' ? payload.paymentIntentId : null,
        amount: payload.amount,
        currency: payload.currency.toLowerCase(),
        merchantDisplayName: payload.merchantDisplayName,
        reused: Boolean(payload.reused),
    };
}

export async function updateMatchUnlock(matchId: string, action: MatchUnlockAction): Promise<UpdateMatchUnlockResult> {
    const { data, error } = await supabase.functions.invoke('update-match-unlock', {
        body: { matchId, action },
    });

    if (error) {
        throw error;
    }

    const payload = data as UpdateMatchUnlockResponse | null;
    return {
        message: payload?.message ?? null,
        state: payload?.state ?? null,
    };
}

export async function acceptMatchRequest(matchId: string) {
    const { data, error } = await supabase.functions.invoke('respond-interest-request', {
        body: { action: 'accept', matchId },
    });

    if (error) {
        throw error;
    }

    const payload = data as RespondInterestRequestResponse | null;
    if (!payload?.action) {
        throw new Error('Match request response was incomplete.');
    }

    return {
        action: payload.action,
        requestId: payload.requestId ?? null,
        matchId: payload.matchId ?? matchId,
        notice: payload.notice ?? null,
        firstReplyDueAt: payload.firstReplyDueAt ?? null,
    };
}

export async function declineMatchRequest(matchId: string) {
    const { data, error } = await supabase.functions.invoke('respond-interest-request', {
        body: { action: 'decline', matchId },
    });

    if (error) {
        throw error;
    }

    const payload = data as RespondInterestRequestResponse | null;
    if (!payload?.action) {
        throw new Error('Match request response was incomplete.');
    }

    return {
        action: payload.action,
        requestId: payload.requestId ?? null,
        matchId: payload.matchId ?? matchId,
        notice: payload.notice ?? null,
    };
}

export async function fetchChatMatchById(matchId: string) {
    const matches = await fetchChatMatches();
    return matches.find((match) => match.id === matchId) ?? null;
}

export async function markMatchMessagesRead(matchId: string) {
    const { data, error } = await supabase.rpc('mark_match_messages_read', {
        target_match_id: matchId,
    });

    if (error) {
        throw error;
    }

    return typeof data === 'number' ? data : 0;
}

export async function markInterestRequestFirstReply(requestId: string) {
    const { data, error } = await supabase.rpc('mark_interest_request_first_reply', {
        target_request_id: requestId,
    });

    if (error) {
        throw error;
    }

    return typeof data === 'number' ? data : 0;
}

export async function triggerIntentCallback(
    requestId: string,
    mode: TriggerIntentCallbackMode = 'availability_check',
): Promise<TriggerIntentCallbackResult> {
    const { data, error } = await supabase.functions.invoke('trigger-intent-callback', {
        body: {
            requestId,
            mode,
        },
    });

    if (error) {
        throw error;
    }

    const payload = data as TriggerIntentCallbackResponse | null;
    if (!payload?.jobId || !payload.provider || !payload.status) {
        throw new Error('Trigger callback response was incomplete.');
    }

    return {
        jobId: payload.jobId,
        provider: payload.provider,
        status: payload.status,
    };
}

export async function sendBrokerConsent(
    requestId: string,
    consent: boolean,
    preferredChannel: 'voice' | 'sms_whatsapp' = 'voice',
    preferredProvider: 'retell' | 'twilio' = preferredChannel === 'sms_whatsapp' ? 'twilio' : 'retell',
) {
    const { data, error } = await supabase.functions.invoke('send-broker-consent', {
        body: {
            requestId,
            consent,
            preferredChannel,
            preferredProvider,
            locale: 'en-IN',
        },
    });

    if (error) {
        throw error;
    }

    const payload = data as SendBrokerConsentResponse | null;
    if (!payload?.requestId || typeof payload.consentRecorded !== 'boolean') {
        throw new Error('Broker consent response was incomplete.');
    }

    return {
        requestId: payload.requestId,
        consentRecorded: payload.consentRecorded,
        consentStatus: payload.consentStatus ?? 'declined',
        preferredChannel: payload.preferredChannel ?? preferredChannel,
        nextAction: payload.nextAction ?? null,
        brokerCallId: payload.brokerCallId ?? null,
    };
}

export async function triggerOutboundBrokerCall(
    requestId: string,
    targetProfileId: string,
    options?: {
        mode?: 'countdown_nudge' | 'manual';
        channel?: 'voice' | 'sms_whatsapp';
        provider?: 'retell' | 'twilio';
        dryRun?: boolean;
    },
) {
    const mode = options?.mode ?? 'countdown_nudge';
    const channel = options?.channel ?? 'voice';
    const provider = options?.provider ?? (channel === 'sms_whatsapp' ? 'twilio' : 'retell');

    const { data, error } = await supabase.functions.invoke('trigger-outbound-broker-call', {
        body: {
            requestId,
            targetProfileId,
            mode,
            channel,
            provider,
            dryRun: Boolean(options?.dryRun),
        },
    });

    if (error) {
        throw error;
    }

    const payload = data as TriggerOutboundBrokerCallResponse | null;
    if (!payload?.requestId || !payload?.status || !payload?.provider || !payload?.channel) {
        throw new Error('Outbound broker call response was incomplete.');
    }

    return {
        brokerCallId: payload.brokerCallId ?? null,
        requestId: payload.requestId,
        status: payload.status,
        provider: payload.provider,
        channel: payload.channel,
        scheduledFor: payload.scheduledFor ?? null,
        notice: payload.notice ?? null,
    };
}

export async function fetchBrokerCallSummary(requestId: string): Promise<BrokerCallSummary | null> {
    const user = await requireCurrentUser();

    const brokerRowsResult = await supabase
        .from('ai_broker_calls')
        .select(
            'request_id, sender_profile_id, receiver_profile_id, target_profile_id, status, consent_required, consent_granted, channel, provider, scheduled_for, ended_at, outcome, summary, created_at',
        )
        .eq('request_id', requestId)
        .order('created_at', { ascending: false })
        .returns<BrokerCallRow[]>();

    if (brokerRowsResult.error) {
        if (isMissingBrokerCallsTable(brokerRowsResult.error)) {
            return null;
        }

        throw brokerRowsResult.error;
    }

    return summarizeBrokerCallRows(requestId, user.id, brokerRowsResult.data ?? []);
}

function resolveConsentStatus(
    rows: BrokerCallRow[],
    targetProfileId: string,
): BrokerCallSummary['currentUserConsent'] {
    const consentRow = rows.find(
        (row) =>
            row.target_profile_id === targetProfileId &&
            row.consent_required === true &&
            typeof row.consent_granted === 'boolean',
    );

    if (!consentRow) {
        return 'unknown';
    }

    return consentRow.consent_granted ? 'granted' : 'declined';
}

function isAttemptStatus(status: BrokerCallStatus) {
    return (
        status === 'queued' ||
        status === 'dialing' ||
        status === 'in_progress' ||
        status === 'completed' ||
        status === 'no_answer' ||
        status === 'failed' ||
        status === 'cancelled'
    );
}

export function subscribeToMatchMessages(matchId: string, onMessage: (message: ChatMessage) => void) {
    const channel = supabase
        .channel(createRealtimeChannelName(`match-messages:${matchId}`))
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `match_id=eq.${matchId}`,
            },
            (payload) => {
                const row = payload.new as MessageRow;
                if (!row?.id) {
                    return;
                }

                onMessage(mapMessage(row));
            },
        )
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'messages',
                filter: `match_id=eq.${matchId}`,
            },
            (payload) => {
                const row = payload.new as MessageRow;
                if (!row?.id) {
                    return;
                }

                onMessage(mapMessage(row));
            },
        )
        .subscribe();

    return channel;
}

export function subscribeToInterestRequests(onChange: () => void) {
    return supabase
        .channel(createRealtimeChannelName('interest-requests'))
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'interest_requests',
            },
            () => {
                onChange();
            },
        )
        .subscribe();
}

export function subscribeToBrokerCalls(requestId: string, onChange: () => void) {
    return supabase
        .channel(createRealtimeChannelName(`broker-calls:${requestId}`))
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'ai_broker_calls',
                filter: `request_id=eq.${requestId}`,
            },
            () => {
                onChange();
            },
        )
        .subscribe();
}

export function subscribeToAllBrokerCalls(onChange: () => void) {
    return supabase
        .channel(createRealtimeChannelName('broker-calls:all'))
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'ai_broker_calls',
            },
            () => {
                onChange();
            },
        )
        .subscribe();
}

export function subscribeToAllFollowupJobs(onChange: () => void) {
    return supabase
        .channel(createRealtimeChannelName('followup-jobs:all'))
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'ai_followup_jobs',
            },
            () => {
                onChange();
            },
        )
        .subscribe();
}

export async function unsubscribeFromChannel(channel: RealtimeChannel) {
    await supabase.removeChannel(channel);
}

export async function setTypingIndicator(matchId: string): Promise<void> {
    const { error } = await supabase.rpc('set_typing_indicator', { p_match_id: matchId });
    if (error) throw error;
}

export async function clearTypingIndicator(matchId: string): Promise<void> {
    const { error } = await supabase.rpc('clear_typing_indicator', { p_match_id: matchId });
    if (error) throw error;
}

export async function updateUserPresence(status: 'online' | 'away' | 'offline'): Promise<void> {
    const { error } = await supabase.rpc('update_user_presence', { p_status: status });
    if (error) throw error;
}

export async function getMatchPresence(matchId: string): Promise<{ user_id: string; status: string; last_seen_at: string; is_online: boolean } | null> {
    const { data, error } = await supabase.rpc('get_match_presence', { p_match_id: matchId });
    if (error) throw error;
    if (Array.isArray(data) && data.length > 0) {
        const row = data[0];
        return {
            user_id: row.user_id,
            status: row.status,
            last_seen_at: row.last_seen_at,
            is_online: row.is_online,
        };
    }
    return null;
}

export function subscribeToTypingIndicators(matchId: string, onUpdate: (payload: { event: string; row: any }) => void) {
    return supabase
        .channel(createRealtimeChannelName(`match-typing:${matchId}`))
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'typing_indicators',
                filter: `match_id=eq.${matchId}`,
            },
            (payload) => {
                onUpdate({
                    event: payload.eventType,
                    row: payload.eventType === 'DELETE' ? payload.old : payload.new,
                });
            }
        )
        .subscribe();
}

export function subscribeToUserPresence(userId: string, onUpdate: (presence: { user_id: string; status: string; last_seen_at: string }) => void) {
    return supabase
        .channel(createRealtimeChannelName(`user-presence:${userId}`))
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'user_presence',
                filter: `user_id=eq.${userId}`,
            },
            (payload) => {
                onUpdate(payload.new as any);
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'user_presence',
                filter: `user_id=eq.${userId}`,
            },
            (payload) => {
                onUpdate(payload.new as any);
            }
        )
        .subscribe();
}

let realtimeChannelSequence = 0;

function createRealtimeChannelName(prefix: string) {
    realtimeChannelSequence += 1;
    return `${prefix}:${Date.now()}:${realtimeChannelSequence}`;
}

export async function blockUser(blockedId: string): Promise<void> {
    const user = await requireCurrentUser();
    const { error } = await supabase
        .from('user_blocks')
        .insert({ blocker_id: user.id, blocked_id: blockedId });
    if (error) throw error;
}

export async function unblockUser(blockedId: string): Promise<void> {
    const user = await requireCurrentUser();
    const { error } = await supabase
        .from('user_blocks')
        .delete()
        .eq('blocker_id', user.id)
        .eq('blocked_id', blockedId);
    if (error) throw error;
}

export async function reportUser(reportedId: string, reason: string, details: string): Promise<void> {
    const user = await requireCurrentUser();
    const { error } = await supabase
        .from('user_reports')
        .insert({ reporter_id: user.id, reported_id: reportedId, reason, details });
    if (error) throw error;
}

export async function fetchReports(): Promise<any[]> {
    const { data, error } = await supabase
        .from('user_reports')
        .select(`
            id,
            reason,
            details,
            status,
            created_at,
            reporter_id,
            reported_id
        `)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function updateReportStatus(reportId: string, status: 'reviewed' | 'dismissed'): Promise<void> {
    const { error } = await supabase
        .from('user_reports')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', reportId);
    if (error) throw error;
}