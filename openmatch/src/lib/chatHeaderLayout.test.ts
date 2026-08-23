import {
    getShareContactAccessibilityLabel,
    getShareContactLabel,
    isCompactChatHeader,
} from './chatHeaderLayout';
import type { MatchUnlockState } from './chat';

function makeState(overrides: Partial<MatchUnlockState>): MatchUnlockState {
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
        ...overrides,
    };
}

describe('isCompactChatHeader', () => {
    it('treats an iPhone 12 Pro as compact', () => {
        expect(isCompactChatHeader(390)).toBe(true);
    });

    it('treats a small phone as compact', () => {
        expect(isCompactChatHeader(320)).toBe(true);
    });

    it('does not treat a tablet or desktop as compact', () => {
        expect(isCompactChatHeader(768)).toBe(false);
        expect(isCompactChatHeader(1280)).toBe(false);
    });

    it('does not treat an unmeasured width as compact', () => {
        expect(isCompactChatHeader(0)).toBe(false);
    });
});

describe('getShareContactLabel', () => {
    it('uses the full label on wide screens', () => {
        expect(getShareContactLabel(makeState({}), false, false)).toBe('🔑 Share Contact');
        expect(getShareContactLabel(makeState({ canAccept: true }), false, false)).toBe('🔑 Accept Share');
        expect(getShareContactLabel(makeState({ waitingOn: 'other_acceptance' }), false, false)).toBe('⏳ Pending');
        expect(getShareContactLabel(makeState({ waitingOn: 'other_payment' }), false, false)).toBe('⏳ They Pay');
    });

    it('drops the glyph but keeps the word on compact screens', () => {
        expect(getShareContactLabel(makeState({}), false, true)).toBe('Share');
        expect(getShareContactLabel(makeState({ canAccept: true }), false, true)).toBe('Accept');
        expect(getShareContactLabel(makeState({ waitingOn: 'other_acceptance' }), false, true)).toBe('Pending');
        expect(getShareContactLabel(makeState({ waitingOn: 'other_payment' }), false, true)).toBe('They Pay');
    });

    it('never renders a wordless label, since a bare glyph is ambiguous', () => {
        const states = [
            makeState({}),
            makeState({ canAccept: true }),
            makeState({ canPay: true }),
            makeState({ waitingOn: 'other_acceptance' }),
            makeState({ waitingOn: 'other_payment' }),
        ];
        states.forEach((state) => {
            [true, false].forEach((compact) => {
                expect(getShareContactLabel(state, false, compact)).toMatch(/[A-Za-z]/);
            });
        });
    });

    it('keeps the price visible when compact, since it is the decision-critical bit', () => {
        expect(getShareContactLabel(makeState({ canPay: true }), false, true)).toBe('Pay ₹45');
    });

    it('distinguishes paying from spending a credit', () => {
        expect(getShareContactLabel(makeState({ canPay: true }), true, false)).toBe('🔑 Use Credit');
        expect(getShareContactLabel(makeState({ canPay: true }), false, false)).toBe('🔑 Pay ₹45');
    });

    it('prefers accepting over paying when both are somehow possible', () => {
        expect(getShareContactLabel(makeState({ canAccept: true, canPay: true }), false, false)).toBe('🔑 Accept Share');
    });
});

describe('getShareContactAccessibilityLabel', () => {
    it('strips the leading glyph so screen readers announce words', () => {
        expect(getShareContactAccessibilityLabel(makeState({}), false)).toBe('Share Contact');
        expect(getShareContactAccessibilityLabel(makeState({ waitingOn: 'other_acceptance' }), false)).toBe('Pending');
    });

    it('stays verbose even though the visible label may be shortened', () => {
        expect(getShareContactAccessibilityLabel(makeState({ canAccept: true }), false)).toBe('Accept Share');
    });

    it('keeps the price in the spoken label', () => {
        expect(getShareContactAccessibilityLabel(makeState({ canPay: true }), false)).toBe('Pay ₹45');
    });
});
