import React, { useState } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, TextStyle } from 'react-native';

// Messages longer than this are collapsed behind a "Read more" toggle.
export const LONG_MESSAGE_CHAR_LIMIT = 300;

// How many lines to show while collapsed. Acts as a secondary guard for text
// that is under the character limit but still very tall (e.g. many newlines).
const COLLAPSED_LINE_LIMIT = 10;

export function isLongMessage(content: string) {
    if (!content) return false;
    return (
        content.length > LONG_MESSAGE_CHAR_LIMIT ||
        content.split('\n').length > COLLAPSED_LINE_LIMIT
    );
}

/**
 * Truncates the message at the character limit without slicing a word in half,
 * so the preview ends cleanly before the "Read more" affordance.
 */
export function buildPreview(content: string) {
    const hardSlice = content.slice(0, LONG_MESSAGE_CHAR_LIMIT);
    const lastSpace = hardSlice.lastIndexOf(' ');
    // Only respect the word boundary if it isn't unreasonably far back (which
    // happens with long unbroken strings like "hiiiiiii...").
    const sliced =
        lastSpace > LONG_MESSAGE_CHAR_LIMIT * 0.6 ? hardSlice.slice(0, lastSpace) : hardSlice;
    return `${sliced.trimEnd()}…`;
}

type ExpandableMessageTextProps = {
    content: string;
    textStyle?: StyleProp<TextStyle>;
    /** Colour for the "Read more" / "Show less" affordance. */
    linkColor?: string;
    /** Disables truncation (e.g. for redacted/flagged placeholder copy). */
    disabled?: boolean;
};

/**
 * Renders a chat message, collapsing very long content behind a "Read more"
 * toggle so a single message can't take over the whole conversation view.
 */
export function ExpandableMessageText({
    content,
    textStyle,
    linkColor = '#0b6b74',
    disabled = false,
}: ExpandableMessageTextProps) {
    const [expanded, setExpanded] = useState(false);

    const shouldCollapse = !disabled && isLongMessage(content);

    if (!shouldCollapse) {
        return <Text style={textStyle}>{content}</Text>;
    }

    return (
        <>
            <Text
                style={textStyle}
                numberOfLines={expanded ? undefined : COLLAPSED_LINE_LIMIT}
            >
                {expanded ? content : buildPreview(content)}
            </Text>
            <Pressable
                onPress={() => setExpanded((prev) => !prev)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={expanded ? 'Show less of this message' : 'Read the full message'}
            >
                {({ pressed }) => (
                    <Text
                        style={[
                            styles.toggle,
                            { color: linkColor },
                            pressed ? styles.togglePressed : null,
                        ]}
                    >
                        {expanded ? 'Show less' : 'Read more'}
                    </Text>
                )}
            </Pressable>
        </>
    );
}

const styles = StyleSheet.create({
    toggle: {
        fontSize: 13,
        fontWeight: '700',
        marginTop: 6,
    },
    togglePressed: {
        opacity: 0.6,
    },
});
