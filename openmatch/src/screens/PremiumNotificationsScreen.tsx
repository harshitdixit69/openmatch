import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    RefreshControl,
    SafeAreaView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import {
    AppNotification,
    NotificationType,
    fetchNotifications,
    markAllNotificationsRead,
    markNotificationRead,
    subscribeToNotifications,
} from '../lib/notificationsApi';

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

const TYPE_ICON: Record<NotificationType, string> = {
    new_match: '💑',
    request_received: '📩',
    request_accepted: '✅',
    request_declined: '❌',
    request_ghosted: '👻',
    message_received: '💬',
    contact_unlocked: '🔓',
    profile_viewed: '👁',
    reliability_badge: '🏅',
    system: '🔔',
};

export default function PremiumNotificationsScreen({ onBack }: { onBack: () => void }) {
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const loadData = useCallback(async () => {
        try {
            const list = await fetchNotifications();
            setNotifications(list);
        } catch (e) {
            console.error('Failed to load notifications:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    useEffect(() => {
        let channel: any = null;
        async function initSub() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            channel = subscribeToNotifications(user.id, () => {
                void loadData();
            });
        }
        void initSub();
        return () => {
            if (channel) channel.unsubscribe();
        };
    }, [loadData]);

    const handleMarkAllRead = async () => {
        try {
            await markAllNotificationsRead();
            setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        } catch (e) {
            console.error('Failed to mark all as read:', e);
        }
    };

    const handleItemPress = async (item: AppNotification) => {
        if (!item.isRead) {
            try {
                await markNotificationRead(item.id);
                setNotifications((prev) =>
                    prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)),
                );
            } catch (e) {
                console.error('Failed to mark notification read:', e);
            }
        }
    };

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={onBack}>
                    <Text style={styles.backArrow}>‹</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>Notifications</Text>
                    <Text style={styles.headerSub}>
                        {unreadCount > 0 ? `${unreadCount} unread update${unreadCount > 1 ? 's' : ''}` : 'All caught up'}
                    </Text>
                </View>
                {unreadCount > 0 && (
                    <Pressable style={styles.markAllBtn} onPress={handleMarkAllRead}>
                        <Text style={styles.markAllText}>Mark all read</Text>
                    </Pressable>
                )}
            </View>

            {/* List */}
            {loading ? (
                <View style={styles.loadingWrap}>
                    <ActivityIndicator color="#d4b373" size="large" />
                </View>
            ) : notifications.length === 0 ? (
                <View style={styles.emptyWrap}>
                    <Text style={styles.emptyIcon}>🔔</Text>
                    <Text style={styles.emptyTitle}>No Notifications Yet</Text>
                    <Text style={styles.emptySub}>
                        When you receive match updates or responses, they will appear here.
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={notifications}
                    keyExtractor={(n) => n.id}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadData(); }} tintColor="#d4b373" />
                    }
                    contentContainerStyle={styles.listContent}
                    renderItem={({ item }) => (
                        <Pressable
                            style={[styles.row, !item.isRead && styles.rowUnread]}
                            onPress={() => handleItemPress(item)}
                        >
                            <View style={styles.iconWrap}>
                                <Text style={styles.iconEmoji}>{TYPE_ICON[item.type] ?? '🔔'}</Text>
                            </View>
                            <View style={styles.rowBody}>
                                <View style={styles.rowHeaderRow}>
                                    <Text style={[styles.rowTitle, !item.isRead && styles.rowTitleBold]} numberOfLines={1}>
                                        {item.title}
                                    </Text>
                                    <Text style={styles.rowTime}>{timeAgo(item.createdAt)}</Text>
                                </View>
                                <Text style={styles.rowDesc} numberOfLines={2}>{item.body}</Text>
                            </View>
                            {!item.isRead && <View style={styles.unreadDot} />}
                        </Pressable>
                    )}
                />
            )}
        </SafeAreaView>
    );
}

const GOLD = '#d4b373';
const DARK_BG = '#0d0c0f';
const CARD_BG = '#1a1828';
const BORDER = '#2a2640';
const TEXT_PRIMARY = '#f0ece8';
const TEXT_SUB = '#8e8aa0';
const TEXT_MUTED = '#6c6880';

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: DARK_BG,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
        gap: 12,
    },
    backBtn: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: CARD_BG,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: BORDER,
    },
    backArrow: {
        fontSize: 26,
        color: GOLD,
        lineHeight: 28,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: TEXT_PRIMARY,
    },
    headerSub: {
        fontSize: 12,
        color: TEXT_MUTED,
        marginTop: 1,
    },
    markAllBtn: {
        backgroundColor: 'rgba(212,179,115,0.12)',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: 'rgba(212,179,115,0.3)',
    },
    markAllText: {
        fontSize: 12,
        fontWeight: '700',
        color: GOLD,
    },
    loadingWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
        gap: 10,
    },
    emptyIcon: {
        fontSize: 44,
        marginBottom: 6,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: TEXT_PRIMARY,
    },
    emptySub: {
        fontSize: 13,
        color: TEXT_MUTED,
        textAlign: 'center',
        lineHeight: 18,
    },
    listContent: {
        padding: 16,
        gap: 10,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: CARD_BG,
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: BORDER,
        gap: 12,
    },
    rowUnread: {
        borderColor: GOLD,
        backgroundColor: '#201b33',
    },
    iconWrap: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(212,179,115,0.12)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(212,179,115,0.3)',
    },
    iconEmoji: {
        fontSize: 18,
    },
    rowBody: {
        flex: 1,
        gap: 2,
    },
    rowHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    rowTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: TEXT_PRIMARY,
        flex: 1,
    },
    rowTitleBold: {
        fontWeight: '700',
        color: GOLD,
    },
    rowTime: {
        fontSize: 11,
        color: TEXT_MUTED,
    },
    rowDesc: {
        fontSize: 12,
        color: TEXT_SUB,
        lineHeight: 16,
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: GOLD,
    },
});
