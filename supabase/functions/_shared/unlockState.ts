export type MatchRow = {
    id: string;
    user_1_id: string;
    user_2_id: string;
    status: string;
    is_unlocked: boolean;
};

export type MatchUnlockStatus = 'none' | 'awaiting_response' | 'awaiting_payment' | 'declined' | 'completed';

export type MatchUnlockRow = {
    match_id: string;
    requested_by: string;
    status: Exclude<MatchUnlockStatus, 'none'>;
    user_1_accepted_at: string | null;
    user_2_accepted_at: string | null;
    user_1_paid_at: string | null;
    user_2_paid_at: string | null;
    declined_by: string | null;
    declined_at: string | null;
    created_at: string;
    updated_at: string;
};

export type ViewerUnlockState = {
    matchId: string;
    isUnlocked: boolean;
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

type ParticipantColumns = {
    currentAcceptedAt: 'user_1_accepted_at' | 'user_2_accepted_at';
    otherAcceptedAt: 'user_1_accepted_at' | 'user_2_accepted_at';
    currentPaidAt: 'user_1_paid_at' | 'user_2_paid_at';
    otherPaidAt: 'user_1_paid_at' | 'user_2_paid_at';
    otherUserId: string;
};

export function getParticipantColumns(match: MatchRow, viewerUserId: string): ParticipantColumns {
    if (match.user_1_id === viewerUserId) {
        return {
            currentAcceptedAt: 'user_1_accepted_at',
            otherAcceptedAt: 'user_2_accepted_at',
            currentPaidAt: 'user_1_paid_at',
            otherPaidAt: 'user_2_paid_at',
            otherUserId: match.user_2_id,
        };
    }

    if (match.user_2_id === viewerUserId) {
        return {
            currentAcceptedAt: 'user_2_accepted_at',
            otherAcceptedAt: 'user_1_accepted_at',
            currentPaidAt: 'user_2_paid_at',
            otherPaidAt: 'user_1_paid_at',
            otherUserId: match.user_1_id,
        };
    }

    throw new Error('You are not a participant in this match.');
}

export function buildViewerUnlockState(
    match: MatchRow,
    unlock: MatchUnlockRow | null,
    viewerUserId: string,
): ViewerUnlockState {
    const participantColumns = getParticipantColumns(match, viewerUserId);

    if (match.is_unlocked) {
        return {
            matchId: match.id,
            isUnlocked: true,
            status: 'completed',
            requestedByUserId: unlock?.requested_by ?? null,
            declinedByUserId: unlock?.declined_by ?? null,
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

    if (!unlock) {
        return {
            matchId: match.id,
            isUnlocked: false,
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

    const hasCurrentUserAccepted = Boolean(unlock[participantColumns.currentAcceptedAt]);
    const hasOtherUserAccepted = Boolean(unlock[participantColumns.otherAcceptedAt]);
    const hasCurrentUserPaid = Boolean(unlock[participantColumns.currentPaidAt]);
    const hasOtherUserPaid = Boolean(unlock[participantColumns.otherPaidAt]);

    let waitingOn: ViewerUnlockState['waitingOn'] = 'none';
    if (unlock.status === 'awaiting_response') {
        waitingOn = hasCurrentUserAccepted ? 'other_acceptance' : 'none';
    } else if (unlock.status === 'awaiting_payment') {
        if (!hasCurrentUserPaid) {
            waitingOn = 'your_payment';
        } else if (!hasOtherUserPaid) {
            waitingOn = 'other_payment';
        }
    }

    return {
        matchId: match.id,
        isUnlocked: false,
        status: unlock.status,
        requestedByUserId: unlock.requested_by,
        declinedByUserId: unlock.declined_by,
        hasCurrentUserAccepted,
        hasOtherUserAccepted,
        hasCurrentUserPaid,
        hasOtherUserPaid,
        canRequest: unlock.status === 'declined' || unlock.status === 'none',
        canAccept: unlock.status === 'awaiting_response' && !hasCurrentUserAccepted,
        canPay: unlock.status === 'awaiting_payment' && !hasCurrentUserPaid,
        waitingOn,
    };
}