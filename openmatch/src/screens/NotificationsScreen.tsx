// src/screens/NotificationsScreen.tsx
// F8 – In-app Notifications
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RealtimeChannel } from '@supabase/supabase-js';
import { BackButton } from '../components/BackButton';
import {
    type AppNotification,
    type NotificationType,
    fetchNotifications,
    markAllNotificationsRead,
    markNotificationRead,
    subscribeToNotifications,
} from '../lib/notificationsApi';
import { getFriendlyErrorMessage } from '../lib/errorUtils';
import { supabase } from '../lib/supabase';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

type IconDef = { emoji: string; bg: string };

const TYPE_ICON: Record<NotificationType, IconDef> = {
    new_match: { emoji: '💑', bg: 'rgba(212,168,83,0.15)' },
    request_received: { emoji: '📩', bg: 'rgba(212,168,83,0.15)' },
    request_accepted: { emoji: '✅', bg: 'rgba(52,199,89,0.15)' },
    request_declined: { emoji: '❌', bg: 'rgba(239,68,68,0.15)' },
    request_ghosted: { emoji: '👻', bg: 'rgba(168,85,247,0.15)' },
    message_received: { emoji: '💬', bg: 'rgba(212,168,83,0.15)' },
    contact_unlocked: { emoji: '🔓', bg: 'rgba(212,168,83,0.2)' },
    profile_viewed: { emoji: '👁', bg: 'rgba(212,168,83,0.15)' },
    reliability_badge: { emoji: '🏅', bg: 'rgba(212,168,83,0.2)' },
    system: { emoji: '🔔', bg: 'rgba(255,255,255,0.06)' },
};

// ---------------------------------------------------------------------------
// Notification row
// ---------------------------------------------------------------------------

function NotifRow({
    item,
    onPress,
}: {
    item: AppNotification;
    onPress: (item: AppNotification) => void;
}) {
    const icon = TYPE_ICON[item.type] ?? TYPE_ICON.system;

    return (
        <Pressable
            style={({ pressed }) => [
                styles.row,
                !item.isRead && styles.rowUnread,
                pressed && styles.rowPressed,
            ]}
            onPress={() => onPress(item)}
        >
            <View style={[styles.iconWrap, { backgroundColor: icon.bg }]}>
                <Text style={styles.iconEmoji}>{icon.emoji}</Text>
            </View>
            <View style={styles.rowBody}>
                <View style={styles.rowHeaderRow}>
                    <Text style={[styles.rowTitle, !item.isRead && styles.rowTitleBold]} numberOfLines={1}>
                        {item.title}
                    </Text>
                    <Text style={styles.rowTime}>{timeAgo(item.createdAt)}</Text>
                </View>
                <Text style={styles.rowBody2} numberOfLines={2}>{item.body}</Text>
            </View>
            {!item.isRead && <View style={styles.unreadDot} />}
        </Pressable>
    );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

interface Props {
    onBack: () => void;
    onNotificationPress?: (n: AppNotification) => void;
}

export function NotificationsScreen({ onBack, onNotificationPress }: Props) {
    const insets = useSafeAreaInsets();
    const [items, setItems] = useState<AppNotification[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const channelRef = useRef<RealtimeChannel | null>(null);

    const load = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);
        try {
            const data = await fetchNotifications();
            setItems(data);
        } catch (e: any) {
            setError(getFriendlyErrorMessage(e, 'Unable to load notifications right now. Please pull down to refresh.'));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    // Subscribe to new notifications via Realtime
    useEffect(() => {
        let mounted = true;
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (!user || !mounted) return;
            channelRef.current = subscribeToNotifications(user.id, (n) => {
                setItems((prev) => [n, ...prev]);
            });
        });
        return () => {
            mounted = false;
            if (channelRef.current) {
                channelRef.current.unsubscribe();
                channelRef.current = null;
            }
        };
    }, []);

    useEffect(() => { load(); }, [load]);

    const handlePress = useCallback(async (item: AppNotification) => {
        if (!item.isRead) {
            // Optimistic
            setItems((prev) => prev.map((n) => n.id === item.id ? { ...n, isRead: true } : n));
            markNotificationRead(item.id).catch(() => { });
        }
        onNotificationPress?.(item);
    }, [onNotificationPress]);

    const handleMarkAll = useCallback(async () => {
        setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
        markAllNotificationsRead().catch(() => { });
    }, []);

    const unreadCount = items.filter((n) => !n.isRead).length;

    return (
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
                <BackButton onPress={onBack} />
                <View style={styles.headerCenter}>
                    <Text style={styles.headerTitle}>Notifications</Text>
                    {unreadCount > 0 && (
                        <Text style={styles.headerUnread}>{unreadCount} unread</Text>
                    )}
                </View>
                {unreadCount > 0 ? (
                    <Pressable style={styles.markAllBtn} onPress={handleMarkAll}>
                        <Text style={styles.markAllText}>Mark all read</Text>
                    </Pressable>
                ) : (
                    <View style={{ width: 80 }} />
                )}
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator color="#d4a853" size="large" />
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
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => load(true)}
                            tintColor="#d4a853"
                        />
                    }
                    showsVerticalScrollIndicator={false}
                >
                    {items.length === 0 ? (
                        <View style={styles.empty}>
                            <Text style={styles.emptyIcon}>🔔</Text>
                            <Text style={styles.emptyTitle}>All caught up</Text>
                            <Text style={styles.emptySubtitle}>
                                New matches, accepted requests and messages will appear here.
                            </Text>
                        </View>
                    ) : (
                        items.map((n) => (
                            <NotifRow key={n.id} item={n} onPress={handlePress} />
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
    safe: { flex: 1, backgroundColor: '#0a0a0c' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 12,
        backgroundColor: '#111015',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '800', color: '#d4a853' },
    headerUnread: { fontSize: 12, color: '#8e8a9e', marginTop: 2 },
    markAllBtn: { paddingHorizontal: 10, paddingVertical: 6 },
    markAllText: { fontSize: 12, color: '#d4a853', fontWeight: '700' },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    errorText: { fontSize: 14, color: '#f87171', textAlign: 'center', paddingHorizontal: 24 },
    retryBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#d4a853', borderRadius: 8 },
    retryBtnText: { color: '#0a0a0c', fontWeight: '800' },

    list: { flex: 1 },
    listContent: {
        paddingTop: 8,
        maxWidth: MAX_CONTENT_WIDTH,
        alignSelf: 'center',
        width: '100%',
    },

    empty: { alignItems: 'center', paddingTop: 64, gap: 8 },
    emptyIcon: { fontSize: 40 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: '#d4a853' },
    emptySubtitle: { fontSize: 14, color: '#8e8a9e', textAlign: 'center', paddingHorizontal: 32 },

    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.06)',
        backgroundColor: '#0a0a0c',
    },
    rowUnread: { backgroundColor: '#141318' },
    rowPressed: { opacity: 0.82 },

    iconWrap: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    iconEmoji: { fontSize: 20 },

    rowBody: { flex: 1, gap: 3 },
    rowHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    rowTitle: { fontSize: 14, color: '#8e8a9e', flex: 1 },
    rowTitleBold: { fontWeight: '800', color: '#f0ece4' },
    rowTime: { fontSize: 11, color: '#8e8a9e', flexShrink: 0 },
    rowBody2: { fontSize: 13, color: '#8e8a9e', lineHeight: 18 },

    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#d4a853',
        marginTop: 6,
        flexShrink: 0,
    },
});
