import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { MatchCandidate } from '../lib/matchmaking';
import { fetchMatchFeed } from '../lib/matchmakingApi';

export default function PremiumSearchScreen({
    onBack,
    onSelectCandidate,
}: {
    onBack: () => void;
    onSelectCandidate?: (candidate: MatchCandidate) => void;
}) {
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [allCandidates, setAllCandidates] = useState<MatchCandidate[]>([]);

    useEffect(() => {
        let mounted = true;
        async function load() {
            try {
                const res = await fetchMatchFeed(30);
                if (mounted) setAllCandidates(res.candidates);
            } catch (e) {
                console.error('Search error:', e);
            } finally {
                if (mounted) setLoading(false);
            }
        }
        void load();
        return () => { mounted = false; };
    }, []);

    const filtered = query.trim()
        ? allCandidates.filter((c) =>
            c.full_name?.toLowerCase().includes(query.toLowerCase()) ||
            c.location?.toLowerCase().includes(query.toLowerCase()) ||
            c.bio?.toLowerCase().includes(query.toLowerCase()),
          )
        : allCandidates;

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={onBack}>
                    <Text style={styles.backArrow}>‹</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>Search Profiles</Text>
                    <Text style={styles.headerSub}>Find candidates by name, location, or bio</Text>
                </View>
            </View>

            {/* Search Input Bar */}
            <View style={styles.searchBar}>
                <TextInput
                    style={styles.searchInput}
                    placeholder="Search by name, city, or interests..."
                    placeholderTextColor="#5a5570"
                    value={query}
                    onChangeText={setQuery}
                />
            </View>

            {/* Results */}
            {loading ? (
                <View style={styles.loadingWrap}>
                    <ActivityIndicator color="#d4b373" size="large" />
                    <Text style={styles.loadingText}>Loading candidates...</Text>
                </View>
            ) : filtered.length === 0 ? (
                <View style={styles.emptyWrap}>
                    <Text style={styles.emptyIcon}>🔍</Text>
                    <Text style={styles.emptyTitle}>No matching profiles</Text>
                    <Text style={styles.emptySub}>
                        Try adjusting your search terms or clearing filters.
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={filtered}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContent}
                    renderItem={({ item }) => (
                        <Pressable style={styles.card} onPress={() => onSelectCandidate?.(item)}>
                            {item.photo_urls?.[0] ? (
                                <Image source={{ uri: item.photo_urls[0] }} style={styles.avatar} />
                            ) : (
                                <View style={styles.avatarPlaceholder}>
                                    <Text style={styles.avatarInitial}>{item.full_name?.charAt(0) ?? '?'}</Text>
                                </View>
                            )}
                            <View style={styles.cardInfo}>
                                <Text style={styles.name}>{item.full_name}</Text>
                                <Text style={styles.sub}>📍 {item.location}</Text>
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
    searchBar: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    searchInput: {
        backgroundColor: CARD_BG,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 14,
        paddingVertical: 10,
        fontSize: 14,
        color: TEXT_PRIMARY,
    },
    loadingWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
    },
    loadingText: {
        fontSize: 14,
        color: TEXT_MUTED,
    },
    emptyWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
        gap: 10,
    },
    emptyIcon: { fontSize: 44 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY },
    emptySub: { fontSize: 13, color: TEXT_MUTED, textAlign: 'center' },
    listContent: { padding: 16, gap: 10 },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: CARD_BG,
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: BORDER,
        gap: 12,
    },
    avatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 1.5, borderColor: GOLD },
    avatarPlaceholder: { width: 50, height: 50, borderRadius: 25, backgroundColor: BORDER, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: GOLD },
    avatarInitial: { fontSize: 18, fontWeight: '700', color: GOLD },
    cardInfo: { flex: 1, gap: 2 },
    name: { fontSize: 15, fontWeight: '700', color: TEXT_PRIMARY },
    sub: { fontSize: 12, color: TEXT_SUB },
    arrow: { fontSize: 22, color: GOLD },
});
