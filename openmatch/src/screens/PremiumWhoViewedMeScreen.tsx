import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
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
        <SafeAreaView style={styles.container}>
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
                    <ActivityIndicator color="#d4b373" size="large" />
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

const GOLD = '#d4b373';
const DARK_BG = '#0d0c0f';
const CARD_BG = '#1a1828';
const BORDER = '#2a2640';
const TEXT_PRIMARY = '#f0ece8';
const TEXT_SUB = '#8e8aa0';
const TEXT_MUTED = '#6c6880';

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: DARK_BG },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 12 },
    backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_BG, borderRadius: 18, borderWidth: 1, borderColor: BORDER },
    backArrow: { fontSize: 26, color: GOLD, lineHeight: 28 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY },
    headerSub: { fontSize: 12, color: TEXT_MUTED, marginTop: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
    emoji: { fontSize: 44, marginBottom: 4 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY },
    emptySub: { fontSize: 13, color: TEXT_MUTED, textAlign: 'center' },
    list: { padding: 16, gap: 10 },
    card: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD_BG, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: BORDER, gap: 12 },
    avatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, borderColor: GOLD },
    avatarPlaceholder: { width: 46, height: 46, borderRadius: 23, backgroundColor: BORDER, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: GOLD },
    initial: { fontSize: 16, fontWeight: '700', color: GOLD },
    info: { flex: 1, gap: 2 },
    name: { fontSize: 15, fontWeight: '700', color: TEXT_PRIMARY },
    loc: { fontSize: 12, color: TEXT_SUB },
    time: { fontSize: 11, color: TEXT_MUTED },
});
