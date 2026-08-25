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
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
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
                    <ActivityIndicator color="#d4a853" size="large" />
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
                    style={{ flex: 1, backgroundColor: '#0a0a0c' }}
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
    arrow: { fontSize: 22, color: '#d4a853' },
});
