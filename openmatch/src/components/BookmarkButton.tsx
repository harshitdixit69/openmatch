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
                <ActivityIndicator size="small" color={optimistic ? '#0a0a0c' : '#d4a853'} />
            ) : (
                <Text style={[styles.icon, isSmall && styles.iconSmall, optimistic && styles.iconSaved]}>
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
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
        backgroundColor: 'rgba(255,255,255,0.06)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    btnSmall: { width: 30, height: 30, borderRadius: 15 },
    btnSaved: { backgroundColor: '#d4a853', borderColor: '#d4a853' },
    icon: { fontSize: 18, color: '#8e8a9e', lineHeight: 22 },
    iconSmall: { fontSize: 14, lineHeight: 18 },
    iconSaved: { color: '#0a0a0c' },
});
