import {
    filterSendableReasons,
    isSendableMessage,
    MAX_MESSAGE_LENGTH,
    MIN_MESSAGE_LENGTH,
} from './sendableMessage';

describe('sendableMessage', () => {
    describe('isSendableMessage', () => {
        it('accepts a normal opening message', () => {
            expect(
                isSendableMessage(
                    "Hi Aisha, I noticed we're both in Pune and you mentioned wanting to travel more. I'd like to know more about you.",
                ),
            ).toBe(true);
        });

        it('rejects the exact coaching text that shipped to users', () => {
            // The real regression: this was pre-filled as the outgoing message.
            expect(
                isSendableMessage(
                    'Your bio is currently too brief; adding details about your hobbies or career goals helps potential matches start a meaningful conversation.',
                ),
            ).toBe(false);
        });

        it('rejects photo and engagement coaching', () => {
            expect(
                isSendableMessage(
                    'Adding a few more photos showcasing your personality can significantly increase engagement and trust with other users.',
                ),
            ).toBe(false);
            expect(
                isSendableMessage(
                    'Including specific preferences in your profile helps ensure you connect with people who share your lifestyle and values.',
                ),
            ).toBe(false);
        });

        it('rejects third-person commentary about the match', () => {
            expect(
                isSendableMessage(
                    'Both profiles include clear long-term preferences, so there is enough specificity here for a respectful first request.',
                ),
            ).toBe(false);
        });

        it('is case insensitive', () => {
            expect(isSendableMessage('YOUR BIO could really use more detail about you')).toBe(false);
        });

        it('rejects text that is too short to be a message', () => {
            expect(isSendableMessage('Hi')).toBe(false);
            expect(isSendableMessage('a'.repeat(MIN_MESSAGE_LENGTH - 1))).toBe(false);
        });

        it('rejects a paragraph-length block', () => {
            expect(isSendableMessage('a'.repeat(MAX_MESSAGE_LENGTH + 1))).toBe(false);
        });

        it('handles null, undefined and whitespace', () => {
            expect(isSendableMessage(null)).toBe(false);
            expect(isSendableMessage(undefined)).toBe(false);
            expect(isSendableMessage('          ')).toBe(false);
        });
    });

    describe('filterSendableReasons', () => {
        it('keeps only the safe suggestions', () => {
            const reasons = [
                { id: 'a', text: 'Your bio is currently too brief; adding details about your hobbies helps.' },
                { id: 'b', text: "Hi Rhea, you mentioned you cook a lot — I'd love to hear what you make." },
            ];

            expect(filterSendableReasons(reasons)).toEqual([reasons[1]]);
        });

        it('returns an empty list when everything is coaching, rather than sending it', () => {
            const reasons = [
                { id: 'a', text: 'Your profile needs more photos to increase engagement with other users.' },
                { id: 'b', text: 'Adding details about your career goals helps potential matches reach out.' },
            ];

            expect(filterSendableReasons(reasons)).toEqual([]);
        });

        it('preserves extra fields on the suggestion', () => {
            const reasons = [
                { id: 'a', text: "Hi Sana, I saw you're also in Bengaluru. Would you be open to talking?", score: 84 },
            ];

            expect(filterSendableReasons(reasons)[0].score).toBe(84);
        });
    });
});
