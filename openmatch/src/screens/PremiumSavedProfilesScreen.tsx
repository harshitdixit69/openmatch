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
import { fetchShortlist, ShortlistedProfile } from '../lib/shortlistApi';

export default function PremiumSavedProfilesScreen({
    onBack,
    onSelectCandidate,
}: {
    onBack: () => void;
    onSelectCandidate?: (candidate: any) => void;
}) {
    const [items, setItems] = useState<ShortlistedProfile[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        async function load() {
            try {
                const list = await fetchShortlist();
                if (mounted) setItems(list);
            } catch (e) {
                console.error('Failed to load saved profiles:', e);
            } finally {
                if (mounted) setLoading(false);
            }
        }
        void load();
        return () => { mounted = false; };
    }, []);

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={onBack}>
                    <Text style={styles.backArrow}>‹</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>Saved Profiles</Text>
                    <Text style={styles.headerSub}>Your bookmarked candidates</Text>
                </View>
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator color="#d4b373" size="large" />
                </View>
            ) : items.length === 0 ? (
                <View style={styles.center}>
                    <Text style={styles.emoji}>📌</Text>
                    <Text style={styles.emptyTitle}>No Saved Profiles</Text>
                    <Text style={styles.emptySub}>Profiles you bookmark will appear here for quick access.</Text>
                </View>
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={(item) => item.shortlist_id}
                    contentContainerStyle={styles.list}
                    renderItem={({ item }) => (
                        <Pressable style={styles.card} onPress={() => onSelectCandidate?.(item)}>
                            {item.photo_urls?.[0] ? (
                                <Image source={{ uri: item.photo_urls[0] }} style={styles.avatar} />
                            ) : (
                                <View style={styles.avatarPlaceholder}>
                                    <Text style={styles.initial}>{item.full_name?.charAt(0) ?? '?'}</Text>
                                </View>
                            )}
                            <View style={styles.info}>
                                <Text style={styles.name}>{item.full_name}</Text>
                                <Text style={styles.loc}>📍 {item.location}</Text>
                            </View>
                            <Text style={styles.arrow}>›</Text>
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
    avatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 1.5, borderColor: GOLD },
    avatarPlaceholder: { width: 50, height: 50, borderRadius: 25, backgroundColor: BORDER, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: GOLD },
    initial: { fontSize: 18, fontWeight: '700', color: GOLD },
    info: { flex: 1, gap: 2 },
    name: { fontSize: 15, fontWeight: '700', color: TEXT_PRIMARY },
    loc: { fontSize: 12, color: TEXT_SUB },
    arrow: { fontSize: 22, color: GOLD },
});
