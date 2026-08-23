import type { MatchUnlockState } from './chat';

/**
 * Presentation state for the locked-contact card on the profile screen.
 * Kept in a pure module so it stays in lockstep with the ChatScreen header
 * without either screen importing the other.
 */
export type ContactUnlockStatus = {
    pillLabel: string | null;
    body: string;
    actionLabel: string;
    actionDisabled: boolean;
    actionOpensChat: boolean;
    showPremium: boolean;
};

export function resolveContactUnlockStatus(
    firstName: string,
    unlockState?: MatchUnlockState | null
): ContactUnlockStatus {
    const defaultBody = `${firstName}'s number stays hidden until you both accept contact exchange and each complete the same one-time unlock payment.`;

    const defaultStatus: ContactUnlockStatus = {
        pillLabel: null,
        body: defaultBody,
        actionLabel: 'Unlock contact',
        actionDisabled: false,
        actionOpensChat: false,
        showPremium: true,
    };

    if (!unlockState || unlockState.status === 'none') {
        return defaultStatus;
    }

    if (unlockState.canAccept) {
        return {
            pillLabel: '🔑 Share request received',
            body: `${firstName} asked to exchange contact details. Accept in chat to move this forward.`,
            actionLabel: 'Accept share in chat',
            actionDisabled: false,
            actionOpensChat: true,
            showPremium: false,
        };
    }

    if (unlockState.canPay || unlockState.waitingOn === 'your_payment') {
        return {
            pillLabel: '💳 Payment pending',
            body: `You and ${firstName} both accepted. Complete your one-time unlock payment in chat to reveal contact details.`,
            actionLabel: 'Complete unlock in chat',
            actionDisabled: false,
            actionOpensChat: true,
            showPremium: false,
        };
    }

    if (unlockState.waitingOn === 'other_acceptance') {
        return {
            pillLabel: '⏳ Pending',
            body: `You've requested contact exchange. Waiting for ${firstName} to accept.`,
            actionLabel: 'Waiting for response',
            actionDisabled: true,
            actionOpensChat: false,
            showPremium: false,
        };
    }

    if (unlockState.waitingOn === 'other_payment') {
        return {
            pillLabel: '⏳ They pay',
            body: `Your unlock payment is done. Waiting for ${firstName} to complete theirs.`,
            actionLabel: 'Waiting for their payment',
            actionDisabled: true,
            actionOpensChat: false,
            showPremium: false,
        };
    }

    if (unlockState.status === 'declined') {
        return {
            pillLabel: '🚫 Declined',
            body: `This contact exchange request was declined.${unlockState.canRequest ? ' You can send a fresh request from chat.' : ''}`,
            actionLabel: unlockState.canRequest ? 'Request again in chat' : 'Unavailable',
            actionDisabled: !unlockState.canRequest,
            actionOpensChat: true,
            showPremium: false,
        };
    }

    return defaultStatus;
}
