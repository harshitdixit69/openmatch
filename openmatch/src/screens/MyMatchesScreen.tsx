// src/screens/MyMatchesScreen.tsx
// F6 – My Matches: all accepted/connected matches in one view
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../components/BackButton';
import type { ChatMatch } from '../lib/chat';
import { fetchChatMatches } from '../lib/chatApi';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FilterTab = 'all' | 'connected' | 'unlocked' | 'pending';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'connected', label: 'Connected' },
    { key: 'unlocked', label: 'Contacts Shared' },
    { key: 'pending', label: 'Pending' },
];

function applyFilter(matches: ChatMatch[], tab: FilterTab): ChatMatch[] {
    switch (tab) {
        case 'connected':
            return matches.filter((m) => m.status === 'connected' && !m.isUnlocked);
        case 'unlocked':
            return matches.filter((m) => m.isUnlocked);
        case 'pending':
            return matches.filter((m) => m.status === 'pending');
        default:
            return matches;
    }
}

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function statusLabel(m: ChatMatch): { text: string; color: string } {
    if (m.isUnlocked) return { text: 'Contacts shared', color: '#1a7a5e' };
    if (m.status === 'connected') return { text: 'Connected', color: '#123340' };
    if (m.status === 'pending') return { text: 'Pending', color: '#b07d2e' };
    return { text: m.status, color: '#666' };
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function MatchCard({
    match,
    onPress,
}: {
    match: ChatMatch;
    onPress: (m: ChatMatch) => void;
}) {
    const photo = match.otherUserPhotoUrls?.[0];
    const { text: statusText, color: statusColor } = statusLabel(match);

    return (
        <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => onPress(match)}
        >
            <View style={styles.cardPhoto}>
                {photo ? (
                    <Image source={{ uri: photo }} style={styles.cardImg} />
                ) : (
                    <View style={styles.cardImgPlaceholder}>
                        <Text style={styles.cardImgInitial}>
                            {match.otherUserName.charAt(0).toUpperCase()}
                        </Text>
                    </View>
                )}
                {match.isUnlocked && (
                    <View style={styles.unlockedBadge}>
                        <Text style={styles.unlockedBadgeText}>✓</Text>
                    </View>
                )}
            </View>

            <View style={styles.cardBody}>
                <View style={styles.cardHeaderRow}>
                    <Text style={styles.cardName} numberOfLines={1}>{match.otherUserName}</Text>
                    <Text style={styles.cardTime}>{timeAgo(match.createdAt)}</Text>
                </View>
                <Text style={styles.cardLocation} numberOfLines={1}>{match.otherUserLocation}</Text>
                {match.otherUserBio ? (
                    <Text style={styles.cardBio} numberOfLines={2}>{match.otherUserBio}</Text>
                ) : null}
            </View>

            <View style={styles.cardRight}>
                <View style={[styles.statusPill, { borderColor: statusColor }]}>
                    <Text style={[styles.statusPillText, { color: statusColor }]}>{statusText}</Text>
                </View>
                {match.unreadCount > 0 && (
                    <View style={styles.unreadBadge}>
                        <Text style={styles.unreadBadgeText}>
                            {match.unreadCount > 9 ? '9+' : match.unreadCount}
                        </Text>
                    </View>
                )}
            </View>
        </Pressable>
    );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

interface Props {
    onBack: () => void;
    onOpenChat: (match: ChatMatch) => void;
}

export function MyMatchesScreen({ onBack, onOpenChat }: Props) {
    const insets = useSafeAreaInsets();
    const [allMatches, setAllMatches] = useState<ChatMatch[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

    const load = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);
        try {
            const data = await fetchChatMatches();
            // Only show accepted/connected/unlocked — exclude fully rejected
            const relevant = data.filter((m) => m.status !== 'rejected');
            setAllMatches(relevant);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load matches');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const visible = applyFilter(allMatches, activeFilter);

    // Tab counts
    const counts: Record<FilterTab, number> = {
        all: allMatches.length,
        connected: allMatches.filter((m) => m.status === 'connected' && !m.isUnlocked).length,
        unlocked: allMatches.filter((m) => m.isUnlocked).length,
        pending: allMatches.filter((m) => m.status === 'pending').length,
    };

    return (
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
                <BackButton onPress={onBack} />
                <Text style={styles.headerTitle}>My Matches</Text>
                <View style={{ width: 40 }} />
            </View>

            {/* Filter tabs */}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterRow}
                contentContainerStyle={styles.filterContent}
            >
                {FILTER_TABS.map((t) => (
                    <Pressable
                        key={t.key}
                        style={[styles.filterChip, activeFilter === t.key && styles.filterChipActive]}
                        onPress={() => setActiveFilter(t.key)}
                    >
                        <Text style={[styles.filterChipText, activeFilter === t.key && styles.filterChipTextActive]}>
                            {t.label}
                            {counts[t.key] > 0 ? ` (${counts[t.key]})` : ''}
                        </Text>
                    </Pressable>
                ))}
            </ScrollView>

            {/* Body */}
            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator color="#123340" size="large" />
                </View>
            ) : error ? (
                <View style={styles.center}>
                    <Text style={styles.errorText}>{error}</Text>
                    <Pressable style={styles.retryBtn} onPress={() => load()}>
                        <Text style={styles.retryBtnText}>Retry</Text>
                    </Pressable>
                </View>
            ) : (
                <ScrollView
                    style={styles.list}
                    contentContainerStyle={[
                        styles.listContent,
                        { paddingBottom: insets.bottom + 16 },
                    ]}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#123340" />
                    }
                    showsVerticalScrollIndicator={false}
                >
                    {visible.length === 0 ? (
                        <View style={styles.empty}>
                            <Text style={styles.emptyIcon}>💑</Text>
                            <Text style={styles.emptyTitle}>
                                {activeFilter === 'all' ? 'No matches yet' : `No ${activeFilter} matches`}
                            </Text>
                            <Text style={styles.emptySubtitle}>
                                {activeFilter === 'all'
                                    ? 'Send a Connect request to start a match.'
                                    : 'Change the filter above to see all your matches.'}
                            </Text>
                        </View>
                    ) : (
                        visible.map((m) => (
                            <MatchCard key={m.id} match={m} onPress={onOpenChat} />
                        ))
                    )}
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#f5f4f0' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 12,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e8e5df',
    },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#123340' },

    filterRow: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e8e5df' },
    filterContent: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
    filterChip: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 20,
        backgroundColor: '#f0ede6',
    },
    filterChipActive: { backgroundColor: '#123340' },
    filterChipText: { fontSize: 13, color: '#555', fontWeight: '500' },
    filterChipTextActive: { color: '#fff', fontWeight: '700' },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    errorText: { fontSize: 14, color: '#c0392b', textAlign: 'center', paddingHorizontal: 24 },
    retryBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#123340', borderRadius: 8 },
    retryBtnText: { color: '#fff', fontWeight: '600' },

    list: { flex: 1 },
    listContent: {
        paddingTop: 12,
        paddingHorizontal: 16,
        gap: 10,
        maxWidth: MAX_CONTENT_WIDTH,
        alignSelf: 'center',
        width: '100%',
    },

    empty: { alignItems: 'center', paddingTop: 64, gap: 8 },
    emptyIcon: { fontSize: 40 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: '#123340' },
    emptySubtitle: { fontSize: 14, color: '#666', textAlign: 'center', paddingHorizontal: 32 },

    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 12,
        gap: 12,
        borderWidth: 1,
        borderColor: '#e8e5df',
    },
    cardPressed: { opacity: 0.85 },
    cardPhoto: { position: 'relative' },
    cardImg: { width: 56, height: 56, borderRadius: 28 },
    cardImgPlaceholder: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#d4cfc6',
        alignItems: 'center',
        justifyContent: 'center',
    },
    cardImgInitial: { fontSize: 22, fontWeight: '700', color: '#123340' },
    unlockedBadge: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#1a7a5e',
        alignItems: 'center',
        justifyContent: 'center',
    },
    unlockedBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

    cardBody: { flex: 1, gap: 2 },
    cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardName: { fontSize: 15, fontWeight: '700', color: '#123340', flex: 1 },
    cardTime: { fontSize: 11, color: '#999', marginLeft: 8 },
    cardLocation: { fontSize: 12, color: '#666' },
    cardBio: { fontSize: 12, color: '#888', marginTop: 2 },

    cardRight: { alignItems: 'flex-end', gap: 6 },
    statusPill: {
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    statusPillText: { fontSize: 11, fontWeight: '600' },
    unreadBadge: {
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: '#e53935',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
    },
    unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
