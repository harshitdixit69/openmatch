// src/lib/sendableMessage.ts
//
// Defence in depth for the connect composer.
//
// The suggestions returned by `generate-request-reasons` are pre-filled into the
// message that gets sent verbatim to the other person. A prompt regression once
// caused the model to return profile-improvement coaching aimed at the sender
// ("Your bio is currently too brief..."), which would have been delivered to the
// receiver as an opening message.
//
// The edge function now filters these server-side, but this client-side check
// means a stale deployment, a cached response, or a future prompt change cannot
// put coaching text in front of a user.

/**
 * Phrases that indicate the text is advice about a profile rather than a
 * message to a person.
 */
const COACHING_PHRASES = [
    'your bio',
    'your profile',
    'your photos',
    'add more',
    'adding more',
    'adding details',
    'consider adding',
    'you should add',
    'more photos',
    'profile completeness',
    'helps potential matches',
    'increase engagement',
    'both profiles',
];

export const MIN_MESSAGE_LENGTH = 15;
export const MAX_MESSAGE_LENGTH = 320;

export function isSendableMessage(text: string | null | undefined): boolean {
    const trimmed = text?.trim() ?? '';

    if (trimmed.length < MIN_MESSAGE_LENGTH) return false;
    // Longer than this is a paragraph of advice, not an opening line.
    if (trimmed.length > MAX_MESSAGE_LENGTH) return false;

    const lowered = trimmed.toLowerCase();
    return !COACHING_PHRASES.some((phrase) => lowered.includes(phrase));
}

/**
 * Drops any suggestion that is not safe to send.
 *
 * If every suggestion fails the check the list comes back empty, which the
 * composer treats as "no suggestions" — the user writes their own message.
 * That is a far better outcome than sending them something nonsensical.
 */
export function filterSendableReasons<T extends { text: string }>(reasons: T[]): T[] {
    return reasons.filter((reason) => isSendableMessage(reason.text));
}
