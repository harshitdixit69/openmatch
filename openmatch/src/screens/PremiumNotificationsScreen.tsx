import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
                console.error('Failed to mark notification as read:', e);
            }
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={onBack}>
                    <Text style={styles.backArrow}>‹</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>Notifications</Text>
                    <Text style={styles.headerSub}>Match requests, updates & activity</Text>
                </View>
                {notifications.some((n) => !n.isRead) && (
                    <Pressable style={styles.markAllBtn} onPress={handleMarkAllRead}>
                        <Text style={styles.markAllText}>Mark all read</Text>
                    </Pressable>
                )}
            </View>

            {loading ? (
                <View style={styles.loadingWrap}>
                    <ActivityIndicator color="#d4a853" size="large" />
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
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => { setRefreshing(true); void loadData(); }}
                            tintColor="#d4a853"
                        />
                    }
                    contentContainerStyle={styles.listContent}
                    style={{ flex: 1, backgroundColor: '#0a0a0c' }}
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

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0a0a0c',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: '#111015',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.08)',
        gap: 12,
    },
    backBtn: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#141318',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    backArrow: {
        fontSize: 26,
        color: '#d4a853',
        lineHeight: 28,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#d4a853',
    },
    headerSub: {
        fontSize: 12,
        color: '#8e8a9e',
        marginTop: 1,
    },
    markAllBtn: {
        backgroundColor: 'rgba(212,168,83,0.15)',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: 'rgba(212,168,83,0.3)',
    },
    markAllText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#d4a853',
    },
    loadingWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a0a0c',
    },
    emptyWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
        gap: 10,
        backgroundColor: '#0a0a0c',
    },
    emptyIcon: {
        fontSize: 44,
        marginBottom: 6,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#f0ece4',
    },
    emptySub: {
        fontSize: 13,
        color: '#8e8a9e',
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
        backgroundColor: '#141318',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        gap: 12,
    },
    rowUnread: {
        borderColor: 'rgba(212,168,83,0.4)',
        backgroundColor: '#1a1824',
    },
    iconWrap: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(212,168,83,0.12)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(212,168,83,0.3)',
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
        color: '#f0ece4',
        flex: 1,
    },
    rowTitleBold: {
        fontWeight: '700',
        color: '#d4a853',
    },
    rowTime: {
        fontSize: 11,
        color: '#5a5770',
    },
    rowDesc: {
        fontSize: 12,
        color: '#8e8a9e',
        lineHeight: 16,
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#d4a853',
    },
});
