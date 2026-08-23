import type { MatchUnlockState } from './chat';

/**
 * Width below which the chat header must economise on horizontal space.
 * iPhone 12/13/14 (390pt) and smaller land here.
 */
export const COMPACT_HEADER_MAX_WIDTH = 420;

export function isCompactChatHeader(windowWidth: number): boolean {
    return windowWidth > 0 && windowWidth < COMPACT_HEADER_MAX_WIDTH;
}

/**
 * Label for the contact-share button in the chat header.
 *
 * On narrow screens the full labels ("🔑 Share Contact") crowd out the match's
 * name. We economise by dropping the decorative glyph and any redundant second
 * word — never the word itself, since a bare emoji leaves the user guessing
 * what the button actually does.
 */
export function getShareContactLabel(
    unlockState: MatchUnlockState,
    hasUnlockCredits: boolean,
    compact: boolean
): string {
    if (unlockState.canAccept) return compact ? 'Accept' : '🔑 Accept Share';
    if (unlockState.canPay) {
        if (hasUnlockCredits) return compact ? 'Use Credit' : '🔑 Use Credit';
        return compact ? 'Pay ₹45' : '🔑 Pay ₹45';
    }
    if (unlockState.waitingOn === 'other_acceptance') return compact ? 'Pending' : '⏳ Pending';
    if (unlockState.waitingOn === 'other_payment') return compact ? 'They Pay' : '⏳ They Pay';
    return compact ? 'Share' : '🔑 Share Contact';
}

/** Spoken/screen-reader description, always the full phrasing. */
export function getShareContactAccessibilityLabel(
    unlockState: MatchUnlockState,
    hasUnlockCredits: boolean
): string {
    return getShareContactLabel(unlockState, hasUnlockCredits, false).replace(/^[^\w₹]+\s*/, '');
}
