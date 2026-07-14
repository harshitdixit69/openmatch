import { RequestMediaType } from './intentEscrow';
import { ProfileOwner } from './profile';

export type MatchUnlockStatus = 'none' | 'awaiting_response' | 'awaiting_payment' | 'declined' | 'completed';
export type MatchRequestState = 'none' | 'received' | 'sent';
export type MatchInterestRequestStatus = 'sent' | 'accepted' | 'declined' | 'expired' | 'ghosted' | 'closed';

export type MatchInterestRequest = {
    id: string;
    matchId: string;
    senderId: string;
    receiverId: string;
    status: MatchInterestRequestStatus;
    personalizedReason: string;
    mediaType: RequestMediaType;
    mediaUrl: string | null;
    requestQualityScore: number;
    senderGhostRiskScore: number;
    acceptedAt: string | null;
    firstReplyDueAt: string | null;
    firstReplyAt: string | null;
    ghostedAt: string | null;
    createdAt: string;
    updatedAt: string;
};

export type MatchUnlockState = {
    status: MatchUnlockStatus;
    requestedByUserId: string | null;
    declinedByUserId: string | null;
    hasCurrentUserAccepted: boolean;
    hasOtherUserAccepted: boolean;
    hasCurrentUserPaid: boolean;
    hasOtherUserPaid: boolean;
    canRequest: boolean;
    canAccept: boolean;
    canPay: boolean;
    waitingOn: 'none' | 'other_acceptance' | 'your_payment' | 'other_payment';
};

export type MatchUnlockAction = 'request' | 'accept' | 'decline';

export type ChatMatch = {
    id: string;
    otherUserId: string;
    otherUserName: string;
    otherUserPhotoUrls: string[];
    otherUserPhoneNumber: string | null;
    otherUserWhatsappNumber: string | null;
    otherUserLocation: string;
    otherUserBio: string | null;
    otherUserPreferences: string | null;
    otherUserProfileOwner: ProfileOwner | null;
    status: string;
    matchRequestState: MatchRequestState;
    interestRequest: MatchInterestRequest | null;
    brokerSummary: BrokerCallSummary | null;
    followupJobSummary: FollowupJobSummary | null;
    isUnlocked: boolean;
    unreadCount: number;
    unlockState: MatchUnlockState;
    createdAt: string;
    otherUserVerificationStatus: 'unverified' | 'pending' | 'verified' | 'rejected';
};

export type ChatMessage = {
    id: string;
    matchId: string;
    senderId: string;
    content: string;
    isFlaggedBySystem: boolean;
    readAt: string | null;
    createdAt: string;
};

export type SendEscrowMessageResult = {
    message: ChatMessage;
    blocked: boolean;
    notice: string | null;
    unlocked: boolean;
};

export type UnlockPaymentIntent = {
    alreadyUnlocked: boolean;
    clientSecret: string | null;
    paymentIntentId: string | null;
    amount: number;
    currency: string;
    merchantDisplayName: string;
    reused: boolean;
};

export type UnlockPaymentSheetResult = {
    status: 'completed' | 'canceled' | 'unsupported';
    message: string | null;
};

export type UpdateMatchUnlockResult = {
    message: string | null;
    state: MatchUnlockState | null;
};

export type TriggerIntentCallbackMode = 'availability_check' | 'schedule_prompt';

export type TriggerIntentCallbackResult = {
    jobId: string;
    provider: string;
    status: string;
};

export type BrokerCallStatus =
    | 'queued'
    | 'consent_required'
    | 'consent_granted'
    | 'dialing'
    | 'in_progress'
    | 'completed'
    | 'declined'
    | 'no_answer'
    | 'failed'
    | 'cancelled';

export type BrokerConsentStatus = 'granted' | 'declined' | 'unknown';

export type BrokerCallSummary = {
    requestId: string;
    currentUserConsent: BrokerConsentStatus;
    otherUserConsent: BrokerConsentStatus;
    latestStatus: BrokerCallStatus | null;
    latestChannel: 'voice' | 'sms_whatsapp' | null;
    latestProvider: 'retell' | 'vapi' | 'twilio' | null;
    latestScheduledFor: string | null;
    latestEndedAt: string | null;
    latestOutcome: string | null;
    latestSummary: Record<string, unknown> | null;
    attemptCount: number;
};

export type FollowupJobSummary = {
    requestId: string;
    latestJob: {
        channel: string;
        status: string;
        provider: string;
        createdAt: string;
        executedAt: string | null;
        payload: Record<string, unknown> | null;
    } | null;
    jobCount: number;
};

export type ChatPromptSuggestions = {
    prompts: string[];
};

export type ChatChemistry = {
    /** Overall rapport score for the conversation, 0-100. */
    score: number;
    /** Short qualitative read of the vibe, e.g. "Warming up". */
    label: string;
    /** Human-readable engagement signals, e.g. "Balanced back-and-forth". */
    signals: string[];
};

export type ChatCopilotResult = {
    /** 3 context-aware next messages the current user could send. */
    replySuggestions: string[];
    /** Engagement / chemistry read for the conversation so far. */
    chemistry: ChatChemistry;
};