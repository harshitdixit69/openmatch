// src/screens/ShortlistScreen.tsx
// F5 – Saved / Bookmarked Profiles
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
import { BookmarkButton } from '../components/BookmarkButton';
import type { MatchCandidate } from '../lib/matchmaking';
import {
    fetchShortlist,
    shortlistToCandidate,
    type ShortlistedProfile,
} from '../lib/shortlistApi';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';

function calcAge(dob: string): number {
    const birth = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    if (
        today.getMonth() < birth.getMonth() ||
        (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
    ) age--;
    return age;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function ShortlistCard({
    item,
    onPress,
    onUnsaved,
}: {
    item: ShortlistedProfile;
    onPress: (c: MatchCandidate) => void;
    onUnsaved: (profileId: string) => void;
}) {
    const age = calcAge(item.dob);
    const photo = item.photo_urls?.[0];

    return (
        <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => onPress(shortlistToCandidate(item))}
        >
            <View style={styles.cardPhoto}>
                {photo ? (
                    <Image source={{ uri: photo }} style={styles.cardImg} />
                ) : (
                    <View style={styles.cardImgPlaceholder}>
                        <Text style={styles.cardImgInitial}>
                            {item.full_name.charAt(0).toUpperCase()}
                        </Text>
                    </View>
                )}
            </View>
            <View style={styles.cardBody}>
                <Text style={styles.cardName} numberOfLines={1}>{item.full_name}</Text>
                <Text style={styles.cardMeta}>{age} · {item.location}</Text>
                {item.bio ? (
                    <Text style={styles.cardBio} numberOfLines={2}>{item.bio}</Text>
                ) : null}
            </View>
            <BookmarkButton
                profileId={item.saved_profile_id}
                saved
                size="small"
                onToggled={(saved) => { if (!saved) onUnsaved(item.saved_profile_id); }}
            />
        </Pressable>
    );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

interface Props {
    onBack: () => void;
    onSelectCandidate: (c: MatchCandidate) => void;
}

export function ShortlistScreen({ onBack, onSelectCandidate }: Props) {
    const insets = useSafeAreaInsets();
    const [items, setItems] = useState<ShortlistedProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);
        try {
            const data = await fetchShortlist();
            setItems(data);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load saved profiles.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const handleUnsaved = useCallback((profileId: string) => {
        setItems((prev) => prev.filter((i) => i.saved_profile_id !== profileId));
    }, []);

    return (
        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <BackButton onPress={onBack} />
                <Text style={styles.headerTitle}>
                    Saved{items.length > 0 ? ` (${items.length})` : ''}
                </Text>
                <View style={{ width: 36 }} />
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#123340" />
                </View>
            ) : error ? (
                <View style={styles.center}>
                    <Text style={styles.stateEmoji}>⚠️</Text>
                    <Text style={styles.stateTitle}>Could not load</Text>
                    <Text style={styles.stateBody}>{error}</Text>
                    <Pressable style={styles.stateBtn} onPress={() => load()}>
                        <Text style={styles.stateBtnText}>Retry</Text>
                    </Pressable>
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={[
                        styles.list,
                        { paddingBottom: insets.bottom + 24 },
                    ]}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => load(true)}
                            tintColor="#123340"
                        />
                    }
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.inner}>
                        {items.length === 0 ? (
                            <View style={styles.center}>
                                <Text style={styles.stateEmoji}>♡</Text>
                                <Text style={styles.stateTitle}>No saved profiles yet</Text>
                                <Text style={styles.stateBody}>
                                    Tap the bookmark on any profile to save them here for later.
                                </Text>
                            </View>
                        ) : (
                            items.map((item) => (
                                <ShortlistCard
                                    key={item.shortlist_id}
                                    item={item}
                                    onPress={onSelectCandidate}
                                    onUnsaved={handleUnsaved}
                                />
                            ))
                        )}
                    </View>
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#f4f4f6' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#e5e5e5',
    },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#111' },
    list: { paddingTop: 12 },
    inner: { maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center', paddingHorizontal: 16 },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
        gap: 10,
        paddingHorizontal: 32,
    },
    stateEmoji: { fontSize: 44 },
    stateTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
    stateBody: { fontSize: 14, color: '#777', textAlign: 'center' },
    stateBtn: {
        marginTop: 6,
        backgroundColor: '#123340',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 10,
    },
    stateBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 14,
        padding: 12,
        marginBottom: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 2,
    },
    cardPressed: { opacity: 0.85 },
    cardPhoto: { marginRight: 12 },
    cardImg: { width: 56, height: 56, borderRadius: 28 },
    cardImgPlaceholder: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#123340',
        alignItems: 'center',
        justifyContent: 'center',
    },
    cardImgInitial: { color: '#fff', fontSize: 22, fontWeight: '700' },
    cardBody: { flex: 1 },
    cardName: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 2 },
    cardMeta: { fontSize: 13, color: '#777', marginBottom: 3 },
    cardBio: { fontSize: 13, color: '#555', lineHeight: 18 },
});
