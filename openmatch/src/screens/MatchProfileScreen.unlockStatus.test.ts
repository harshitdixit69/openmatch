import { resolveContactUnlockStatus } from './MatchProfileScreen';
import type { MatchUnlockState } from '../lib/chat';

function makeState(overrides: Partial<MatchUnlockState>): MatchUnlockState {
    return {
        status: 'awaiting_response',
        requestedByUserId: null,
        declinedByUserId: null,
        hasCurrentUserAccepted: false,
        hasOtherUserAccepted: false,
        hasCurrentUserPaid: false,
        hasOtherUserPaid: false,
        canRequest: false,
        canAccept: false,
        canPay: false,
        waitingOn: 'none',
        ...overrides,
    };
}

describe('resolveContactUnlockStatus', () => {
    it('shows the default unlock CTA when there is no unlock record', () => {
        const status = resolveContactUnlockStatus('Aisha', null);
        expect(status.pillLabel).toBeNull();
        expect(status.actionLabel).toBe('Unlock contact');
        expect(status.actionDisabled).toBe(false);
        expect(status.showPremium).toBe(true);
    });

    it('shows the default unlock CTA for status "none"', () => {
        const status = resolveContactUnlockStatus('Aisha', makeState({ status: 'none', canRequest: true }));
        expect(status.actionLabel).toBe('Unlock contact');
        expect(status.showPremium).toBe(true);
    });

    it('shows Pending when waiting on the other user to accept', () => {
        const status = resolveContactUnlockStatus(
            'Aisha',
            makeState({ status: 'awaiting_response', hasCurrentUserAccepted: true, waitingOn: 'other_acceptance' })
        );
        expect(status.pillLabel).toBe('⏳ Pending');
        expect(status.body).toContain('Waiting for Aisha to accept');
        expect(status.actionDisabled).toBe(true);
        expect(status.showPremium).toBe(false);
    });

    it('shows the accept CTA when the current user can accept', () => {
        const status = resolveContactUnlockStatus('Aisha', makeState({ canAccept: true }));
        expect(status.pillLabel).toBe('🔑 Share request received');
        expect(status.actionLabel).toBe('Accept share in chat');
        expect(status.actionOpensChat).toBe(true);
        expect(status.showPremium).toBe(false);
    });

    it('shows the payment CTA when the current user can pay', () => {
        const status = resolveContactUnlockStatus(
            'Aisha',
            makeState({ status: 'awaiting_payment', canPay: true, waitingOn: 'your_payment' })
        );
        expect(status.pillLabel).toBe('💳 Payment pending');
        expect(status.actionOpensChat).toBe(true);
        expect(status.actionDisabled).toBe(false);
    });

    it('shows a disabled waiting state when the other user still owes payment', () => {
        const status = resolveContactUnlockStatus(
            'Aisha',
            makeState({ status: 'awaiting_payment', hasCurrentUserPaid: true, waitingOn: 'other_payment' })
        );
        expect(status.pillLabel).toBe('⏳ They pay');
        expect(status.actionDisabled).toBe(true);
    });

    it('allows re-requesting after a decline', () => {
        const status = resolveContactUnlockStatus('Aisha', makeState({ status: 'declined', canRequest: true }));
        expect(status.pillLabel).toBe('🚫 Declined');
        expect(status.actionLabel).toBe('Request again in chat');
        expect(status.actionDisabled).toBe(false);
    });

    it('never offers the premium shortcut once a request is in flight', () => {
        const inFlight: MatchUnlockState[] = [
            makeState({ waitingOn: 'other_acceptance', hasCurrentUserAccepted: true }),
            makeState({ canAccept: true }),
            makeState({ status: 'awaiting_payment', canPay: true, waitingOn: 'your_payment' }),
            makeState({ status: 'awaiting_payment', waitingOn: 'other_payment' }),
            makeState({ status: 'declined', canRequest: true }),
        ];
        inFlight.forEach((state) => {
            expect(resolveContactUnlockStatus('Aisha', state).showPremium).toBe(false);
        });
    });
});
