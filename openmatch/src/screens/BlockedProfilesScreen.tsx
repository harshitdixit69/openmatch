// src/screens/BlockedProfilesScreen.tsx
//
// Replaces the placeholder Alert that the Settings row used to show.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '../components/BackButton';
import { unblockUser } from '../lib/chatApi';
import { BlockedProfile, fetchBlockedProfiles } from '../lib/discoverySafetyApi';
import { getFriendlyErrorMessage } from '../lib/errorUtils';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';
import { useTheme, type ThemeColors } from '../lib/theme';

function formatBlockedDate(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function BlockedProfilesScreen({ onBack }: { onBack: () => void }) {
    const styles = useThemedStyles();
    const insets = useSafeAreaInsets();
    const [blocked, setBlocked] = useState<BlockedProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [pendingId, setPendingId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setErrorMessage(null);
        try {
            setBlocked(await fetchBlockedProfiles());
        } catch (error) {
            setErrorMessage(getFriendlyErrorMessage(error, 'Could not load your blocked profiles.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function executeUnblock(profile: BlockedProfile) {
        setPendingId(profile.id);
        // Optimistic: drop the row immediately, restore it if the write fails.
        setBlocked((prev) => prev.filter((entry) => entry.id !== profile.id));
        try {
            await unblockUser(profile.id);
        } catch (error) {
            setBlocked((prev) => [...prev, profile].sort((a, b) => b.blockedAt.localeCompare(a.blockedAt)));
            Alert.alert('Unblock failed', getFriendlyErrorMessage(error, 'Could not unblock this person.'));
        } finally {
            setPendingId(null);
        }
    }

    function confirmUnblock(profile: BlockedProfile) {
        const message = `${profile.fullName} will be able to see your profile and contact you again.`;

        if (Platform.OS === 'web') {
            if (window.confirm(`Unblock ${profile.fullName}?\n${message}`)) {
                void executeUnblock(profile);
            }
            return;
        }

        Alert.alert(`Unblock ${profile.fullName}?`, message, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Unblock', style: 'destructive', onPress: () => void executeUnblock(profile) },
        ]);
    }

    return (
        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <BackButton onPress={onBack} />
                <Text style={styles.headerTitle}>Blocked profiles</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView
                contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.inner}>
                    {loading ? (
                        <View style={styles.centered}>
                            <ActivityIndicator color="#121732" />
                            <Text style={styles.mutedText}>Loading blocked profiles…</Text>
                        </View>
                    ) : errorMessage ? (
                        <View style={styles.centered}>
                            <Text style={styles.emptyTitle}>Something went wrong</Text>
                            <Text style={styles.mutedText}>{errorMessage}</Text>
                            <Pressable style={styles.retryButton} onPress={() => void load()}>
                                <Text style={styles.retryButtonText}>Try again</Text>
                            </Pressable>
                        </View>
                    ) : blocked.length === 0 ? (
                        <View style={styles.centered}>
                            <Text style={styles.emptyTitle}>No blocked profiles</Text>
                            <Text style={styles.mutedText}>
                                People you block from a chat or profile will show up here, and you can unblock them at any time.
                            </Text>
                        </View>
                    ) : (
                        <View style={styles.card}>
                            {blocked.map((profile, index) => (
                                <React.Fragment key={profile.id}>
                                    {index > 0 ? <View style={styles.divider} /> : null}
                                    <View style={styles.row}>
                                        {profile.photoUrl ? (
                                            <Image source={{ uri: profile.photoUrl }} style={styles.avatar} />
                                        ) : (
                                            <View style={[styles.avatar, styles.avatarPlaceholder]}>
                                                <Text style={styles.avatarInitial}>
                                                    {profile.fullName.slice(0, 1).toUpperCase()}
                                                </Text>
                                            </View>
                                        )}

                                        <View style={styles.rowCopy}>
                                            <Text style={styles.rowName} numberOfLines={1}>
                                                {profile.fullName}
                                            </Text>
                                            <Text style={styles.rowMeta} numberOfLines={1}>
                                                {profile.location ? `${profile.location} · ` : ''}
                                                Blocked {formatBlockedDate(profile.blockedAt)}
                                            </Text>
                                        </View>

                                        <Pressable
                                            style={({ pressed }) => [
                                                styles.unblockButton,
                                                pressed ? styles.unblockButtonPressed : null,
                                            ]}
                                            onPress={() => confirmUnblock(profile)}
                                            disabled={pendingId === profile.id}
                                            accessibilityRole="button"
                                            accessibilityLabel={`Unblock ${profile.fullName}`}
                                        >
                                            <Text style={styles.unblockButtonText}>
                                                {pendingId === profile.id ? 'Working…' : 'Unblock'}
                                            </Text>
                                        </Pressable>
                                    </View>
                                </React.Fragment>
                            ))}
                        </View>
                    )}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
    root: { backgroundColor: c.background, flex: 1 },
    header: {
        alignItems: 'center',
        borderBottomColor: c.headerBorder,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: c.headerBackground,
    },
    headerTitle: { color: c.textPrimary, fontSize: 17, fontWeight: '700' },
    scroll: { paddingTop: 16 },
    inner: { alignSelf: 'center', maxWidth: MAX_CONTENT_WIDTH, paddingHorizontal: 16, width: '100%' },
    centered: { alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 48 },
    emptyTitle: { color: c.textPrimary, fontSize: 17, fontWeight: '700' },
    mutedText: { color: c.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    retryButton: {
        backgroundColor: c.accent,
        borderRadius: 12,
        marginTop: 6,
        paddingHorizontal: 18,
        paddingVertical: 10,
    },
    retryButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    card: { backgroundColor: c.cardBackground, borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder },
    divider: { backgroundColor: c.cardBorder, height: StyleSheet.hairlineWidth, marginLeft: 68 },
    row: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    avatar: { borderRadius: 20, height: 40, width: 40 },
    avatarPlaceholder: { alignItems: 'center', backgroundColor: c.cardBorder, justifyContent: 'center' },
    avatarInitial: { color: c.textPrimary, fontSize: 16, fontWeight: '800' },
    rowCopy: { flex: 1, gap: 2, minWidth: 0 },
    rowName: { color: c.textPrimary, fontSize: 15, fontWeight: '600' },
    rowMeta: { color: c.textMuted, fontSize: 12 },
    unblockButton: {
        backgroundColor: '#ffe9dc',
        borderRadius: 999,
        flexShrink: 0,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    unblockButtonPressed: { opacity: 0.75 },
    unblockButtonText: { color: '#9a3b18', fontSize: 13, fontWeight: '800' },
});

function useThemedStyles() {
    const { colors } = useTheme();
    return useMemo(() => makeStyles(colors), [colors]);
}
