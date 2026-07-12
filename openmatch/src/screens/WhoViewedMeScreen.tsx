// src/screens/WhoViewedMeScreen.tsx
// F7 – Who Viewed My Profile
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
import type { ProfileViewer } from '../lib/profileViewsApi';
import { fetchProfileViewers } from '../lib/profileViewsApi';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function ViewerCard({
    viewer,
    onPress,
}: {
    viewer: ProfileViewer;
    onPress: (v: ProfileViewer) => void;
}) {
    const age = calcAge(viewer.dob);
    const photo = viewer.photoUrls?.[0];

    return (
        <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => onPress(viewer)}
        >
            <View style={styles.cardPhoto}>
                {photo ? (
                    <Image source={{ uri: photo }} style={styles.cardImg} />
                ) : (
                    <View style={styles.cardImgPlaceholder}>
                        <Text style={styles.cardImgInitial}>
                            {viewer.fullName.charAt(0).toUpperCase()}
                        </Text>
                    </View>
                )}
            </View>
            <View style={styles.cardBody}>
                <Text style={styles.cardName} numberOfLines={1}>{viewer.fullName}</Text>
                <Text style={styles.cardMeta}>{age} · {viewer.location}</Text>
                {viewer.bio ? (
                    <Text style={styles.cardBio} numberOfLines={2}>{viewer.bio}</Text>
                ) : null}
            </View>
            <View style={styles.cardRight}>
                <Text style={styles.viewedAgo}>{timeAgo(viewer.viewedAt)}</Text>
                <Text style={styles.eyeIcon}>👁</Text>
            </View>
        </Pressable>
    );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

interface Props {
    onBack: () => void;
    onSelectViewer?: (v: ProfileViewer) => void;
}

export function WhoViewedMeScreen({ onBack, onSelectViewer }: Props) {
    const insets = useSafeAreaInsets();
    const [viewers, setViewers] = useState<ProfileViewer[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);
        try {
            const data = await fetchProfileViewers();
            setViewers(data);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load viewers');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
                <BackButton onPress={onBack} />
                <View style={styles.headerCenter}>
                    <Text style={styles.headerTitle}>Who Viewed Me</Text>
                    {viewers.length > 0 && (
                        <Text style={styles.headerCount}>{viewers.length} visitor{viewers.length !== 1 ? 's' : ''}</Text>
                    )}
                </View>
                <View style={{ width: 40 }} />
            </View>

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
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => load(true)}
                            tintColor="#123340"
                        />
                    }
                    showsVerticalScrollIndicator={false}
                >
                    {viewers.length === 0 ? (
                        <View style={styles.empty}>
                            <Text style={styles.emptyIcon}>👀</Text>
                            <Text style={styles.emptyTitle}>No visitors yet</Text>
                            <Text style={styles.emptySubtitle}>
                                When someone views your profile it will appear here.
                            </Text>
                        </View>
                    ) : (
                        viewers.map((v) => (
                            <ViewerCard
                                key={v.viewerId}
                                viewer={v}
                                onPress={onSelectViewer ?? (() => { })}
                            />
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
    headerCenter: { alignItems: 'center', flex: 1 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#123340' },
    headerCount: { fontSize: 12, color: '#888', marginTop: 2 },

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
    cardPhoto: {},
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
    cardBody: { flex: 1, gap: 2 },
    cardName: { fontSize: 15, fontWeight: '700', color: '#123340' },
    cardMeta: { fontSize: 12, color: '#666' },
    cardBio: { fontSize: 12, color: '#888', marginTop: 2 },
    cardRight: { alignItems: 'flex-end', gap: 4 },
    viewedAgo: { fontSize: 11, color: '#999' },
    eyeIcon: { fontSize: 16 },
});
