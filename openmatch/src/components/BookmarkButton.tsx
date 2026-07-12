// src/components/BookmarkButton.tsx
// Renders a bookmark/heart toggle with optimistic state and error rollback.
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { toggleShortlist } from '../lib/shortlistApi';

interface Props {
    profileId: string;
    saved: boolean;
    /** Called after successful toggle with the new saved state */
    onToggled?: (saved: boolean) => void;
    size?: 'small' | 'medium';
}

export function BookmarkButton({ profileId, saved, onToggled, size = 'medium' }: Props) {
    const [optimistic, setOptimistic] = useState(saved);
    const [loading, setLoading] = useState(false);

    const handlePress = useCallback(async () => {
        const prev = optimistic;
        setOptimistic(!prev);  // optimistic update
        setLoading(true);
        try {
            const next = await toggleShortlist(profileId, prev);
            setOptimistic(next);
            onToggled?.(next);
        } catch {
            setOptimistic(prev);  // rollback on error
        } finally {
            setLoading(false);
        }
    }, [profileId, optimistic, onToggled]);

    const isSmall = size === 'small';

    return (
        <Pressable
            onPress={handlePress}
            disabled={loading}
            style={[styles.btn, isSmall && styles.btnSmall, optimistic && styles.btnSaved]}
            hitSlop={8}
        >
            {loading ? (
                <ActivityIndicator size="small" color={optimistic ? '#fff' : '#123340'} />
            ) : (
                <Text style={[styles.icon, isSmall && styles.iconSmall]}>
                    {optimistic ? '♥' : '♡'}
                </Text>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    btn: {
        width: 38,
        height: 38,
        borderRadius: 19,
        borderWidth: 1.5,
        borderColor: '#d0d0d0',
        backgroundColor: '#fafafa',
        alignItems: 'center',
        justifyContent: 'center',
    },
    btnSmall: { width: 30, height: 30, borderRadius: 15 },
    btnSaved: { backgroundColor: '#e8314a', borderColor: '#e8314a' },
    icon: { fontSize: 18, color: '#555', lineHeight: 22 },
    iconSmall: { fontSize: 14, lineHeight: 18 },
});
