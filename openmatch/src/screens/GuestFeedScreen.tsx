import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { ColorValue } from 'react-native';

import { fetchGuestFeed, type GuestProfile } from '../lib/guestApi';
import { trackEvent } from '../lib/analytics';
import { useTheme, type ThemeColors } from '../lib/theme';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';
import { gradients, palette, glow } from '../lib/designSystem';

type GuestFeedScreenProps = {
    onRequireAuth: (intent?: string) => void;
};

export function GuestFeedScreen({ onRequireAuth }: GuestFeedScreenProps) {
    const styles = useThemedStyles();
    const [profiles, setProfiles] = useState<GuestProfile[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        trackEvent('guest_feed_viewed');
        let mounted = true;
        (async () => {
            const feed = await fetchGuestFeed(12);
            if (!mounted) return;
            setProfiles(feed);
            setLoading(false);
        })();
        return () => {
            mounted = false;
        };
    }, []);

    function gate(intent: string) {
        trackEvent('guest_action_gated', { intent });
        onRequireAuth(intent);
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
                <View style={styles.headerRow}>
                    <View style={styles.headerCopy}>
                        <View style={styles.titleRow}>
                            <Text style={styles.title}>Discover</Text>
                            <View style={styles.guestBadge}>
                                <Text style={styles.guestBadgeText}>Guest</Text>
                            </View>
                        </View>
                        <Text style={styles.subtitle}>
                            A peek at members near you. Sign up free to see everyone and send interest.
                        </Text>
                    </View>
                    <Pressable style={styles.signInButton} onPress={() => gate('header_sign_in')}>
                        <Text style={styles.signInButtonText}>Sign in</Text>
                    </Pressable>
                </View>

                {loading ? (
                    <View style={styles.loadingState}>
                        <ActivityIndicator size="large" color={palette.magenta} />
                    </View>
                ) : profiles.length === 0 ? (
                    <View style={styles.stateCard}>
                        <Text style={styles.stateTitle}>No previews available yet</Text>
                        <Text style={styles.stateSubtitle}>Create a free account to start matching.</Text>
                        <Pressable style={styles.refreshButton} onPress={() => gate('empty_state')}>
                            <Text style={styles.refreshButtonText}>Sign up free</Text>
                        </Pressable>
                    </View>
                ) : (
                    <ScrollView
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {profiles.map((p) => (
                            <GuestCard key={p.id} profile={p} onAction={gate} />
                        ))}

                        <View style={styles.lockCard}>
                            <Text style={styles.lockEmoji}>🔒</Text>
                            <Text style={styles.lockTitle}>See everyone</Text>
                            <Text style={styles.lockSubtitle}>
                                Create a free account to unlock the full match feed, AI compatibility,
                                and send interest.
                            </Text>
                            <Pressable style={styles.lockCta} onPress={() => gate('feed_bottom')}>
                                <LinearGradient
                                    colors={gradients.primary as unknown as readonly [ColorValue, ColorValue, ...ColorValue[]]}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                    style={StyleSheet.absoluteFill}
                                />
                                <Text style={styles.lockCtaText}>Sign up free</Text>
                            </Pressable>
                        </View>
                    </ScrollView>
                )}
            </View>
        </SafeAreaView>
    );
}

function GuestCard({
    profile,
    onAction,
}: {
    profile: GuestProfile;
    onAction: (intent: string) => void;
}) {
    const styles = useThemedStyles();
    const name = profile.first_name || 'Member';
    const fallbackInitial = name.slice(0, 1).toUpperCase() || '?';
    const metaParts = [profile.age ? String(profile.age) : null].filter(Boolean);

    return (
        <View style={styles.cardWrap}>
            <Pressable style={styles.cardPressable} onPress={() => onAction('open_profile')}>
                {profile.photo_url ? (
                    <Image source={{ uri: profile.photo_url }} style={[styles.cardPhoto, styles.cardPhotoExpanded]} />
                ) : (
                    <View style={[styles.cardPhotoPlaceholder, styles.cardPhotoExpanded]}>
                        <Text style={styles.cardPhotoInitial}>{fallbackInitial}</Text>
                    </View>
                )}

                <View style={styles.cardHeader}>
                    <View style={styles.scorePill}>
                        <Text style={styles.scoreText}>New match</Text>
                    </View>
                    {profile.city ? (
                        <Text style={styles.locationText}>📍 {profile.city}</Text>
                    ) : null}
                </View>

                {profile.verified ? (
                    <View style={styles.verifiedTag}>
                        <Text style={styles.verifiedTagText}>✓ Verified</Text>
                    </View>
                ) : null}

                <Text style={styles.cardName}>{name}</Text>
                {metaParts.length > 0 && <Text style={styles.cardMeta}>{metaParts.join(', ')}</Text>}

                <Text numberOfLines={4} style={styles.cardBio}>
                    {profile.short_bio || 'No bio added yet.'}
                </Text>

                <Text style={styles.tapHint}>Sign up to see the full profile</Text>
            </Pressable>

            <View style={styles.actionsRow}>
                <Pressable
                    style={[styles.actionButton, styles.actionButtonMuted]}
                    onPress={() => onAction('pass')}
                >
                    <Text style={styles.actionButtonTextMuted}>Pass</Text>
                </Pressable>
                <Pressable
                    style={[styles.actionButtonPrimaryWrap, styles.actionButtonEmphasis]}
                    onPress={() => onAction('interest')}
                >
                    <LinearGradient
                        colors={gradients.primary as unknown as readonly [ColorValue, ColorValue, ...ColorValue[]]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                    />
                    <View style={styles.actionButtonInner}>
                        <Text style={styles.actionButtonText}>Interest</Text>
                    </View>
                </Pressable>
            </View>
        </View>
    );
}

function useThemedStyles() {
    const { colors } = useTheme();
    return useMemo(() => makeStyles(colors), [colors]);
}

const makeStyles = (c: ThemeColors) =>
    StyleSheet.create({
        safeArea: {
            backgroundColor: c.background,
            flex: 1,
        },
        container: {
            alignSelf: 'center',
            flex: 1,
            maxWidth: MAX_CONTENT_WIDTH,
            width: '100%',
        },
        headerRow: {
            alignItems: 'flex-start',
            flexDirection: 'row',
            gap: 12,
            justifyContent: 'space-between',
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: 8,
        },
        headerCopy: {
            flex: 1,
            gap: 6,
        },
        titleRow: {
            alignItems: 'center',
            flexDirection: 'row',
            gap: 10,
        },
        title: {
            color: c.textPrimary,
            fontSize: 30,
            fontWeight: '800',
        },
        guestBadge: {
            backgroundColor: 'rgba(255,106,61,0.15)',
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 3,
        },
        guestBadgeText: {
            color: '#ff6a3d',
            fontSize: 12,
            fontWeight: '800',
        },
        subtitle: {
            color: c.textSecondary,
            fontSize: 15,
            lineHeight: 22,
        },
        signInButton: {
            backgroundColor: c.cardBackground,
            borderColor: c.cardBorder,
            borderRadius: 14,
            borderWidth: 1,
            paddingHorizontal: 16,
            paddingVertical: 12,
        },
        signInButtonText: {
            color: '#ff6a3d',
            fontSize: 14,
            fontWeight: '800',
        },
        loadingState: {
            alignItems: 'center',
            flex: 1,
            gap: 12,
            justifyContent: 'center',
        },
        scrollContent: {
            paddingBottom: 32,
            paddingHorizontal: 20,
            paddingTop: 8,
            gap: 18,
        },
        stateCard: {
            backgroundColor: c.cardBackground,
            borderRadius: 28,
            gap: 12,
            marginHorizontal: 20,
            marginTop: 40,
            padding: 28,
        },
        stateTitle: {
            color: c.textPrimary,
            fontSize: 24,
            fontWeight: '800',
        },
        stateSubtitle: {
            color: c.textSecondary,
            fontSize: 15,
            lineHeight: 22,
        },
        refreshButton: {
            alignSelf: 'flex-start',
            backgroundColor: palette.coral,
            borderRadius: 999,
            paddingHorizontal: 18,
            paddingVertical: 12,
            ...glow(palette.magenta, 0.4, 16),
        },
        refreshButtonText: {
            color: '#ffffff',
            fontSize: 14,
            fontWeight: '700',
        },
        cardWrap: {
            gap: 14,
        },
        cardPressable: {
            backgroundColor: c.cardBackground,
            borderColor: c.cardBorder,
            borderRadius: 30,
            borderWidth: 1,
            gap: 14,
            padding: 24,
        },
        cardPhoto: {
            borderRadius: 24,
            width: '100%',
        },
        cardPhotoExpanded: {
            height: 320,
        },
        cardPhotoPlaceholder: {
            alignItems: 'center',
            backgroundColor: '#ead9c9',
            borderRadius: 24,
            justifyContent: 'center',
            width: '100%',
        },
        cardPhotoInitial: {
            color: '#9a3b18',
            fontSize: 54,
            fontWeight: '800',
        },
        cardHeader: {
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'space-between',
        },
        scorePill: {
            backgroundColor: '#121732',
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 8,
        },
        scoreText: {
            color: '#ffffff',
            fontSize: 12,
            fontWeight: '800',
        },
        locationText: {
            color: c.textSecondary,
            fontSize: 13,
            fontWeight: '700',
        },
        verifiedTag: {
            alignSelf: 'flex-start',
            backgroundColor: 'rgba(34,197,94,0.15)',
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 5,
        },
        verifiedTagText: {
            color: '#22c55e',
            fontSize: 12,
            fontWeight: '800',
        },
        cardName: {
            color: c.textPrimary,
            fontSize: 31,
            fontWeight: '800',
            marginTop: 4,
        },
        cardMeta: {
            color: c.textSecondary,
            fontSize: 15,
            lineHeight: 22,
        },
        cardBio: {
            color: c.textSecondary,
            fontSize: 16,
            lineHeight: 24,
            marginTop: 6,
        },
        tapHint: {
            color: '#c2643f',
            fontSize: 13,
            fontWeight: '700',
            marginTop: 4,
        },
        actionsRow: {
            flexDirection: 'row',
            gap: 10,
            justifyContent: 'space-between',
        },
        actionButton: {
            alignItems: 'center',
            borderRadius: 18,
            flex: 1,
            paddingHorizontal: 12,
            paddingVertical: 15,
        },
        actionButtonMuted: {
            backgroundColor: 'transparent',
            borderColor: c.cardBorder,
            borderWidth: 1.5,
        },
        actionButtonTextMuted: {
            color: c.textSecondary,
            fontSize: 15,
            fontWeight: '800',
        },
        actionButtonEmphasis: {
            flex: 1.6,
        },
        actionButtonPrimaryWrap: {
            borderRadius: 18,
            overflow: 'hidden',
        },
        actionButtonInner: {
            alignItems: 'center',
            paddingHorizontal: 12,
            paddingVertical: 15,
        },
        actionButtonText: {
            color: '#ffffff',
            fontSize: 15,
            fontWeight: '800',
        },
        lockCard: {
            alignItems: 'center',
            backgroundColor: c.cardBackground,
            borderColor: c.cardBorder,
            borderRadius: 30,
            borderWidth: 1,
            gap: 8,
            padding: 28,
        },
        lockEmoji: {
            fontSize: 32,
        },
        lockTitle: {
            color: c.textPrimary,
            fontSize: 22,
            fontWeight: '900',
        },
        lockSubtitle: {
            color: c.textSecondary,
            fontSize: 14,
            lineHeight: 21,
            textAlign: 'center',
        },
        lockCta: {
            alignItems: 'center',
            borderRadius: 999,
            marginTop: 8,
            overflow: 'hidden',
            paddingHorizontal: 28,
            paddingVertical: 14,
        },
        lockCtaText: {
            color: '#ffffff',
            fontSize: 15,
            fontWeight: '800',
        },
    });
