import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchProfileViewers, ProfileViewer } from '../lib/profileViewsApi';

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

export default function PremiumWhoViewedMeScreen({ onBack }: { onBack: () => void }) {
    const [entries, setEntries] = useState<ProfileViewer[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        async function load() {
            try {
                const list = await fetchProfileViewers();
                if (isMounted) setEntries(list);
            } catch (e) {
                console.error('Failed to fetch who viewed me:', e);
            } finally {
                if (isMounted) setLoading(false);
            }
        }
        void load();
        return () => { isMounted = false; };
    }, []);

    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={onBack}>
                    <Text style={styles.backArrow}>‹</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>Who Viewed Me</Text>
                    <Text style={styles.headerSub}>Recent profile visitors</Text>
                </View>
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator color="#d4a853" size="large" />
                </View>
            ) : entries.length === 0 ? (
                <View style={styles.center}>
                    <Text style={styles.emoji}>👁</Text>
                    <Text style={styles.emptyTitle}>No Visitors Yet</Text>
                    <Text style={styles.emptySub}>Profiles that view your account will appear here.</Text>
                </View>
            ) : (
                <FlatList
                    data={entries}
                    keyExtractor={(item) => item.viewedAt + item.viewerId}
                    contentContainerStyle={styles.list}
                    style={{ flex: 1, backgroundColor: '#0a0a0c' }}
                    renderItem={({ item }) => (
                        <View style={styles.card}>
                            {item.photoUrls?.[0] ? (
                                <Image source={{ uri: item.photoUrls[0] }} style={styles.avatar} />
                            ) : (
                                <View style={styles.avatarPlaceholder}>
                                    <Text style={styles.initial}>{item.fullName?.charAt(0) ?? '?'}</Text>
                                </View>
                            )}
                            <View style={styles.info}>
                                <Text style={styles.name}>{item.fullName}</Text>
                                <Text style={styles.loc}>📍 {item.location}</Text>
                            </View>
                            <Text style={styles.time}>{timeAgo(item.viewedAt)}</Text>
                        </View>
                    )}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0a0a0c' },
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
    backArrow: { fontSize: 26, color: '#d4a853', lineHeight: 28 },
    headerTitle: { fontSize: 18, fontWeight: '800', color: '#d4a853' },
    headerSub: { fontSize: 12, color: '#8e8a9e', marginTop: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8, backgroundColor: '#0a0a0c' },
    emoji: { fontSize: 44, marginBottom: 4 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: '#f0ece4' },
    emptySub: { fontSize: 13, color: '#8e8a9e', textAlign: 'center' },
    list: { padding: 16, gap: 10 },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#141318',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        gap: 12,
    },
    avatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 1.5, borderColor: '#d4a853' },
    avatarPlaceholder: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#1e1d26',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: '#d4a853',
    },
    initial: { fontSize: 18, fontWeight: '700', color: '#d4a853' },
    info: { flex: 1, gap: 2 },
    name: { fontSize: 15, fontWeight: '700', color: '#f0ece4' },
    loc: { fontSize: 12, color: '#8e8a9e' },
    time: { fontSize: 12, color: '#5a5770', fontWeight: '500' },
});
