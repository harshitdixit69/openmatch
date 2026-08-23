import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import {
    ExpandableMessageText,
    LONG_MESSAGE_CHAR_LIMIT,
    buildPreview,
    isLongMessage,
} from './ExpandableMessageText';

const SHORT_MESSAGE = 'Hey, nice to connect with you!';
const LONG_MESSAGE = 'hi'.repeat(LONG_MESSAGE_CHAR_LIMIT); // well over the limit

describe('ExpandableMessageText', () => {
    describe('isLongMessage', () => {
        it('returns false for short content', () => {
            expect(isLongMessage(SHORT_MESSAGE)).toBe(false);
        });

        it('returns false for empty content', () => {
            expect(isLongMessage('')).toBe(false);
        });

        it('returns true for content over the character limit', () => {
            expect(isLongMessage(LONG_MESSAGE)).toBe(true);
        });

        it('returns true for content with many line breaks', () => {
            expect(isLongMessage('a\n'.repeat(20))).toBe(true);
        });
    });

    describe('buildPreview', () => {
        it('truncates to the character limit and appends an ellipsis', () => {
            const preview = buildPreview(LONG_MESSAGE);
            expect(preview.endsWith('…')).toBe(true);
            expect(preview.length).toBeLessThanOrEqual(LONG_MESSAGE_CHAR_LIMIT + 1);
        });

        it('avoids splitting a word when a sensible boundary exists', () => {
            const wordy = `${'word '.repeat(100)}`;
            const preview = buildPreview(wordy);
            expect(preview.endsWith('…')).toBe(true);
            // Should not end mid-word (i.e. no partial "wor…")
            expect(preview.replace('…', '').trimEnd().endsWith('word')).toBe(true);
        });
    });

    it('renders short messages in full without a toggle', () => {
        const { getByText, queryByText } = render(
            <ExpandableMessageText content={SHORT_MESSAGE} />,
        );

        expect(getByText(SHORT_MESSAGE)).toBeTruthy();
        expect(queryByText('Read more')).toBeNull();
    });

    it('collapses long messages and shows a Read more toggle', () => {
        const { getByText, queryByText } = render(
            <ExpandableMessageText content={LONG_MESSAGE} />,
        );

        expect(getByText('Read more')).toBeTruthy();
        // Full content is not rendered while collapsed.
        expect(queryByText(LONG_MESSAGE)).toBeNull();
    });

    it('expands to full content and back when the toggle is pressed', () => {
        const { getByText, queryByText } = render(
            <ExpandableMessageText content={LONG_MESSAGE} />,
        );

        fireEvent.press(getByText('Read more'));

        expect(getByText(LONG_MESSAGE)).toBeTruthy();
        expect(getByText('Show less')).toBeTruthy();
        expect(queryByText('Read more')).toBeNull();

        fireEvent.press(getByText('Show less'));

        expect(getByText('Read more')).toBeTruthy();
        expect(queryByText(LONG_MESSAGE)).toBeNull();
    });

    it('does not truncate when disabled (e.g. redacted messages)', () => {
        const { getByText, queryByText } = render(
            <ExpandableMessageText content={LONG_MESSAGE} disabled />,
        );

        expect(getByText(LONG_MESSAGE)).toBeTruthy();
        expect(queryByText('Read more')).toBeNull();
    });

    it('exposes accessible expand/collapse state', () => {
        const { getByLabelText } = render(
            <ExpandableMessageText content={LONG_MESSAGE} />,
        );

        const toggle = getByLabelText('Read the full message');
        expect(toggle).toBeTruthy();

        fireEvent.press(toggle);

        expect(getByLabelText('Show less of this message')).toBeTruthy();
    });
});
