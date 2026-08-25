import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Image,
    Modal,
    PanResponder,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../lib/theme';

import { BackButton } from '../components/BackButton';
import { HorizontalScrollAffordance } from '../components/HorizontalScrollAffordance';
import { fetchFitFrictionBreakdown } from '../lib/aiApi';
import { MatchCandidate, ViewerEmbeddingStatus } from '../lib/matchmaking';
import { getDisplayFirstName, ProfileContactDetails, ProfileRecord } from '../lib/profile';
import {
    deleteCurrentUserProfilePhotos,
    maxProfilePhotos,
    pickProfilePhotoFromLibrary,
    uploadCurrentUserProfilePhotos,
} from '../lib/profilePhotoApi';
import {
    fetchCompatibilitySnapshot,
    fetchSemanticMatches,
    recordPassedProfile,
    recordHardRejectProfile,
    clearPassedProfiles,
} from '../lib/matchmakingApi';
import {
    fetchCurrentProfile,
    fetchCurrentProfileContactDetails,
    updateCurrentProfilePhotoUrls,
    upsertCurrentProfileContactDetails,
} from '../lib/profileApi';
import { ConnectComposerSheet } from '../components/ConnectComposerSheet';
import { MatchProfileScreen } from './MatchProfileScreen';
import { supabase } from '../lib/supabase';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';
import { trackPremiumEvent } from '../lib/premiumAnalytics';
import { updateUserPresence } from '../lib/chatApi';
import { PremiumPromoVariant, resolvePremiumPromoVariant } from '../lib/premiumTargeting';
import {
    recordPremiumPopupCtaTapped,
    recordPremiumPopupDismissed,
    recordPremiumPopupShown,
    shouldShowPremiumPopup,
} from '../lib/premiumPopup';
import { PremiumPromoModal } from '../components/PremiumPromoModal';
import { VerificationPromptModal } from '../components/VerificationPromptModal';
import {
    loadPromptState,
    recordPromptAccepted,
    recordPromptDismissed,
    recordPromptShown,
    shouldShowVerificationPrompt,
} from '../lib/verificationPrompt';
import { IdentityVerificationScreen } from './IdentityVerificationScreen';

const swipeThreshold = 120;
const offscreenDistance = 420;

// Validates an optional contact phone number. Returns an error message string
// if invalid, or null if the value is acceptable (empty is allowed since the
// fields are optional). Accepts an optional leading "+" followed by 8-15
// digits, ignoring spaces, dashes, parentheses and dots used as separators.
function validateContactNumber(rawValue: string, fieldLabel: string): string | null {
    const trimmed = rawValue.trim();
    if (!trimmed) {
        return null;
    }

    const cleaned = trimmed.replace(/[\s\-().]/g, '');
    if (!/^\+?\d{8,15}$/.test(cleaned)) {
        return `${fieldLabel} must be 8-15 digits and may start with a country code (e.g. +91).`;
    }

    return null;
}

export function HomeScreen({
    onOpenNotifications,
    unreadNotificationsCount = 0,
    initialPhotoManagerOpen = false,
}: {
    onOpenNotifications?: () => void;
    unreadNotificationsCount?: number;
    initialPhotoManagerOpen?: boolean;
} = {}) {
    const { colors, activeTheme } = useTheme();
    const isDark = activeTheme === 'dark';
    const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFeedFilter, setActiveFeedFilter] = useState<FeedFilter>('new');
    const [viewerEmbeddingStatus, setViewerEmbeddingStatus] = useState<ViewerEmbeddingStatus>('ready');
    const [usingLegacyMatchFunction, setUsingLegacyMatchFunction] = useState(false);
    const [selectedCandidate, setSelectedCandidate] = useState<MatchCandidate | null>(null);
    const [compatibilitySummary, setCompatibilitySummary] = useState<string | null>(null);
    const [fitPoints, setFitPoints] = useState<string[]>([]);
    const [frictionPoints, setFrictionPoints] = useState<string[]>([]);
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [connectCandidate, setConnectCandidate] = useState<MatchCandidate | null>(null);
    const [viewerFirstName, setViewerFirstName] = useState('');
    const [viewerProfile, setViewerProfile] = useState<ProfileRecord | null>(null);
    const [viewerContactDetails, setViewerContactDetails] = useState<ProfileContactDetails | null>(null);
    const [contactPhoneNumber, setContactPhoneNumber] = useState('');
    const [contactWhatsappNumber, setContactWhatsappNumber] = useState('');
    const [contactSaving, setContactSaving] = useState(false);
    const [photoManagerVisible, setPhotoManagerVisible] = useState(initialPhotoManagerOpen);
    const [photoMutationPending, setPhotoMutationPending] = useState(false);
    const [premiumPopup, setPremiumPopup] = useState<PremiumPromoVariant | null>(null);
    const [verificationPromptVisible, setVerificationPromptVisible] = useState(false);
    const [verifyScreenVisible, setVerifyScreenVisible] = useState(false);
    const pan = useRef(new Animated.ValueXY()).current;
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    const viewerPhotoUrls = viewerProfile?.photo_urls ?? [];
    const useStackedHeader = windowWidth < 430;
    const useCompactFeedLayout = useStackedHeader || windowHeight < 760;
    // The swipe deck gets a stable, viewport-relative height so it sits inside a
    // vertical ScrollView (cards are absolutely positioned and need a bounded
    // height). Short screens simply scroll to reveal the action row.
    const activePhotoHeight = Math.max(150, Math.min(260, Math.round(windowHeight * 0.26)));
    const feedStackHeight = Math.max(380, Math.min(560, Math.round(windowHeight * 0.62)));
    const expandedBioLines = useCompactFeedLayout ? 4 : 6;

    const visibleCandidates = useMemo(() => {
        const normalizedSearch = searchQuery.trim().toLowerCase();

        return candidates.filter((candidate) => {
            const matchesSearch =
                !normalizedSearch ||
                candidate.full_name.toLowerCase().includes(normalizedSearch) ||
                candidate.location.toLowerCase().includes(normalizedSearch) ||
                (candidate.bio ?? '').toLowerCase().includes(normalizedSearch) ||
                (candidate.preferences ?? '').toLowerCase().includes(normalizedSearch);

            if (!matchesSearch) {
                return false;
            }

            return matchesFeedFilter(candidate, activeFeedFilter, viewerProfile?.location ?? null);
        });
    }, [activeFeedFilter, candidates, searchQuery, viewerProfile?.location]);

    const feedFilterCounts = useMemo<Record<FeedFilter, number>>(
        () => ({
            new: candidates.filter((candidate) => matchesFeedFilter(candidate, 'new', viewerProfile?.location ?? null)).length,
            daily: candidates.filter((candidate) => matchesFeedFilter(candidate, 'daily', viewerProfile?.location ?? null)).length,
            withPhotos: candidates.filter((candidate) => matchesFeedFilter(candidate, 'withPhotos', viewerProfile?.location ?? null)).length,
            nearby: candidates.filter((candidate) => matchesFeedFilter(candidate, 'nearby', viewerProfile?.location ?? null)).length,
            passed: candidates.filter((candidate) => matchesFeedFilter(candidate, 'passed', viewerProfile?.location ?? null)).length,
        }),
        [candidates, viewerProfile?.location],
    );

    async function onSignOut() {
        try {
            await updateUserPresence('offline');
        } catch (presenceErr) {
            console.warn('Failed to set status to offline before sign out:', presenceErr);
        }
        const { error } = await supabase.auth.signOut();
        if (error) {
            Alert.alert('Sign out failed', error.message);
        }
    }

    function resetFeedFilters() {
        setSearchQuery('');
        setActiveFeedFilter('new');
    }

    async function resetFeedAndPassed() {
        await clearPassedProfiles();
        resetFeedFilters();
        await loadFeed(true);
    }

    async function loadFeed(showLoader: boolean, silentErrors = false, isAppend = false) {
        if (isAppend && (!hasMore || loadingMore)) {
            return;
        }

        if (showLoader) {
            setLoading(true);
        } else if (isAppend) {
            setLoadingMore(true);
        } else {
            setRefreshing(true);
        }

        try {
            const offset = isAppend ? candidates.length : 0;
            const result = await fetchSemanticMatches(50, offset);

            if (isAppend) {
                setCandidates((prev) => [...prev, ...result.candidates]);
                setHasMore(result.candidates.length >= 50);
            } else {
                setCandidates(result.candidates);
                setHasMore(result.candidates.length >= 50);
                setCurrentIndex(0);
                pan.setValue({ x: 0, y: 0 });
            }
            setViewerEmbeddingStatus(result.viewerEmbeddingStatus);
            setUsingLegacyMatchFunction(result.usedLegacyFunction);
        } catch (error) {
            if (!silentErrors) {
                const message = error instanceof Error ? error.message : 'Unable to load the semantic feed.';
                Alert.alert('Feed unavailable', message);
            }
        } finally {
            setLoading(false);
            setRefreshing(false);
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        void loadFeed(true);
        void syncViewerProfile();
    }, []);

    async function syncViewerProfile() {
        try {
            const [profile, contactDetails] = await Promise.all([
                fetchCurrentProfile(),
                fetchCurrentProfileContactDetails(),
            ]);
            setViewerProfile(profile);
            setViewerContactDetails(contactDetails);
            setContactPhoneNumber(contactDetails?.phone_number ?? '');
            setContactWhatsappNumber(contactDetails?.whatsapp_number ?? '');
            setViewerFirstName(getDisplayFirstName(profile?.full_name));
        } catch (error) {
            console.warn('Failed to load viewer profile.', error);
        }
    }

    async function handleSaveContactDetails() {
        if (contactSaving) {
            return;
        }

        // Validate before saving. Numbers are optional, but if provided they
        // must be a plausible phone number (optional leading +, 8-15 digits).
        // This prevents junk/invalid numbers from being shared once a match
        // completes mutual unlock and the Call/WhatsApp deep-links are used.
        const phoneError = validateContactNumber(contactPhoneNumber, 'Phone number');
        if (phoneError) {
            Alert.alert('Invalid phone number', phoneError);
            return;
        }

        const whatsappError = validateContactNumber(contactWhatsappNumber, 'WhatsApp number');
        if (whatsappError) {
            Alert.alert('Invalid WhatsApp number', whatsappError);
            return;
        }

        setContactSaving(true);

        try {
            const nextContactDetails = await upsertCurrentProfileContactDetails({
                phone_number: contactPhoneNumber,
                whatsapp_number: contactWhatsappNumber,
            });

            setViewerContactDetails(nextContactDetails);
            setContactPhoneNumber(nextContactDetails.phone_number ?? '');
            setContactWhatsappNumber(nextContactDetails.whatsapp_number ?? '');
            Alert.alert('Contact details saved', 'These details will only be shown after a mutual unlock is completed.');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not save contact details.';
            Alert.alert('Save failed', message);
        } finally {
            setContactSaving(false);
        }
    }

    async function handleAddProfilePhoto() {
        if (photoMutationPending) {
            return;
        }

        if (!viewerProfile) {
            Alert.alert('Profile unavailable', 'Refresh the app and try adding photos again.');
            return;
        }

        if (viewerPhotoUrls.length >= maxProfilePhotos) {
            Alert.alert('Photo limit reached', `You can add up to ${maxProfilePhotos} photos.`);
            return;
        }

        setPhotoMutationPending(true);

        try {
            const pickedPhoto = await pickProfilePhotoFromLibrary();
            if (!pickedPhoto) {
                return;
            }

            const uploadedPhotoUrls = await uploadCurrentUserProfilePhotos([pickedPhoto]);
            const updatedProfile = await updateCurrentProfilePhotoUrls([...viewerPhotoUrls, ...uploadedPhotoUrls]);
            setViewerProfile(updatedProfile);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not add this photo.';
            Alert.alert('Photo upload failed', message);
        } finally {
            setPhotoMutationPending(false);
        }
    }

    function confirmRemoveProfilePhoto(photoUrl: string) {
        Alert.alert('Remove photo?', 'This will remove the photo from your profile.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: () => {
                    void handleRemoveProfilePhoto(photoUrl);
                },
            },
        ]);
    }

    async function handleRemoveProfilePhoto(photoUrl: string) {
        if (photoMutationPending) {
            return;
        }

        if (!viewerProfile) {
            Alert.alert('Profile unavailable', 'Refresh the app and try removing the photo again.');
            return;
        }

        const nextPhotoUrls = viewerPhotoUrls.filter((url) => url !== photoUrl);
        setPhotoMutationPending(true);

        try {
            const updatedProfile = await updateCurrentProfilePhotoUrls(nextPhotoUrls);
            setViewerProfile(updatedProfile);

            try {
                await deleteCurrentUserProfilePhotos([photoUrl]);
            } catch (cleanupError) {
                console.warn('Removed photo from the profile but could not delete the storage object.', cleanupError);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not remove this photo.';
            Alert.alert('Photo removal failed', message);
        } finally {
            setPhotoMutationPending(false);
        }
    }

    useEffect(() => {
        if (loading || refreshing || viewerEmbeddingStatus === 'ready') {
            return;
        }

        const timeoutId = setTimeout(() => {
            void loadFeed(false, true);
        }, 15000);

        return () => clearTimeout(timeoutId);
    }, [loading, refreshing, viewerEmbeddingStatus]);

    useEffect(() => {
        setCurrentIndex(0);
        pan.setValue({ x: 0, y: 0 });
    }, [activeFeedFilter, searchQuery, pan]);

    // Auto-fetch more profiles when the user is 5 cards from the end of the feed.
    useEffect(() => {
        if (loading || refreshing || loadingMore || !hasMore) return;
        if (visibleCandidates.length === 0) return;
        if (currentIndex < visibleCandidates.length - 5) return;
        void loadFeed(false, true, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex, loading, refreshing, loadingMore, hasMore, visibleCandidates.length]);

    const activeCandidate = visibleCandidates[currentIndex] ?? null;
    const nextCandidate = visibleCandidates[currentIndex + 1] ?? null;
    const thirdCandidate = visibleCandidates[currentIndex + 2] ?? null;

    const cardRotation = pan.x.interpolate({
        inputRange: [-offscreenDistance, 0, offscreenDistance],
        outputRange: ['-10deg', '0deg', '10deg'],
        extrapolate: 'clamp',
    });

    const nextCardScale = pan.x.interpolate({
        inputRange: [-offscreenDistance, 0, offscreenDistance],
        outputRange: [1, 0.96, 1],
        extrapolate: 'clamp',
    });

    const nextCardLift = pan.x.interpolate({
        inputRange: [-offscreenDistance, 0, offscreenDistance],
        outputRange: [8, 18, 8],
        extrapolate: 'clamp',
    });

    function resetCard() {
        Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
            bounciness: 8,
        }).start();
    }

    function advanceCard() {
        pan.setValue({ x: 0, y: 0 });
        setCurrentIndex((value) => value + 1);
    }

    /**
     * Runs after an interest request is sent. The verification nudge takes
     * priority over the premium promo — they compete for the same slot, and
     * stacking two modals after one action is hostile.
     */
    async function handleRequestSent() {
        if (await maybeShowVerificationPrompt()) {
            return;
        }
        await maybeShowPremiumPopup();
    }

    /** Returns true when the prompt was shown, so the caller can stand down. */
    async function maybeShowVerificationPrompt(): Promise<boolean> {
        try {
            const { data } = await supabase.auth.getUser();
            const userId = data.user?.id;
            if (!userId) return false;

            const state = await loadPromptState(userId);
            if (!shouldShowVerificationPrompt(viewerProfile?.verification_status, state)) {
                return false;
            }

            setVerificationPromptVisible(true);
            await recordPromptShown(userId);
            return true;
        } catch (error) {
            console.warn('Verification prompt could not be evaluated.', error);
            return false;
        }
    }

    function handleVerificationPromptAccept() {
        setVerificationPromptVisible(false);
        setVerifyScreenVisible(true);
        void (async () => {
            const { data } = await supabase.auth.getUser();
            if (data.user?.id) await recordPromptAccepted(data.user.id);
        })();
    }

    function handleVerificationPromptDismiss() {
        setVerificationPromptVisible(false);
        void (async () => {
            const { data } = await supabase.auth.getUser();
            if (data.user?.id) await recordPromptDismissed(data.user.id);
        })();
    }

    async function maybeShowPremiumPopup() {
        try {
            const variant = await resolvePremiumPromoVariant('home_feed');
            if (!(await shouldShowPremiumPopup(variant))) {
                return;
            }

            setPremiumPopup(variant);
            await recordPremiumPopupShown();
            void trackPremiumEvent({
                eventName: 'premium_promo_impression',
                surface: 'home_feed',
                context: `popup_${variant.id}`,
                metadata: { placement: 'modal', variant: variant.id, experimentArm: variant.experimentArm },
            });
        } catch (error) {
            console.warn('Premium popup could not be evaluated.', error);
        }
    }

    function handlePremiumPopupCta(variant: PremiumPromoVariant) {
        void trackPremiumEvent({
            eventName: 'premium_promo_cta_tap',
            surface: 'home_feed',
            context: `popup_${variant.id}_cta`,
            metadata: { placement: 'modal', variant: variant.id, experimentArm: variant.experimentArm },
        });
        void recordPremiumPopupCtaTapped();
        setPremiumPopup(null);
        Alert.alert('Premium coming soon', variant.ctaNotice);
    }

    function handlePremiumPopupDismiss(variant: PremiumPromoVariant) {
        void trackPremiumEvent({
            eventName: 'premium_popup_dismiss',
            surface: 'home_feed',
            context: `popup_${variant.id}_dismiss`,
            metadata: { placement: 'modal', variant: variant.id, experimentArm: variant.experimentArm },
        });
        void recordPremiumPopupDismissed();
        setPremiumPopup(null);
    }

    function openConnectComposer(candidate: MatchCandidate) {
        resetCard();
        setConnectCandidate(candidate);
    }

    async function savePass(candidate: MatchCandidate) {
        try {
            await recordPassedProfile(candidate.id);
            // Mark locally as 'passed' so it's filtered from the session feed.
            // The DB enforces the 30-day TTL; after that the profile reappears automatically.
            setCandidates((prev) =>
                prev.map((c) => (c.id === candidate.id ? { ...c, matchStatus: 'passed' } : c)),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not save this pass.';
            Alert.alert('Pass save failed', message);
        }
    }

    async function saveHardReject(candidate: MatchCandidate) {
        try {
            await recordHardRejectProfile(candidate.id);
            // Mark locally as 'rejected' (permanent hard block)
            setCandidates((prev) =>
                prev.map((c) => (c.id === candidate.id ? { ...c, matchStatus: 'rejected' } : c)),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not block this profile.';
            Alert.alert('Block failed', message);
        }
    }

    function commitSwipe(direction: 'left' | 'right') {
        if (!activeCandidate) {
            return;
        }

        const candidate = activeCandidate;

        if (direction === 'right') {
            if (getPremiumHighlightForCandidate(candidate)) {
                void trackPremiumEvent({
                    eventName: 'premium_highlight_interest_tap',
                    surface: 'home_feed',
                    context: 'swipe_interest',
                    metadata: {
                        candidateId: candidate.id,
                        similarity: candidate.similarity,
                    },
                });
            }
            openConnectComposer(candidate);
            return;
        }

        Animated.timing(pan, {
            toValue: { x: -offscreenDistance, y: 0 },
            duration: 180,
            useNativeDriver: true,
        }).start(() => {
            advanceCard();

            void savePass(candidate);
        });
    }

    async function openCompatibility(candidate: MatchCandidate) {
        const premiumHighlight = getPremiumHighlightForCandidate(candidate);
        if (premiumHighlight) {
            void trackPremiumEvent({
                eventName: 'premium_highlight_card_open',
                surface: 'home_feed',
                context: 'candidate_card',
                metadata: {
                    candidateId: candidate.id,
                    reason: premiumHighlight,
                    similarity: candidate.similarity,
                },
            });
        }

        setSelectedCandidate(candidate);
        setCompatibilitySummary(null);
        setFitPoints([]);
        setFrictionPoints([]);
        setSummaryLoading(true);

        try {
            const breakdown = await fetchFitFrictionBreakdown(candidate.id);
            setCompatibilitySummary(breakdown.summary);
            setFitPoints(breakdown.fitPoints);
            setFrictionPoints(breakdown.frictionPoints);
        } catch (error) {
            console.warn('Fit breakdown unavailable, falling back to summary.', error);

            try {
                const summary = await fetchCompatibilitySnapshot(candidate.id);
                setCompatibilitySummary(summary);
            } catch (summaryError) {
                const message = summaryError instanceof Error ? summaryError.message : 'Compatibility summary unavailable.';
                setCompatibilitySummary(buildFallbackSummary(candidate));
                Alert.alert('Using fallback snapshot', message);
            }
        } finally {
            setSummaryLoading(false);
        }
    }

    function handleConnectFromDetail() {
        if (!selectedCandidate) {
            return;
        }

        const candidate = selectedCandidate;
        setSelectedCandidate(null);
        openConnectComposer(candidate);
    }

    function handlePassFromDetail() {
        if (!selectedCandidate) {
            return;
        }

        const candidate = selectedCandidate;
        setSelectedCandidate(null);

        if (candidate.id === activeCandidate?.id) {
            advanceCard();
        }

        void savePass(candidate);
    }

    function handleHardRejectFromDetail() {
        if (!selectedCandidate) {
            return;
        }

        const candidate = selectedCandidate;
        setSelectedCandidate(null);

        if (candidate.id === activeCandidate?.id) {
            advanceCard();
        }

        void saveHardReject(candidate);
    }

    const responder = useMemo(
        () =>
            PanResponder.create({
                onMoveShouldSetPanResponder: (_event, gestureState) => {
                    // Only claim clearly-horizontal drags so vertical gestures
                    // pass through to the surrounding ScrollView for scrolling.
                    return Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 8;
                },
                onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
                    useNativeDriver: false,
                }),
                onPanResponderRelease: (_event, gestureState) => {
                    if (gestureState.dx > swipeThreshold) {
                        commitSwipe('right');
                        return;
                    }

                    if (gestureState.dx < -swipeThreshold) {
                        commitSwipe('left');
                        return;
                    }

                    resetCard();
                },
            }),
        [activeCandidate],
    );

    function renderStateCard(title: string, subtitle: string, buttonLabel = 'Refresh feed', onPress?: () => void) {
        return (
            <View style={styles.stateCard}>
                <Text style={styles.stateTitle}>{title}</Text>
                <Text style={styles.stateSubtitle}>{subtitle}</Text>

                <Pressable style={styles.refreshButton} onPress={onPress ?? (() => void loadFeed(false))} disabled={refreshing}>
                    <Text style={styles.refreshButtonText}>{refreshing ? 'Checking again...' : buttonLabel}</Text>
                </Pressable>
            </View>
        );
    }

    const embeddingStateContent = getEmbeddingStateContent(viewerEmbeddingStatus);

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['left', 'right']}>
            <ScrollView
                style={[styles.container, { backgroundColor: colors.background }]}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                <View style={[styles.headerRow, useStackedHeader ? styles.headerRowStacked : null]}>
                    <View style={styles.headerCopy}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                            <Text style={[styles.title, { flex: 1, marginRight: 8, color: colors.accent }]} numberOfLines={1} ellipsizeMode="tail">
                                {viewerFirstName ? `Hi, ${viewerFirstName}` : 'Semantic Feed'}
                            </Text>
                            {onOpenNotifications && (
                                <Pressable
                                    style={{ position: 'relative', padding: 6 }}
                                    onPress={onOpenNotifications}
                                >
                                    <Text style={{ fontSize: 22 }}>🔔</Text>
                                    {unreadNotificationsCount > 0 && (
                                        <View style={{
                                            position: 'absolute',
                                            right: 0,
                                            top: 0,
                                            backgroundColor: '#d4a853',
                                            borderRadius: 8,
                                            minWidth: 16,
                                            height: 16,
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            paddingHorizontal: 3,
                                        }}>
                                            <Text style={{ color: '#0a0a0c', fontSize: 9, fontWeight: '700', lineHeight: 11 }}>
                                                {unreadNotificationsCount}
                                            </Text>
                                        </View>
                                    )}
                                </Pressable>
                            )}
                        </View>
                        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                            {viewerFirstName
                                ? 'Swipe through profiles ranked for you and tap a card for the compatibility snapshot.'
                                : 'Swipe through profiles ranked by profile embeddings and tap a card for the compatibility snapshot.'}
                        </Text>
                        {usingLegacyMatchFunction ? (
                            <Text style={styles.warningText}>
                                The app is still using the older SQL function signature. Apply the Phase 3 migration to move this logic fully server-side.
                            </Text>
                        ) : null}

                        <View style={[styles.searchCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#ffffff', borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#e8e2da' }]}>
                            <TextInput
                                style={[styles.searchInput, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#f4f2ef', color: colors.textPrimary }]}
                                placeholder="Search matches by name, city, or profile text"
                                placeholderTextColor={colors.textMuted}
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />

                            <HorizontalScrollAffordance
                                contentContainerStyle={styles.filterChipsRow}
                                fadeColor={colors.background}
                                arrowAccessibilityLabelPrefix="filters"
                            >
                                {feedFilters.map((filter) => (
                                    <FilterChip
                                        key={filter.value}
                                        label={filter.label}
                                        count={feedFilterCounts[filter.value]}
                                        active={activeFeedFilter === filter.value}
                                        onPress={() => setActiveFeedFilter(filter.value)}
                                    />
                                ))}
                            </HorizontalScrollAffordance>
                        </View>
                    </View>
                </View>

                {loading ? (
                    <View style={styles.loadingState}>
                        <HomeFeedSkeleton />
                        <Text style={[styles.loadingText, { color: colors.textMuted }]}>Building your ranked feed...</Text>
                    </View>
                ) : viewerEmbeddingStatus !== 'ready' ? (
                    renderStateCard(
                        embeddingStateContent.title,
                        embeddingStateContent.subtitle,
                        embeddingStateContent.buttonLabel,
                    )
                ) : !activeCandidate ? (
                    renderStateCard(
                        visibleCandidates.length === 0 && candidates.length > 0
                            ? 'No profiles match this view'
                            : 'No matches in feed',
                        visibleCandidates.length === 0 && candidates.length > 0
                            ? 'Try a broader search or switch filters to see more profiles from your ranked feed.'
                            : "You've seen everyone for now. Reset the feed to see profiles you previously passed on.",
                        visibleCandidates.length === 0 && candidates.length > 0 ? 'Clear filters' : 'Reset feed',
                        visibleCandidates.length === 0 && candidates.length > 0 ? resetFeedFilters : resetFeedAndPassed,
                    )
                ) : (
                    <>
                        <View style={[styles.stackArea, useCompactFeedLayout ? styles.stackAreaCompact : null, { height: feedStackHeight }]}>
                            {thirdCandidate ? (
                                <View pointerEvents="none" style={[styles.card, styles.thirdCard, useCompactFeedLayout ? styles.thirdCardCompact : null]}>
                                    <CandidateCard candidate={thirdCandidate} compact />
                                </View>
                            ) : null}

                            {nextCandidate ? (
                                <Animated.View
                                    pointerEvents="none"
                                    style={[
                                        styles.card,
                                        styles.nextCard,
                                        useCompactFeedLayout ? styles.nextCardCompact : null,
                                        {
                                            transform: [{ scale: nextCardScale }, { translateY: nextCardLift }],
                                        },
                                    ]}
                                >
                                    <CandidateCard candidate={nextCandidate} compact />
                                </Animated.View>
                            ) : null}

                            <Animated.View
                                style={[
                                    styles.card,
                                    styles.activeCard,
                                    {
                                        transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate: cardRotation }],
                                    },
                                ]}
                                {...responder.panHandlers}
                            >
                                <CandidateCard
                                    candidate={activeCandidate}
                                    condensed={useCompactFeedLayout}
                                    expandedPhotoHeight={activePhotoHeight}
                                    expandedBioLines={expandedBioLines}
                                    onPress={() => void openCompatibility(activeCandidate)}
                                />
                            </Animated.View>
                        </View>

                        <View style={[styles.actionsRow, useCompactFeedLayout ? styles.actionsRowCompact : null]}>
                            <ActionButton compact={useCompactFeedLayout} label="Pass" tone="muted" onPress={() => commitSwipe('left')} />
                            <ActionButton compact={useCompactFeedLayout} label="Interested" tone="primary" emphasis onPress={() => commitSwipe('right')} />
                        </View>
                    </>
                )}
            </ScrollView>

            <Modal transparent animationType="fade" visible={photoManagerVisible} onRequestClose={() => setPhotoManagerVisible(false)}>
                <View style={styles.modalBackdrop}>
                    <View style={[styles.modalCard, styles.photoModalCard]}>
                        <View style={styles.modalHeaderRow}>
                            <BackButton onPress={() => setPhotoManagerVisible(false)} />
                            <View style={styles.modalHeaderCopy}>
                                <Text style={styles.modalEyebrow}>Your Profile</Text>
                                <Text style={styles.modalTitle}>Manage profile</Text>
                            </View>
                        </View>

                        <ScrollView style={styles.photoModalScroll} contentContainerStyle={styles.photoModalContent} showsVerticalScrollIndicator={false}>
                            <Text style={styles.modalBody}>
                                Add up to {maxProfilePhotos} photos for profiles that were already created. Your first photo is used across the app.
                            </Text>

                            <View style={styles.photoManagerHeader}>
                                <Text style={styles.photoManagerCount}>
                                    {viewerPhotoUrls.length} of {maxProfilePhotos} photos added
                                </Text>
                                {photoMutationPending ? <ActivityIndicator size="small" color="#123340" /> : null}
                            </View>

                            {viewerPhotoUrls.length > 0 ? (
                                <View style={styles.profilePhotoGrid}>
                                    {viewerPhotoUrls.map((photoUrl, index) => (
                                        <View key={photoUrl} style={styles.profilePhotoTile}>
                                            <Image source={{ uri: photoUrl }} style={styles.profilePhotoTileImage} />

                                            <View style={styles.profilePhotoBadge}>
                                                <Text style={styles.profilePhotoBadgeText}>{index === 0 ? 'Primary' : `Photo ${index + 1}`}</Text>
                                            </View>

                                            <Pressable
                                                style={styles.profilePhotoRemoveButton}
                                                onPress={() => confirmRemoveProfilePhoto(photoUrl)}
                                                disabled={photoMutationPending}
                                            >
                                                <Text style={styles.profilePhotoRemoveButtonText}>Remove</Text>
                                            </Pressable>
                                        </View>
                                    ))}
                                </View>
                            ) : (
                                <View style={styles.profilePhotoEmptyState}>
                                    <Text style={styles.profilePhotoEmptyTitle}>No photos yet</Text>
                                    <Text style={styles.profilePhotoEmptyText}>
                                        Existing accounts can now add photos here without going through onboarding again.
                                    </Text>
                                </View>
                            )}

                            {viewerPhotoUrls.length < maxProfilePhotos ? (
                                <Pressable
                                    style={styles.photoManagerAddButton}
                                    onPress={() => void handleAddProfilePhoto()}
                                    disabled={photoMutationPending}
                                >
                                    <Text style={styles.photoManagerAddButtonText}>
                                        {photoMutationPending ? 'Working...' : 'Add photo'}
                                    </Text>
                                </Pressable>
                            ) : (
                                <Text style={styles.photoManagerLimitText}>
                                    You have reached the {maxProfilePhotos}-photo limit.
                                </Text>
                            )}

                            <View style={styles.contactSectionCard}>
                                <Text style={styles.contactSectionTitle}>Contact details for unlocked chats</Text>
                                <Text style={styles.contactSectionBody}>
                                    These are hidden by default and only become visible after both people complete mutual unlock.
                                </Text>

                                <TextInput
                                    keyboardType="phone-pad"
                                    placeholder="Phone number"
                                    placeholderTextColor="#8b9aa0"
                                    style={styles.contactInput}
                                    value={contactPhoneNumber}
                                    onChangeText={setContactPhoneNumber}
                                />

                                <TextInput
                                    keyboardType="phone-pad"
                                    placeholder="WhatsApp number"
                                    placeholderTextColor="#8b9aa0"
                                    style={styles.contactInput}
                                    value={contactWhatsappNumber}
                                    onChangeText={setContactWhatsappNumber}
                                />

                                <Pressable
                                    style={[styles.contactSaveButton, contactSaving ? styles.contactSaveButtonDisabled : null]}
                                    onPress={() => void handleSaveContactDetails()}
                                    disabled={contactSaving}
                                >
                                    <Text style={styles.contactSaveButtonText}>{contactSaving ? 'Saving...' : 'Save contact details'}</Text>
                                </Pressable>

                                {viewerContactDetails?.phone_number || viewerContactDetails?.whatsapp_number ? (
                                    contactPhoneNumber.trim() === (viewerContactDetails?.phone_number ?? '') &&
                                        contactWhatsappNumber.trim() === (viewerContactDetails?.whatsapp_number ?? '') ? (
                                        <Text style={styles.contactSavedHint}>Saved details are ready for unlocked matches.</Text>
                                    ) : (
                                        <Text style={styles.contactSavedHint}>You have unsaved changes. Tap save to update.</Text>
                                    )
                                ) : null}
                            </View>
                        </ScrollView>

                        <Pressable style={styles.modalButton} onPress={() => setPhotoManagerVisible(false)}>
                            <Text style={styles.modalButtonText}>Close</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            <Modal transparent={false} animationType="slide" visible={Boolean(selectedCandidate)} onRequestClose={() => setSelectedCandidate(null)}>
                {selectedCandidate ? (
                    <MatchProfileScreen
                        candidate={selectedCandidate}
                        viewerProfile={viewerProfile}
                        compatibilitySummary={compatibilitySummary}
                        fitPoints={fitPoints}
                        frictionPoints={frictionPoints}
                        summaryLoading={summaryLoading}
                        onClose={() => setSelectedCandidate(null)}
                        onPass={handlePassFromDetail}
                        onHardReject={handleHardRejectFromDetail}
                        onConnect={handleConnectFromDetail}
                    />
                ) : null}
            </Modal>

            <ConnectComposerSheet
                visible={Boolean(connectCandidate)}
                candidate={connectCandidate}
                viewerProfile={viewerProfile}
                onClose={() => setConnectCandidate(null)}
                onSubmitted={(candidate) => {
                    if (candidate.id === activeCandidate?.id) {
                        advanceCard();
                    }
                    void handleRequestSent();
                }}
            />

            <VerificationPromptModal
                visible={verificationPromptVisible}
                previouslyRejected={viewerProfile?.verification_status === 'rejected'}
                onVerify={handleVerificationPromptAccept}
                onDismiss={handleVerificationPromptDismiss}
            />

            <Modal
                transparent={false}
                animationType="slide"
                visible={verifyScreenVisible}
                onRequestClose={() => setVerifyScreenVisible(false)}
            >
                <IdentityVerificationScreen
                    onBack={() => setVerifyScreenVisible(false)}
                    onCompleted={(status) => {
                        setVerifyScreenVisible(false);
                        // Keep the local copy in step so the prompt does not
                        // reappear before the next profile refresh.
                        setViewerProfile((prev) => (prev ? { ...prev, verification_status: status } : prev));
                    }}
                />
            </Modal>

            {premiumPopup ? (
                <PremiumPromoModal
                    visible
                    variant={premiumPopup}
                    onCta={() => handlePremiumPopupCta(premiumPopup)}
                    onClose={() => handlePremiumPopupDismiss(premiumPopup)}
                />
            ) : null}
        </SafeAreaView>
    );
}

type FeedFilter = 'new' | 'daily' | 'withPhotos' | 'nearby' | 'passed';

const feedFilters: { label: string; value: FeedFilter }[] = [
    { label: 'New', value: 'new' },
    { label: 'Daily', value: 'daily' },
    { label: 'With photos', value: 'withPhotos' },
    { label: 'Nearby', value: 'nearby' },
    { label: 'Passed', value: 'passed' },
];

type CandidateCardProps = {
    candidate: MatchCandidate;
    compact?: boolean;
    condensed?: boolean;
    expandedPhotoHeight?: number;
    expandedBioLines?: number;
    onPress?: () => void;
};

function CandidateCard({
    candidate,
    compact = false,
    condensed = false,
    expandedPhotoHeight,
    expandedBioLines = 6,
    onPress,
}: CandidateCardProps) {
    const primaryPhotoUrl = candidate.photo_urls[0];
    const fallbackInitial = getDisplayFirstName(candidate.full_name).slice(0, 1).toUpperCase() || '?';
    const premiumHighlight = getPremiumHighlightForCandidate(candidate);

    const details = (
        <>
            {primaryPhotoUrl ? (
                <Image
                    source={{ uri: primaryPhotoUrl }}
                    style={[
                        styles.cardPhoto,
                        compact ? styles.cardPhotoCompact : styles.cardPhotoExpanded,
                        !compact && expandedPhotoHeight ? { height: expandedPhotoHeight } : null,
                    ]}
                />
            ) : (
                <View
                    style={[
                        styles.cardPhotoPlaceholder,
                        compact ? styles.cardPhotoCompact : styles.cardPhotoExpanded,
                        !compact && expandedPhotoHeight ? { height: expandedPhotoHeight } : null,
                    ]}
                >
                    <Text style={styles.cardPhotoInitial}>{fallbackInitial}</Text>
                    {!compact ? <Text style={styles.cardPhotoHint}>Add photos to stand out more</Text> : null}
                </View>
            )}

            <View style={styles.cardHeader}>
                <View style={styles.scorePill}>
                    <Text style={styles.scoreText}>{formatSimilarity(candidate.similarity)} aligned</Text>
                </View>
                <Text style={styles.locationText}>
                    📍 {candidate.location}
                    {typeof candidate.distance_km === 'number'
                        ? ` (${Math.round(candidate.distance_km)} km)`
                        : ''}
                </Text>
            </View>

            {premiumHighlight ? (
                <View style={[styles.premiumProfileTag, compact ? styles.premiumProfileTagCompact : null]}>
                    <Text style={styles.premiumProfileTagText}>Premium profile</Text>
                    <Text style={styles.premiumProfileTagReason}>{premiumHighlight}</Text>
                </View>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                <Text style={[styles.cardName, condensed ? styles.cardNameCompact : null]}>{candidate.full_name}</Text>
                {candidate.subscription_tier && candidate.subscription_tier !== 'free' ? (
                    <Text style={{ fontSize: 16, marginLeft: 6, color: '#c8a261', alignSelf: 'center' }}>👑</Text>
                ) : null}
            </View>
            <Text style={styles.cardMeta}>
                {candidate.gender}
                {formatAge(candidate.dob) ? `, ${formatAge(candidate.dob)}` : ''}
                {candidate.height_cm ? `, ${candidate.height_cm} cm` : ''}
            </Text>

            <View style={styles.factRow}>
                <FactPill label={`Owner: ${candidate.profile_owner ?? 'self'}`} />
                <FactPill label={candidate.preferences ? 'Preferences ready' : 'Preferences pending'} />
            </View>

            <Text numberOfLines={compact ? 3 : expandedBioLines} style={[styles.cardBio, condensed ? styles.cardBioCompact : null]}>
                {candidate.bio ?? 'No bio added yet.'}
            </Text>

            {!compact && !condensed ? <Text style={styles.tapHint}>Tap for the AI compatibility snapshot</Text> : null}
        </>
    );

    const isPremium = candidate.subscription_tier && candidate.subscription_tier !== 'free';

    if (onPress) {
        return (
            <Pressable style={[styles.cardPressable, condensed ? styles.cardPressableCompact : null, isPremium ? styles.cardPressablePremium : null]} onPress={onPress}>
                {details}
            </Pressable>
        );
    }

    return <View style={[styles.cardPressable, condensed ? styles.cardPressableCompact : null, isPremium ? styles.cardPressablePremium : null]}>{details}</View>;
}

function FilterChip({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
    return (
        <Pressable style={[styles.filterChip, active ? styles.filterChipActive : null]} onPress={onPress}>
            <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : null]}>{`${label} (${count})`}</Text>
        </Pressable>
    );
}

type ActionButtonProps = {
    label: string;
    tone: 'muted' | 'accent' | 'primary';
    compact?: boolean;
    /** Gives the button extra width so the primary choice reads as primary. */
    emphasis?: boolean;
    onPress: () => void;
};

function ActionButton({ label, tone, compact = false, emphasis = false, onPress }: ActionButtonProps) {
    const toneStyle =
        tone === 'muted'
            ? styles.actionButtonMuted
            : tone === 'accent'
                ? styles.actionButtonAccent
                : styles.actionButtonPrimary;

    const toneTextStyle =
        tone === 'muted'
            ? styles.actionButtonTextMuted
            : tone === 'accent'
                ? styles.actionButtonTextAccent
                : styles.actionButtonTextPrimary;

    return (
        <Pressable
            style={({ pressed }) => [
                styles.actionButton,
                compact ? styles.actionButtonCompact : null,
                toneStyle,
                emphasis ? styles.actionButtonEmphasis : null,
                pressed ? styles.actionButtonPressed : null,
            ]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
        >
            <Text style={[styles.actionButtonText, toneTextStyle]} numberOfLines={1}>{label}</Text>
        </Pressable>
    );
}

function FactPill({ label }: { label: string }) {
    return (
        <View style={styles.factPill}>
            <Text style={styles.factText}>{label}</Text>
        </View>
    );
}

function formatAge(dob: string) {
    const birthDate = new Date(dob);
    if (Number.isNaN(birthDate.getTime())) {
        return null;
    }

    const now = new Date();
    let age = now.getFullYear() - birthDate.getFullYear();
    const monthDelta = now.getMonth() - birthDate.getMonth();

    if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birthDate.getDate())) {
        age -= 1;
    }

    return age > 0 ? age : null;
}

function formatSimilarity(similarity: number) {
    const clamped = Math.max(0, Math.min(similarity, 1));
    return `${Math.round(clamped * 100)}%`;
}

function getPremiumHighlightForCandidate(candidate: MatchCandidate) {
    if (candidate.subscription_tier && candidate.subscription_tier !== 'free') {
        return 'Premium member with active subscription benefits';
    }

    const hasStrongProfile = Boolean(candidate.photo_urls.length > 0 && candidate.bio && candidate.preferences);
    if (candidate.similarity >= 0.9 && hasStrongProfile) {
        return 'Top compatibility and complete profile details';
    }

    if (candidate.similarity >= 0.86 && candidate.photo_urls.length >= 2) {
        return 'High fit with multiple profile photos';
    }

    return null;
}

function matchesFeedFilter(candidate: MatchCandidate, filter: FeedFilter, viewerLocation: string | null) {
    if (filter === 'passed') {
        return candidate.matchStatus === 'rejected';
    }

    if (candidate.matchStatus === 'rejected') {
        return false;
    }

    if (filter === 'new') {
        return true;
    }

    if (filter === 'withPhotos') {
        return candidate.photo_urls.length > 0;
    }

    if (filter === 'daily') {
        return candidate.similarity >= 0.78;
    }

    if (filter === 'nearby') {
        if (typeof candidate.distance_km === 'number') {
            return candidate.distance_km <= 100; // 100km radius limit
        }
        if (!viewerLocation) {
            return true;
        }

        return candidate.location.trim().toLowerCase() === viewerLocation.trim().toLowerCase();
    }

    return true;
}

function buildFallbackSummary(candidate: MatchCandidate) {
    const preferenceSnippet = candidate.preferences?.trim();

    if (preferenceSnippet) {
        return `You both appear aligned on lifestyle and long-term expectations, and ${candidate.full_name} is specifically looking for ${preferenceSnippet.toLowerCase()}.`;
    }

    return `You both appear aligned around location and profile intent, and ${candidate.full_name}'s profile has enough signal for a semantic match even though the AI summary service is not fully configured yet.`;
}

function getEmbeddingStateContent(status: ViewerEmbeddingStatus) {
    if (status === 'delayed') {
        return {
            title: 'Embedding is taking longer than expected',
            subtitle:
                'Your profile was saved, but the semantic feed still cannot rank matches because the embedding is missing. The app will recheck automatically every few seconds, and you can save the profile again if this state keeps repeating.',
            buttonLabel: 'Check now',
        };
    }

    return {
        title: 'Embedding still processing',
        subtitle:
            'Your profile exists, but the semantic feed can only rank matches after the embedding is written. The app will keep rechecking automatically, or you can refresh manually.',
        buttonLabel: 'Refresh feed',
    };
}

function HomeFeedSkeleton() {
    return (
        <View style={styles.feedSkeletonWrap}>
            <View style={styles.feedSkeletonCardBack} />
            <View style={styles.feedSkeletonCardMid} />
            <View style={styles.feedSkeletonCardFront}>
                <View style={styles.feedSkeletonPhoto} />
                <View style={styles.feedSkeletonTitle} />
                <View style={styles.feedSkeletonLine} />
                <View style={[styles.feedSkeletonLine, styles.feedSkeletonLineShort]} />
                <View style={styles.feedSkeletonActionsRow}>
                    <View style={styles.feedSkeletonAction} />
                    <View style={styles.feedSkeletonAction} />
                    <View style={styles.feedSkeletonAction} />
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        backgroundColor: '#0a0a0c',
        flex: 1,
        minHeight: 0,
    },
    container: {
        alignSelf: 'center',
        flex: 1,
        maxWidth: MAX_CONTENT_WIDTH,
        minHeight: 0,
        width: '100%',
    },
    scrollContent: {
        flexGrow: 1,
        paddingBottom: 24,
        paddingHorizontal: 20,
        paddingTop: 16,
    },
    headerRow: {
        alignItems: 'flex-start',
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'space-between',
        marginBottom: 22,
    },
    headerRowStacked: {
        alignItems: 'stretch',
        flexDirection: 'column',
        gap: 14,
    },
    headerCopy: {
        flex: 1,
        gap: 6,
    },
    title: {
        color: '#d4a853',
        fontSize: 30,
        fontWeight: '800',
    },
    subtitle: {
        color: '#8e8a9e',
        fontSize: 15,
        lineHeight: 22,
    },
    warningText: {
        color: '#d4a853',
        fontSize: 13,
        lineHeight: 20,
        marginTop: 4,
    },
    searchCard: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderColor: 'rgba(255,255,255,0.08)',
        borderRadius: 22,
        borderWidth: 1,
        gap: 12,
        marginTop: 8,
        padding: 14,
    },
    searchInput: {
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 16,
        color: '#f0ece4',
        fontSize: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    filterChipsRow: {
        gap: 10,
        paddingRight: 4,
    },
    filterChip: {
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    filterChipActive: {
        backgroundColor: '#d4a853',
    },
    filterChipText: {
        color: '#8e8a9e',
        fontSize: 13,
        fontWeight: '700',
    },
    filterChipTextActive: {
        color: '#0a0a0c',
    },
    signOutButton: {
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    headerActions: {
        gap: 10,
    },
    headerActionsInline: {
        flexDirection: 'row',
        width: '100%',
    },
    headerActionButtonCompact: {
        flex: 1,
    },
    photosButton: {
        backgroundColor: 'rgba(212,168,83,0.12)',
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    photosButtonText: {
        color: '#d4a853',
        fontSize: 14,
        fontWeight: '700',
    },
    signOutText: {
        color: '#f0ece4',
        fontSize: 14,
        fontWeight: '700',
    },
    loadingState: {
        alignItems: 'center',
        flex: 1,
        gap: 12,
        justifyContent: 'center',
    },
    feedSkeletonWrap: {
        width: '100%',
        alignItems: 'center',
        paddingHorizontal: 8,
    },
    feedSkeletonCardBack: {
        position: 'absolute',
        top: 20,
        width: '88%',
        height: 420,
        borderRadius: 28,
        backgroundColor: 'rgba(255,255,255,0.02)',
    },
    feedSkeletonCardMid: {
        position: 'absolute',
        top: 10,
        width: '92%',
        height: 430,
        borderRadius: 28,
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    feedSkeletonCardFront: {
        width: '96%',
        height: 440,
        borderRadius: 28,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        padding: 16,
        gap: 12,
    },
    feedSkeletonPhoto: {
        height: 210,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.06)',
    },
    feedSkeletonTitle: {
        width: '52%',
        height: 20,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    feedSkeletonLine: {
        width: '90%',
        height: 14,
        borderRadius: 7,
        backgroundColor: 'rgba(255,255,255,0.06)',
    },
    feedSkeletonLineShort: {
        width: '74%',
    },
    feedSkeletonActionsRow: {
        marginTop: 'auto',
        flexDirection: 'row',
        gap: 8,
    },
    feedSkeletonAction: {
        flex: 1,
        height: 44,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.06)',
    },
    loadingText: {
        color: '#5a5770',
        fontSize: 15,
    },
    stateCard: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 28,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        elevation: 2,
        gap: 12,
        marginTop: 40,
        padding: 28,
        shadowColor: '#d4a853',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.06,
        shadowRadius: 24,
    },
    premiumPromoCard: {
        alignItems: 'center',
        backgroundColor: 'rgba(212,168,83,0.1)',
        borderColor: 'rgba(212,168,83,0.2)',
        borderWidth: 1,
        borderRadius: 22,
        flexDirection: 'row',
        gap: 12,
        marginBottom: 12,
        paddingHorizontal: 14,
        paddingVertical: 14,
    },
    premiumPromoCopy: {
        flex: 1,
        gap: 3,
    },
    premiumPromoEyebrow: {
        color: '#d4a853',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.7,
        textTransform: 'uppercase',
    },
    premiumPromoTitle: {
        color: '#f0ece4',
        fontSize: 15,
        fontWeight: '800',
    },
    premiumPromoBody: {
        color: '#8e8a9e',
        fontSize: 12,
        lineHeight: 18,
    },
    premiumPromoButton: {
        backgroundColor: 'rgba(212,168,83,0.2)',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    premiumPromoButtonText: {
        color: '#d4a853',
        fontSize: 11,
        fontWeight: '800',
    },
    premiumProfileTag: {
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(212,168,83,0.12)',
        borderColor: 'rgba(212,168,83,0.25)',
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    premiumProfileTagCompact: {
        marginTop: -2,
    },
    premiumProfileTagText: {
        color: '#d4a853',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    premiumProfileTagReason: {
        color: '#c8903e',
        fontSize: 11,
        fontWeight: '700',
    },
    stateTitle: {
        color: '#f0ece4',
        fontSize: 24,
        fontWeight: '800',
    },
    stateSubtitle: {
        color: '#8e8a9e',
        fontSize: 15,
        lineHeight: 22,
    },
    refreshButton: {
        alignSelf: 'flex-start',
        backgroundColor: '#d4a853',
        borderRadius: 999,
        paddingHorizontal: 18,
        paddingVertical: 12,
    },
    refreshButtonText: {
        color: '#0a0a0c',
        fontSize: 14,
        fontWeight: '700',
    },
    stackArea: {
        justifyContent: 'center',
        marginBottom: 18,
        // Height is set inline (viewport-relative) so the deck lives inside the
        // vertical ScrollView; the page scrolls when it doesn't fit.
        position: 'relative',
    },
    stackAreaCompact: {
        marginBottom: 14,
    },
    card: {
        backgroundColor: '#141318',
        borderRadius: 30,
        bottom: 0,
        left: 0,
        // Cards fill the flexed stack area instead of using a fixed height, and
        // clip gracefully (overflow hidden) on very short viewports.
        overflow: 'hidden',
        position: 'absolute',
        right: 0,
        top: 0,
    },
    thirdCard: {
        opacity: 0.35,
        transform: [{ scale: 0.92 }, { translateY: 30 }],
    },
    thirdCardCompact: {
        transform: [{ scale: 0.92 }, { translateY: 20 }],
    },
    nextCard: {
        opacity: 0.65,
    },
    nextCardCompact: {
        opacity: 0.65,
    },
    activeCard: {
        elevation: 8,
        shadowColor: '#d4a853',
        shadowOffset: { width: 0, height: 18 },
        shadowOpacity: 0.15,
        shadowRadius: 30,
    },
    cardPressable: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderColor: 'rgba(255,255,255,0.08)',
        borderRadius: 30,
        borderWidth: 1,
        flex: 1,
        gap: 14,
        padding: 24,
    },
    cardPressablePremium: {
        borderColor: 'rgba(212,168,83,0.35)',
        borderWidth: 2,
        backgroundColor: 'rgba(212,168,83,0.06)',
    },
    cardPressableCompact: {
        gap: 12,
        padding: 18,
    },
    cardPhoto: {
        borderRadius: 24,
        width: '100%',
    },
    cardPhotoExpanded: {
        height: 250,
    },
    cardPhotoCompact: {
        height: 170,
    },
    cardPhotoPlaceholder: {
        alignItems: 'center',
        backgroundColor: 'rgba(212,168,83,0.1)',
        borderRadius: 24,
        justifyContent: 'center',
        width: '100%',
    },
    cardPhotoInitial: {
        color: '#d4a853',
        fontSize: 54,
        fontWeight: '800',
    },
    cardPhotoHint: {
        color: '#c8903e',
        fontSize: 13,
        fontWeight: '700',
        marginTop: 6,
    },
    cardHeader: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    scorePill: {
        backgroundColor: '#d4a853',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    scoreText: {
        color: '#0a0a0c',
        fontSize: 12,
        fontWeight: '800',
    },
    locationText: {
        color: '#8e8a9e',
        fontSize: 13,
        fontWeight: '700',
    },
    cardName: {
        color: '#f0ece4',
        fontSize: 31,
        fontWeight: '800',
        marginTop: 4,
    },
    cardNameCompact: {
        fontSize: 26,
    },
    cardMeta: {
        color: '#8e8a9e',
        fontSize: 15,
        lineHeight: 22,
    },
    factRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 4,
    },
    factPill: {
        backgroundColor: 'rgba(212,168,83,0.1)',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    factText: {
        color: '#d4a853',
        fontSize: 12,
        fontWeight: '700',
    },
    cardBio: {
        color: '#a8a4b8',
        fontSize: 16,
        lineHeight: 24,
        marginTop: 6,
    },
    cardBioCompact: {
        fontSize: 15,
        lineHeight: 22,
    },
    tapHint: {
        color: '#d4a853',
        fontSize: 13,
        fontWeight: '700',
        marginTop: 'auto',
    },
    actionsRow: {
        flexDirection: 'row',
        gap: 10,
        justifyContent: 'space-between',
    },
    actionsRowCompact: {
        gap: 8,
    },
    actionButton: {
        alignItems: 'center',
        borderRadius: 18,
        flex: 1,
        paddingHorizontal: 12,
        paddingVertical: 14,
    },
    actionButtonCompact: {
        borderRadius: 16,
        paddingVertical: 12,
    },
    // The affirmative choice gets more width than the dismissive one.
    actionButtonEmphasis: {
        flex: 1.5,
    },
    actionButtonPressed: {
        opacity: 0.85,
    },
    actionButtonMuted: {
        backgroundColor: 'transparent',
        borderColor: 'rgba(255,255,255,0.12)',
        borderWidth: 1.5,
    },
    actionButtonAccent: {
        backgroundColor: 'rgba(212,168,83,0.15)',
    },
    actionButtonPrimary: {
        backgroundColor: '#d4a853',
    },
    actionButtonText: {
        fontSize: 13,
        fontWeight: '800',
    },
    actionButtonTextMuted: {
        color: '#8e8a9e',
    },
    actionButtonTextAccent: {
        color: '#d4a853',
    },
    actionButtonTextPrimary: {
        color: '#0a0a0c',
    },
    modalBackdrop: {
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        flex: 1,
        justifyContent: 'center',
        padding: 22,
    },
    modalCard: {
        backgroundColor: '#1a1920',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        borderRadius: 28,
        gap: 12,
        maxWidth: 420,
        padding: 24,
        width: '100%',
    },
    detailModalCard: {
        gap: 16,
        maxHeight: '92%',
        maxWidth: 460,
    },
    photoModalCard: {
        gap: 16,
        maxHeight: '92%',
        maxWidth: 460,
    },
    modalHeaderRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
    },
    modalHeaderCopy: {
        flex: 1,
        gap: 4,
    },
    modalEyebrow: {
        color: '#d4a853',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    modalTitle: {
        color: '#f0ece4',
        fontSize: 28,
        fontWeight: '800',
    },
    modalLoadingRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
    },
    modalBody: {
        color: '#a8a4b8',
        fontSize: 16,
        lineHeight: 25,
    },
    detailScrollContent: {
        gap: 16,
        paddingBottom: 4,
    },
    detailHeroPhoto: {
        borderRadius: 24,
        height: 320,
        width: '100%',
    },
    detailHeroPlaceholder: {
        alignItems: 'center',
        backgroundColor: 'rgba(212,168,83,0.1)',
        borderRadius: 24,
        gap: 8,
        height: 320,
        justifyContent: 'center',
        width: '100%',
    },
    detailHeroInitial: {
        color: '#d4a853',
        fontSize: 66,
        fontWeight: '800',
    },
    detailHeroHint: {
        color: '#c8903e',
        fontSize: 14,
        fontWeight: '700',
    },
    detailBadgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    detailPill: {
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    detailPillPrimary: {
        backgroundColor: '#d4a853',
    },
    detailPillNeutral: {
        backgroundColor: 'rgba(255,255,255,0.06)',
    },
    detailPillAccent: {
        backgroundColor: 'rgba(212,168,83,0.12)',
    },
    detailPillText: {
        fontSize: 12,
        fontWeight: '800',
    },
    detailPillTextPrimary: {
        color: '#0a0a0c',
    },
    detailPillTextNeutral: {
        color: '#8e8a9e',
    },
    detailPillTextAccent: {
        color: '#d4a853',
    },
    detailThumbnailRow: {
        gap: 10,
        paddingRight: 6,
    },
    detailThumbnailFrame: {
        borderColor: 'transparent',
        borderRadius: 16,
        borderWidth: 2,
        overflow: 'hidden',
    },
    detailThumbnailFrameActive: {
        borderColor: '#d4a853',
    },
    detailThumbnailImage: {
        height: 92,
        width: 72,
    },
    detailSection: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderColor: 'rgba(255,255,255,0.08)',
        borderRadius: 22,
        borderWidth: 1,
        gap: 12,
        padding: 16,
    },
    detailSectionTitle: {
        color: '#f0ece4',
        fontSize: 18,
        fontWeight: '800',
    },
    detailFactsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    detailFactCard: {
        backgroundColor: 'rgba(212,168,83,0.08)',
        borderRadius: 18,
        gap: 4,
        minWidth: '47%',
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    detailFactLabel: {
        color: '#c8903e',
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    detailFactValue: {
        color: '#f0ece4',
        fontSize: 14,
        fontWeight: '700',
        lineHeight: 20,
    },
    photoModalContent: {
        gap: 16,
        paddingBottom: 8,
    },
    photoModalScroll: {
        flexShrink: 1,
    },
    photoManagerHeader: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    photoManagerCount: {
        color: '#f0ece4',
        fontSize: 14,
        fontWeight: '700',
    },
    profilePhotoGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    profilePhotoTile: {
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 20,
        minHeight: 190,
        overflow: 'hidden',
        position: 'relative',
        width: '47%',
    },
    profilePhotoTileImage: {
        height: 190,
        width: '100%',
    },
    profilePhotoBadge: {
        backgroundColor: 'rgba(212,168,83,0.85)',
        borderRadius: 999,
        left: 10,
        paddingHorizontal: 10,
        paddingVertical: 6,
        position: 'absolute',
        top: 10,
    },
    profilePhotoBadgeText: {
        color: '#0a0a0c',
        fontSize: 12,
        fontWeight: '700',
    },
    profilePhotoRemoveButton: {
        backgroundColor: 'rgba(20, 19, 24, 0.92)',
        borderRadius: 999,
        bottom: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        position: 'absolute',
        right: 10,
    },
    profilePhotoRemoveButtonText: {
        color: '#ef4444',
        fontSize: 12,
        fontWeight: '800',
    },
    profilePhotoEmptyState: {
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 20,
        gap: 8,
        paddingHorizontal: 18,
        paddingVertical: 24,
    },
    profilePhotoEmptyTitle: {
        color: '#f0ece4',
        fontSize: 18,
        fontWeight: '800',
    },
    profilePhotoEmptyText: {
        color: '#8e8a9e',
        fontSize: 14,
        lineHeight: 21,
        textAlign: 'center',
    },
    photoManagerAddButton: {
        alignItems: 'center',
        backgroundColor: '#d4a853',
        borderRadius: 16,
        paddingHorizontal: 18,
        paddingVertical: 14,
    },
    photoManagerAddButtonText: {
        color: '#0a0a0c',
        fontSize: 14,
        fontWeight: '800',
    },
    photoManagerLimitText: {
        color: '#8e8a9e',
        fontSize: 13,
        fontWeight: '700',
        textAlign: 'center',
    },
    contactSectionCard: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderColor: 'rgba(255,255,255,0.08)',
        borderRadius: 20,
        borderWidth: 1,
        gap: 10,
        padding: 16,
    },
    contactSectionTitle: {
        color: '#f0ece4',
        fontSize: 17,
        fontWeight: '800',
    },
    contactSectionBody: {
        color: '#8e8a9e',
        fontSize: 14,
        lineHeight: 21,
    },
    contactInput: {
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 14,
        color: '#f0ece4',
        fontSize: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    contactSaveButton: {
        alignItems: 'center',
        backgroundColor: '#d4a853',
        borderRadius: 16,
        marginTop: 4,
        paddingHorizontal: 16,
        paddingVertical: 13,
    },
    contactSaveButtonDisabled: {
        opacity: 0.6,
    },
    contactSaveButtonText: {
        color: '#0a0a0c',
        fontSize: 14,
        fontWeight: '800',
    },
    contactSavedHint: {
        color: '#c8903e',
        fontSize: 13,
        fontWeight: '700',
        lineHeight: 19,
    },
    insightSection: {
        backgroundColor: 'rgba(212,168,83,0.08)',
        borderRadius: 18,
        gap: 10,
        marginTop: 4,
        padding: 14,
    },
    insightSectionTitle: {
        color: '#f0ece4',
        fontSize: 14,
        fontWeight: '800',
    },
    insightRow: {
        alignItems: 'flex-start',
        flexDirection: 'row',
        gap: 10,
    },
    insightDot: {
        backgroundColor: '#d4a853',
        borderRadius: 999,
        height: 8,
        marginTop: 8,
        width: 8,
    },
    insightDotMuted: {
        backgroundColor: '#5a5770',
        borderRadius: 999,
        height: 8,
        marginTop: 8,
        width: 8,
    },
    insightText: {
        color: '#a8a4b8',
        flex: 1,
        fontSize: 14,
        lineHeight: 21,
    },
    modalButton: {
        alignSelf: 'flex-end',
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: 16,
        marginTop: 4,
        paddingHorizontal: 18,
        paddingVertical: 12,
    },
    modalButtonText: {
        color: '#f0ece4',
        fontSize: 14,
        fontWeight: '700',
    },
    detailFooterRow: {
        flexDirection: 'row',
        gap: 10,
    },
    detailFooterSecondaryButton: {
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 16,
        flex: 1,
        paddingHorizontal: 18,
        paddingVertical: 14,
    },
    detailFooterSecondaryButtonText: {
        color: '#8e8a9e',
        fontSize: 14,
        fontWeight: '800',
    },
    detailFooterPrimaryButton: {
        alignItems: 'center',
        backgroundColor: '#d4a853',
        borderRadius: 16,
        flex: 1.2,
        paddingHorizontal: 18,
        paddingVertical: 14,
    },
    detailFooterPrimaryButtonText: {
        color: '#0a0a0c',
        fontSize: 14,
        fontWeight: '800',
    },
});
