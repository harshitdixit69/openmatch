import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '../components/BackButton';
import { RequestTrustDrawer } from '../components/RequestTrustDrawer';
import { ProfileReliabilitySummary } from '../lib/intentEscrow';
import { getRequestTrustSummary, generateRequestReasons, submitInterestRequest } from '../lib/intentEscrowApi';
import { MatchCandidate } from '../lib/matchmaking';
import { trackPremiumEvent } from '../lib/premiumAnalytics';
import { getDisplayFirstName, matchesPartnerGenderPreference, ProfileRecord, ProfileContactDetails } from '../lib/profile';
import { recordProfileView } from '../lib/profileViewsApi';
import { MAX_CONTENT_WIDTH, useResponsiveLayout } from '../lib/responsiveLayout';
import { blockUser, reportUser } from '../lib/chatApi';
import { supabase } from '../lib/supabase';
import { PartnerPreferences, cmToFeetInches, PREF_MARITAL_STATUS_LABELS } from '../lib/partnerPreferences';
import { fetchPartnerPreferences } from '../lib/partnerPreferencesApi';
import { fetchCurrentProfile, fetchCurrentProfileContactDetails } from '../lib/profileApi';

type MatchProfileScreenProps = {
    candidate: MatchCandidate;
    viewerProfile: ProfileRecord | null;
    compatibilitySummary: string | null;
    fitPoints: string[];
    frictionPoints: string[];
    summaryLoading: boolean;
    onClose: () => void;
    onPass: () => void;
    onHardReject?: () => void;
    onConnect: () => void;
    onUnlockWithPremium?: () => void;
    onOpenChat?: (otherUserId: string) => void;
};

export function MatchProfileScreen({
    candidate,
    viewerProfile,
    compatibilitySummary,
    fitPoints,
    frictionPoints,
    summaryLoading,
    onClose,
    onPass,
    onHardReject,
    onConnect,
    onUnlockWithPremium,
    onOpenChat,
}: MatchProfileScreenProps) {
    const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
    const isSelf = viewerProfile && candidate && viewerProfile.id === candidate.id;
    const [trustSummary, setTrustSummary] = useState<ProfileReliabilitySummary | null>(null);
    const [trustLoading, setTrustLoading] = useState(false);
    const [trustDrawerVisible, setTrustDrawerVisible] = useState(false);
    const [viewerPrefs, setViewerPrefs] = useState<PartnerPreferences | null>(null);
    const [candidateProfile, setCandidateProfile] = useState<ProfileRecord | null>(null);
    const [profileLoading, setProfileLoading] = useState(true);
    const [contactDetails, setContactDetails] = useState<ProfileContactDetails | null>(null);
    const [contactDetailsLoading, setContactDetailsLoading] = useState(true);
    const [relationshipStatus, setRelationshipStatus] = useState<'none' | 'sent' | 'received' | 'accepted' | 'loading'>('loading');
    const [interestRequest, setInterestRequest] = useState<any | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const { height } = useResponsiveLayout();

    useEffect(() => {
        if (!viewerProfile || !candidate) {
            setRelationshipStatus('none');
            return;
        }

        const viewerProfileId = viewerProfile.id;
        const candidateId = candidate.id;
        let active = true;

        async function fetchRelationship() {
            try {
                const { data: reqs, error: reqsErr } = await supabase
                    .from('interest_requests')
                    .select('*')
                    .or(`and(sender_id.eq.${viewerProfileId},receiver_id.eq.${candidateId}),and(sender_id.eq.${candidateId},receiver_id.eq.${viewerProfileId})`)
                    .order('created_at', { ascending: false });

                if (reqsErr) throw reqsErr;

                if (active) {
                    if (reqs && reqs.length > 0) {
                        const activeReq = reqs[0];
                        setInterestRequest(activeReq);
                        if (activeReq.status === 'accepted') {
                            setRelationshipStatus('accepted');
                        } else if (activeReq.status === 'sent') {
                            if (activeReq.sender_id === viewerProfileId) {
                                setRelationshipStatus('sent');
                            } else {
                                setRelationshipStatus('received');
                            }
                        } else {
                            setRelationshipStatus('none');
                        }
                        return;
                    }

                    const { data: matches, error: matchesErr } = await supabase
                        .from('matches')
                        .select('*')
                        .or(`and(user_1_id.eq.${viewerProfileId},user_2_id.eq.${candidateId}),and(user_1_id.eq.${candidateId},user_2_id.eq.${viewerProfileId})`);

                    if (matchesErr) throw matchesErr;

                    if (matches && matches.length > 0) {
                        setRelationshipStatus('accepted');
                    } else {
                        setRelationshipStatus('none');
                    }
                }
            } catch (err) {
                console.warn('Failed to load relationship status:', err);
                if (active) {
                    setRelationshipStatus('none');
                }
            }
        }

        void fetchRelationship();

        return () => {
            active = false;
        };
    }, [viewerProfile?.id, candidate?.id]);

    async function handleAcceptRequest() {
        if (!interestRequest) return;
        setActionLoading(true);
        try {
            const { error } = await supabase.functions.invoke('respond-interest-request', {
                body: { requestId: interestRequest.id, action: 'accept' }
            });
            if (error) throw error;
            setRelationshipStatus('accepted');
            Alert.alert('Request Accepted', 'You are now connected! Open chat to start talking.');
        } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to accept request.');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleDeclineRequest() {
        if (!interestRequest) return;
        setActionLoading(true);
        try {
            const { error } = await supabase.functions.invoke('respond-interest-request', {
                body: { requestId: interestRequest.id, action: 'decline' }
            });
            if (error) throw error;
            setRelationshipStatus('none');
            Alert.alert('Request Declined', 'Request declined successfully.');
        } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to decline request.');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleSuperInterest() {
        if (!viewerProfile || !candidate) return;

        const remaining = viewerProfile.super_interest_remaining ?? 0;
        if (remaining <= 0) {
            Alert.alert(
                'No Super Interests Remaining',
                'You do not have any Super Interests left. Upgrade your tier to get more!'
            );
            return;
        }

        setActionLoading(true);
        try {
            const reasonsResult = await generateRequestReasons(candidate.id, {
                candidate,
                viewerProfile,
            });

            const firstReason = reasonsResult.reasons?.[0];
            const selectedReasonId = firstReason?.id ?? 'fallback_reason';
            const personalizedReason = firstReason?.text ?? "I'm interested in connecting with you!";
            const requestQualityScore = reasonsResult.requestQualityScore ?? 60;

            const result = await submitInterestRequest({
                candidateProfileId: candidate.id,
                selectedReasonId,
                personalizedReason,
                mediaType: 'none',
                mediaUrl: null,
                voiceTranscript: null,
                requestQualityScore,
                isSuper: true,
            });

            viewerProfile.super_interest_remaining = remaining - 1;

            setRelationshipStatus('sent');
            Alert.alert('Super Interest Sent!', result.notice ?? 'Your Super Interest was successfully sent!');
        } catch (err: any) {
            Alert.alert('Send Failed', err.message || 'Failed to send Super Interest.');
        } finally {
            setActionLoading(false);
        }
    }

    // Cap the hero image so it never dominates short viewports while still
    // scaling with the content column width via `aspectRatio`.
    const heroMaxHeight = Math.min(420, Math.round(height * 0.46));

    // Load viewer partner preferences
    useEffect(() => {
        let active = true;
        async function loadPrefs() {
            try {
                const prefs = await fetchPartnerPreferences();
                if (active) {
                    setViewerPrefs(prefs);
                }
            } catch (err) {
                console.warn('Failed to load viewer partner preferences:', err);
            }
        }
        void loadPrefs();
        return () => {
            active = false;
        };
    }, []);

    // Load full candidate profile record
    useEffect(() => {
        setCandidateProfile(null);
        setProfileLoading(true);
        let active = true;
        async function loadCandidateProfile() {
            try {
                const profile = await fetchCurrentProfile(candidate.id);
                if (active) {
                    setCandidateProfile(profile);
                }
            } catch (err) {
                console.warn('Failed to load full candidate profile:', err);
            } finally {
                if (active) {
                    setProfileLoading(false);
                }
            }
        }
        void loadCandidateProfile();
        return () => {
            active = false;
        };
    }, [candidate.id]);

    // Load candidate contact details
    useEffect(() => {
        setContactDetails(null);
        setContactDetailsLoading(true);
        let active = true;
        async function loadContactDetails() {
            try {
                const details = await fetchCurrentProfileContactDetails(candidate.id);
                if (active) {
                    setContactDetails(details);
                }
            } catch (err) {
                console.warn('Failed to load candidate contact details:', err);
            } finally {
                if (active) {
                    setContactDetailsLoading(false);
                }
            }
        }
        void loadContactDetails();
        return () => {
            active = false;
        };
    }, [candidate.id]);

    useEffect(() => {
        setSelectedPhotoIndex(0);
    }, [candidate.id]);

    // Record that the current user viewed this profile (fire-and-forget, deduped per day).
    useEffect(() => {
        void recordProfileView(candidate.id);
    }, [candidate.id]);

    useEffect(() => {
        let cancelled = false;

        async function loadTrustSummary() {
            setTrustLoading(true);

            try {
                const nextSummary = await getRequestTrustSummary(candidate.id, {
                    managedBy: candidate.profile_owner ?? null,
                });

                if (!cancelled) {
                    setTrustSummary(nextSummary);
                }
            } catch (error) {
                if (!cancelled) {
                    console.warn('Could not load candidate trust summary.', error);
                    setTrustSummary(null);
                }
            } finally {
                if (!cancelled) {
                    setTrustLoading(false);
                }
            }
        }

        void loadTrustSummary();

        return () => {
            cancelled = true;
        };
    }, [candidate.id, candidate.profile_owner]);

    const photoUrls = candidate.photo_urls;
    const activePhotoUrl = photoUrls[selectedPhotoIndex] ?? photoUrls[0] ?? null;
    const firstName = getDisplayFirstName(candidate.full_name);
    const fitChecklist = buildProfileFitChecklist(candidate, viewerProfile);
    const matchedSignalCount = fitChecklist.filter((item) => item.matched).length;

    function handleUnlockWithPremium() {
        void trackPremiumEvent({
            eventName: 'premium_promo_cta_tap',
            surface: 'home_feed',
            context: 'match_profile_contact_unlock',
            metadata: { candidateId: candidate.id },
        });

        if (onUnlockWithPremium) {
            onUnlockWithPremium();
            return;
        }

        Alert.alert(
            'Premium coming soon',
            'Instant contact unlock will be part of OpenMatch Premium. For now you can still unlock for free by mutual agreement, where both people confirm and pay the same one-time amount.',
        );
    }

    async function handleBlock() {
        if (Platform.OS === 'web') {
            const confirm = window.confirm(`Are you sure you want to block ${candidate.full_name}? You will not see their profile in your feed again.`);
            if (confirm) {
                try {
                    await blockUser(candidate.id);
                    alert(`${candidate.full_name} has been blocked.`);
                    // Also hard-reject in matches table so they never reappear in the feed
                    onHardReject?.();
                    onPass();
                } catch (err) {
                    console.error('Failed to block profile:', err);
                    alert('Could not block profile.');
                }
            }
            return;
        }

        Alert.alert(
            'Block Profile',
            `Are you sure you want to block ${candidate.full_name}? You will not see their profile in your feed again.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Block',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await blockUser(candidate.id);
                            Alert.alert('Blocked', `${candidate.full_name} has been blocked.`);
                            // Also hard-reject in matches table so they never reappear in the feed
                            onHardReject?.();
                            onPass();
                        } catch (err) {
                            console.error('Failed to block profile:', err);
                            Alert.alert('Error', 'Could not block profile.');
                        }
                    }
                }
            ]
        );
    }

    function handleReport() {
        if (Platform.OS === 'web') {
            const reason = window.prompt(
                `Report ${candidate.full_name}:\nType a reason (e.g. "Inappropriate Photos", "Fake Profile", "Harassment", "Other"):`
            );
            if (reason) {
                void submitReport(reason.trim());
            }
            return;
        }

        Alert.alert(
            'Report Profile',
            `Why are you reporting ${candidate.full_name}?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Inappropriate Photos',
                    onPress: () => submitReport('Inappropriate Photos'),
                },
                {
                    text: 'Fake Profile',
                    onPress: () => submitReport('Fake Profile'),
                },
                {
                    text: 'Harassment',
                    onPress: () => submitReport('Harassment'),
                },
                {
                    text: 'Other',
                    onPress: () => submitReport('Other (General)'),
                }
            ]
        );
    }

    async function submitReport(reason: string) {
        try {
            await reportUser(candidate.id, reason, 'Reported via profile screen.');
            if (Platform.OS === 'web') {
                alert('Report Submitted. Thank you. Our moderation team will review this profile.');
            } else {
                Alert.alert('Report Submitted', 'Thank you. Our moderation team will review this profile.');
            }
        } catch (err) {
            console.error('Failed to submit report:', err);
            if (Platform.OS === 'web') {
                alert('Could not submit report.');
            } else {
                Alert.alert('Error', 'Could not submit report.');
            }
        }
    }

    interface ChecklistItem {
        label: string;
        value: string;
        preferenceLabel: string;
        isMatched: boolean;
    }

    const getChecklistItems = (): ChecklistItem[] => {
        if (!viewerPrefs || !candidateProfile) return [];
        
        const items: ChecklistItem[] = [];
        
        // 1. Age
        const age = formatAge(candidateProfile.dob);
        if (age !== null) {
            const ageMin = viewerPrefs.pref_age_min ?? 18;
            const ageMax = viewerPrefs.pref_age_max ?? 99;
            items.push({
                label: 'Age',
                value: `${age} years`,
                preferenceLabel: `${ageMin}-${ageMax} years`,
                isMatched: age >= ageMin && age <= ageMax,
            });
        }
        
        // 2. Height
        if (candidateProfile.height_cm) {
            const heightMin = viewerPrefs.pref_height_min;
            const heightMax = viewerPrefs.pref_height_max;
            const minLabel = heightMin ? `${heightMin}cm` : 'Any';
            const maxLabel = heightMax ? `${heightMax}cm` : 'Any';
            const matchesMin = !heightMin || candidateProfile.height_cm >= heightMin;
            const matchesMax = !heightMax || candidateProfile.height_cm <= heightMax;
            items.push({
                label: 'Height',
                value: `${candidateProfile.height_cm}cm (${cmToFeetInches(candidateProfile.height_cm)})`,
                preferenceLabel: heightMin || heightMax ? `${minLabel}-${maxLabel}` : 'Any',
                isMatched: matchesMin && matchesMax,
            });
        }
        
        // 3. Religion
        const prefReligion = viewerPrefs.pref_religion ?? 'Any';
        items.push({
            label: 'Religion',
            value: candidateProfile.religion ?? 'Not specified',
            preferenceLabel: prefReligion,
            isMatched: candidateProfile.religion ? matchesReligion(candidateProfile.religion, prefReligion) : prefReligion === 'Any',
        });
        
        // 4. Marital Status
        const prefMarital = viewerPrefs.pref_marital_status ?? [];
        const normalizedCandidateStatus = candidateProfile.marital_status ? normalizeMaritalStatus(candidateProfile.marital_status) : null;
        const maritalMatch = prefMarital.length === 0 || (normalizedCandidateStatus ? prefMarital.map(normalizeMaritalStatus).includes(normalizedCandidateStatus) : false);
        const prefMaritalLabel = prefMarital.length === 0 ? 'Any' : prefMarital.map(s => (PREF_MARITAL_STATUS_LABELS as any)[s] || s).join(', ');
        const candidateMaritalLabel = candidateProfile.marital_status ? ((PREF_MARITAL_STATUS_LABELS as any)[candidateProfile.marital_status] || candidateProfile.marital_status) : 'Not specified';
        items.push({
            label: 'Marital Status',
            value: candidateMaritalLabel,
            preferenceLabel: prefMaritalLabel,
            isMatched: maritalMatch,
        });
        
        // 5. Diet
        const prefDiet = viewerPrefs.pref_diet ?? 'Any';
        items.push({
            label: 'Diet',
            value: candidateProfile.diet ?? 'Not specified',
            preferenceLabel: prefDiet,
            isMatched: candidateProfile.diet ? matchesDiet(candidateProfile.diet, prefDiet) : prefDiet === 'Any',
        });
        
        // 6. Mother Tongue
        const prefLang = viewerPrefs.pref_mother_tongue;
        items.push({
            label: 'Mother Tongue',
            value: candidateProfile.mother_tongue ?? 'Not specified',
            preferenceLabel: prefLang ?? 'Any',
            isMatched: !prefLang || (candidateProfile.mother_tongue ? candidateProfile.mother_tongue.toLowerCase() === prefLang.toLowerCase() : false),
        });

        return items;
    };

    const getCommonIntersections = (): string[] => {
        if (!viewerProfile || !candidateProfile) return [];
        
        const intersections: string[] = [];
        
        // Diet
        if (candidateProfile.diet && viewerProfile.diet && getDietCategory(candidateProfile.diet) === getDietCategory(viewerProfile.diet)) {
            intersections.push(`🥗 Shared Diet: Both prefer ${candidateProfile.diet}`);
        }
        
        // Religion
        if (candidateProfile.religion && viewerProfile.religion && isSameReligion(candidateProfile.religion, viewerProfile.religion)) {
            intersections.push(`🤝 Shared Religion: Both practice ${candidateProfile.religion}`);
        }
        
        // Mother Tongue
        if (candidateProfile.mother_tongue && viewerProfile.mother_tongue && candidateProfile.mother_tongue.toLowerCase() === viewerProfile.mother_tongue.toLowerCase()) {
            intersections.push(`🗣️ Shared Mother Tongue: Both speak ${candidateProfile.mother_tongue}`);
        }
        
        // Education
        if (candidateProfile.education && viewerProfile.education && candidateProfile.education.toLowerCase() === viewerProfile.education.toLowerCase()) {
            intersections.push(`🎓 Shared Education: Both have ${candidateProfile.education} background`);
        }
        
        // Location
        if (candidateProfile.location && viewerProfile.location && isSameLocation(candidateProfile.location, viewerProfile.location)) {
            intersections.push(`📍 Location: Both reside in ${candidateProfile.location}`);
        }

        return intersections;
    };

    const checklistItems = getChecklistItems();
    const matchedCount = checklistItems.filter(item => item.isMatched).length;
    const totalCount = checklistItems.length;
    const commonGround = getCommonIntersections();

    if (profileLoading) {
        return (
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.notFoundContainer}>
                    <ActivityIndicator size="large" color="#11313c" />
                    <Text style={[styles.notFoundSubtitle, { marginTop: 12 }]}>Loading profile...</Text>
                </View>
            </SafeAreaView>
        );
    }

    if (!candidateProfile) {
        return (
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.notFoundContainer}>
                    <Text style={styles.notFoundEmoji}>🚫</Text>
                    <Text style={styles.notFoundTitle}>Profile Unavailable</Text>
                    <Text style={styles.notFoundSubtitle}>
                        This profile is no longer available or does not exist.
                    </Text>
                    <Pressable style={styles.notFoundButton} onPress={onClose}>
                        <Text style={styles.notFoundButtonText}>Go Back</Text>
                    </Pressable>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
                <View style={styles.headerRow}>
                    <BackButton onPress={onClose} />

                    <View style={styles.headerCopy}>
                        <Text style={styles.eyebrow}>Full Profile</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={styles.title}>{candidate.full_name}</Text>
                            {candidate.verification_status === 'verified' ? (
                                <Text style={{ fontSize: 16, marginLeft: 6, color: '#1a7a5e' }}>✅</Text>
                            ) : null}
                            {candidate.subscription_tier && candidate.subscription_tier !== 'free' ? (
                                <Text style={{ fontSize: 16, marginLeft: 6, color: '#c8a261' }}>👑</Text>
                            ) : null}
                        </View>
                        <Text style={styles.subtitle}>Review photos, profile details, family context, and your AI compatibility view.</Text>
                    </View>
                </View>

                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    {activePhotoUrl ? (
                        <Image source={{ uri: activePhotoUrl }} style={[styles.heroPhoto, { maxHeight: heroMaxHeight }, candidate.subscription_tier && candidate.subscription_tier !== 'free' ? { borderColor: '#c8a261', borderWidth: 3.5 } : null]} />
                    ) : (
                        <View style={[styles.heroPlaceholder, { maxHeight: heroMaxHeight }, candidate.subscription_tier && candidate.subscription_tier !== 'free' ? { borderColor: '#c8a261', borderWidth: 3.5, backgroundColor: '#fffdf6' } : null]}>
                            <Text style={styles.heroInitial}>{firstName.slice(0, 1).toUpperCase() || '?'}</Text>
                            <Text style={styles.heroHint}>No photo album yet</Text>
                        </View>
                    )}

                    <View style={styles.badgeRow}>
                        <Pill label={`${formatSimilarity(candidate.similarity)} AI fit`} tone="primary" />
                        <Pill label={candidate.photo_urls.length > 0 ? `${candidate.photo_urls.length} photos` : 'Photo pending'} tone="neutral" />
                        <Pill label={candidate.preferences ? 'Preferences ready' : 'Profile growing'} tone="accent" />
                    </View>

                    <SectionCard title="Photo album">
                        {photoUrls.length > 0 ? (
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
                                {photoUrls.map((photoUrl, index) => (
                                    <Pressable
                                        key={`${photoUrl}-${index}`}
                                        style={[styles.photoThumbFrame, selectedPhotoIndex === index ? styles.photoThumbFrameActive : null]}
                                        onPress={() => setSelectedPhotoIndex(index)}
                                    >
                                        <Image source={{ uri: photoUrl }} style={styles.photoThumb} />
                                    </Pressable>
                                ))}
                            </ScrollView>
                        ) : (
                            <Text style={styles.sectionBody}>This profile does not have an album yet, so only the rest of the profile details are available.</Text>
                        )}
                    </SectionCard>

                    <SectionCard title="About">
                        <Text style={styles.sectionBody}>{candidate.bio ?? 'An about summary has not been added yet.'}</Text>
                    </SectionCard>

                    <SectionCard title="Basic details">
                        <View style={styles.factGrid}>
                            <FactCard label="Age" value={String(formatAge(candidate.dob) ?? 'Not added')} />
                            <FactCard label="Height" value={candidate.height_cm ? `${candidate.height_cm} cm` : 'Not added'} />
                            <FactCard label="Location" value={candidate.location} />
                            <FactCard label="Gender" value={candidate.gender} />
                            <FactCard label="Looking for" value={candidate.partner_gender_preference ?? 'Everyone'} />
                            <FactCard label="Managed by" value={candidate.profile_owner ?? 'self'} />
                        </View>
                    </SectionCard>

                    <SectionCard title={`Match checklist ${matchedSignalCount}/${fitChecklist.length}`}>
                        <Text style={styles.sectionBody}>
                            This is a structured fit view based on the visible profile data you both have completed so far.
                        </Text>

                        <View style={styles.checklistRows}>
                            {fitChecklist.map((item) => (
                                <ChecklistRow key={item.label} label={item.label} matched={item.matched} />
                            ))}
                        </View>
                    </SectionCard>

                    <SectionCard title="Partner preferences">
                        <Text style={styles.sectionBody}>
                            {candidate.preferences ?? 'No explicit partner preferences have been added yet.'}
                        </Text>
                    </SectionCard>

                    {viewerPrefs && checklistItems.length > 0 ? (
                        <SectionCard title={`Preference Match (${matchedCount}/${totalCount})`}>
                            <View style={styles.checklistRows}>
                                {checklistItems.map((item, idx) => (
                                    <View key={`${item.label}-${idx}`} style={styles.preferenceRow}>
                                        <View style={styles.preferenceMain}>
                                            <View style={[styles.checklistIndicator, item.isMatched ? styles.checklistIndicatorMatched : styles.checklistIndicatorOpen]}>
                                                <Text style={[styles.checklistIndicatorText, item.isMatched ? styles.checklistIndicatorTextMatched : styles.checklistIndicatorTextOpen]}>
                                                    {item.isMatched ? '✓' : '✗'}
                                                </Text>
                                            </View>
                                            <Text style={styles.preferenceLabel}>{item.label}: </Text>
                                            <Text style={styles.preferenceValue}>{item.value}</Text>
                                        </View>
                                        <Text style={styles.preferencePref}>Stated preference: {item.preferenceLabel}</Text>
                                    </View>
                                ))}
                            </View>
                        </SectionCard>
                    ) : null}

                    <View style={styles.twoColumnRow}>
                        <SectionCard title="Family" compact>
                            <Text style={styles.sectionBody}>
                                {buildFamilySectionCopy(candidate)}
                            </Text>
                        </SectionCard>

                        <SectionCard title="Career & lifestyle" compact>
                            <Text style={styles.sectionBody}>
                                {buildCareerLifestyleCopy(candidate)}
                            </Text>
                        </SectionCard>
                    </View>

                    <SectionCard title="Compatibility snapshot">
                        {summaryLoading ? (
                            <View style={styles.loadingRow}>
                                <ActivityIndicator size="small" color="#123340" />
                                <Text style={styles.sectionBody}>Generating summary...</Text>
                            </View>
                        ) : (
                            <Text style={styles.sectionBody}>{compatibilitySummary ?? 'No AI summary is available yet.'}</Text>
                        )}
                    </SectionCard>

                    {commonGround.length > 0 ? (
                        <SectionCard title="Common Ground (Intersections)">
                            <View style={styles.checklistRows}>
                                {commonGround.map((item, idx) => (
                                    <View key={`cg-${idx}`} style={styles.insightRow}>
                                        <View style={[styles.insightDot, styles.insightDotFit]} />
                                        <Text style={styles.insightText}>{item}</Text>
                                    </View>
                                ))}
                            </View>
                        </SectionCard>
                    ) : null}

                    {fitPoints.length > 0 ? (
                        <SectionCard title="Common between both of you">
                            {fitPoints.map((point) => (
                                <InsightRow key={point} point={point} tone="fit" />
                            ))}
                        </SectionCard>
                    ) : null}

                    {frictionPoints.length > 0 ? (
                        <SectionCard title="Discuss early">
                            {frictionPoints.map((point) => (
                                <InsightRow key={point} point={point} tone="friction" />
                            ))}
                        </SectionCard>
                    ) : null}

                    {contactDetailsLoading ? (
                        <View style={[styles.contactCard, { justifyContent: 'center', alignItems: 'center', minHeight: 120 }]}>
                            <ActivityIndicator size="small" color="#14313a" />
                        </View>
                    ) : contactDetails ? (
                        <UnlockedContactCard firstName={firstName} contactDetails={contactDetails} />
                    ) : (
                        <MaskedContactCard firstName={firstName} onUnlock={onConnect} onUnlockWithPremium={handleUnlockWithPremium} />
                    )}

                    <View style={styles.trustStripCard}>
                        <View style={styles.trustStripHeader}>
                            <View style={styles.trustStripCopy}>
                                <Text style={styles.trustStripEyebrow}>Trust & response</Text>
                                <Text style={styles.trustStripTitle}>See how this profile usually follows through</Text>
                            </View>

                            <Pressable style={styles.trustStripButton} onPress={() => setTrustDrawerVisible(true)}>
                                <Text style={styles.trustStripButtonText}>View trust</Text>
                            </Pressable>
                        </View>

                        {trustLoading ? (
                            <View style={styles.trustStripLoadingRow}>
                                <ActivityIndicator size="small" color="#123340" />
                                <Text style={styles.sectionBody}>Loading response history...</Text>
                            </View>
                        ) : trustSummary ? (
                            <View style={styles.trustPillRow}>
                                <Pill label={formatManagedByLabel(trustSummary.managedBy)} tone="neutral" />
                                <Pill label={`Reliability ${trustSummary.responseReliabilityScore}/100`} tone="primary" />
                                <Pill label={`Ghost risk ${trustSummary.ghostRiskScore}/100`} tone="accent" />
                            </View>
                        ) : (
                            <Text style={styles.sectionBody}>
                                Trust details are still being prepared for this profile.
                            </Text>
                        )}
                    </View>

                    {!isSelf && (
                        <View style={styles.blockReportRow}>
                            <Pressable style={styles.secondaryActionButton} onPress={() => handleReport()}>
                                <Text style={styles.secondaryActionText}>Report Profile</Text>
                            </Pressable>
                            <View style={styles.divider} />
                            <Pressable style={styles.secondaryActionButton} onPress={() => handleBlock()}>
                                <Text style={styles.secondaryActionText}>Block Profile</Text>
                            </Pressable>
                        </View>
                    )}
                </ScrollView>

                <View style={styles.footerRow}>
                    {isSelf ? (
                        <Pressable style={[styles.passButton, { flex: 1 }]} onPress={onClose}>
                            <Text style={styles.passButtonText}>Close</Text>
                        </Pressable>
                    ) : relationshipStatus === 'loading' ? (
                        <ActivityIndicator size="small" color="#123340" style={{ flex: 1 }} />
                    ) : relationshipStatus === 'none' ? (
                        <>
                            <Pressable style={styles.passButton} onPress={onPass} disabled={actionLoading}>
                                <Text style={styles.passButtonText}>Pass</Text>
                            </Pressable>
                            {viewerProfile?.subscription_tier && viewerProfile.subscription_tier !== 'free' && (
                                <Pressable 
                                    style={[styles.connectButton, { backgroundColor: '#c8a261', flex: 1.8 }, actionLoading && { opacity: 0.7 }]} 
                                    onPress={handleSuperInterest}
                                    disabled={actionLoading}
                                >
                                    <Text style={styles.connectButtonText}>✨ Super Interest</Text>
                                </Pressable>
                            )}
                            <Pressable style={styles.connectButton} onPress={onConnect} disabled={actionLoading}>
                                <Text style={styles.connectButtonText}>Connect now</Text>
                            </Pressable>
                        </>
                    ) : relationshipStatus === 'sent' ? (
                        <>
                            <Pressable style={styles.passButton} onPress={onPass}>
                                <Text style={styles.passButtonText}>Close</Text>
                            </Pressable>
                            <Pressable style={[styles.connectButton, { backgroundColor: '#d1dbde' }]} disabled={true}>
                                <Text style={[styles.connectButtonText, { color: '#68848c' }]}>Request Pending</Text>
                            </Pressable>
                        </>
                    ) : relationshipStatus === 'received' ? (
                        <>
                            <Pressable 
                                style={[styles.passButton, actionLoading && { opacity: 0.5 }]} 
                                onPress={handleDeclineRequest}
                                disabled={actionLoading}
                            >
                                <Text style={[styles.passButtonText, { color: '#ba3c1c' }]}>Decline</Text>
                            </Pressable>
                            <Pressable 
                                style={[styles.connectButton, { backgroundColor: '#1a7a5e' }, actionLoading && { opacity: 0.5 }]} 
                                onPress={handleAcceptRequest}
                                disabled={actionLoading}
                            >
                                <Text style={styles.connectButtonText}>Accept</Text>
                            </Pressable>
                        </>
                    ) : (
                        <>
                            <Pressable 
                                style={styles.passButton} 
                                onPress={() => {
                                    onClose();
                                    onOpenChat?.(candidate.id);
                                }}
                            >
                                <Text style={styles.passButtonText}>Open Chat</Text>
                            </Pressable>
                            {contactDetails ? (
                                <Pressable style={[styles.connectButton, { backgroundColor: '#d1dbde' }]} disabled={true}>
                                    <Text style={[styles.connectButtonText, { color: '#68848c' }]}>Unlocked</Text>
                                </Pressable>
                            ) : (
                                <Pressable style={styles.connectButton} onPress={onConnect}>
                                    <Text style={styles.connectButtonText}>Unlock Contact</Text>
                                </Pressable>
                            )}
                        </>
                    )}
                </View>

                <RequestTrustDrawer
                    visible={trustDrawerVisible}
                    loading={trustLoading}
                    summary={trustSummary}
                    subjectName={candidate.full_name}
                    onClose={() => setTrustDrawerVisible(false)}
                />
            </View>
        </SafeAreaView>
    );
}

function SectionCard({ title, children, compact = false }: { title: string; children: React.ReactNode; compact?: boolean }) {
    return (
        <View style={[styles.sectionCard, compact ? styles.sectionCardCompact : null]}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {children}
        </View>
    );
}

function FactCard({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.factCard}>
            <Text style={styles.factLabel}>{label}</Text>
            <Text style={styles.factValue}>{value}</Text>
        </View>
    );
}

function Pill({ label, tone }: { label: string; tone: 'primary' | 'neutral' | 'accent' }) {
    return (
        <View style={[styles.pill, tone === 'primary' ? styles.pillPrimary : tone === 'accent' ? styles.pillAccent : styles.pillNeutral]}>
            <Text style={[styles.pillText, tone === 'primary' ? styles.pillTextPrimary : tone === 'accent' ? styles.pillTextAccent : styles.pillTextNeutral]}>{label}</Text>
        </View>
    );
}

function InsightRow({ point, tone }: { point: string; tone: 'fit' | 'friction' }) {
    return (
        <View style={styles.insightRow}>
            <View style={[styles.insightDot, tone === 'fit' ? styles.insightDotFit : styles.insightDotFriction]} />
            <Text style={styles.insightText}>{point}</Text>
        </View>
    );
}

function ChecklistRow({ label, matched }: { label: string; matched: boolean }) {
    return (
        <View style={styles.checklistRow}>
            <View style={[styles.checklistIndicator, matched ? styles.checklistIndicatorMatched : styles.checklistIndicatorOpen]}>
                <Text style={[styles.checklistIndicatorText, matched ? styles.checklistIndicatorTextMatched : styles.checklistIndicatorTextOpen]}>
                    {matched ? '✓' : '•'}
                </Text>
            </View>
            <Text style={styles.checklistLabel}>{label}</Text>
        </View>
    );
}

function MaskedContactCard({
    firstName,
    onUnlock,
    onUnlockWithPremium,
}: {
    firstName: string;
    onUnlock: () => void;
    onUnlockWithPremium: () => void;
}) {
    return (
        <View style={styles.contactCard}>
            <View style={styles.contactCardHeader}>
                <View style={styles.contactLockBadge}>
                    <Text style={styles.contactLockGlyph}>🔒</Text>
                </View>

                <View style={styles.contactHeaderCopy}>
                    <Text style={styles.contactEyebrow}>Guarded under AI Escrow</Text>
                    <Text style={styles.contactTitle}>Contact details are locked</Text>
                </View>
            </View>

            <View style={styles.contactRows}>
                <MaskedContactRow label="Phone" masked="+91 ••••• •••••" />
                <MaskedContactRow label="WhatsApp" masked="••••• •••••" />
            </View>

            <Text style={styles.contactBody}>
                {`${firstName}'s number stays hidden until you both accept contact exchange and each complete the same one-time unlock payment.`}
            </Text>

            <Pressable style={styles.contactUnlockButton} onPress={onUnlock}>
                <Text style={styles.contactUnlockButtonText}>Unlock contact</Text>
            </Pressable>

            <View style={styles.contactOrRow}>
                <View style={styles.contactOrLine} />
                <Text style={styles.contactOrText}>or</Text>
                <View style={styles.contactOrLine} />
            </View>

            <Pressable style={styles.contactPremiumButton} onPress={onUnlockWithPremium}>
                <Text style={styles.contactPremiumGlyph}>✨</Text>
                <Text style={styles.contactPremiumButtonText}>Unlock instantly with Premium</Text>
            </Pressable>

            <Text style={styles.contactPremiumHint}>
                Premium members skip the mutual-pay step. Free mutual unlock always stays available.
            </Text>
        </View>
    );
}

function MaskedContactRow({ label, masked }: { label: string; masked: string }) {
    return (
        <View style={styles.contactRow}>
            <View style={styles.contactRowLeft}>
                <Text style={styles.contactRowLabel}>{label}</Text>
                <Text style={styles.contactRowValue}>{masked}</Text>
            </View>

            <View style={styles.contactRowLockChip}>
                <Text style={styles.contactRowLockChipText}>Locked</Text>
            </View>
        </View>
    );
}

function RevealedContactRow({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.contactRow}>
            <View style={styles.contactRowLeft}>
                <Text style={styles.contactRowLabel}>{label}</Text>
                <Text style={styles.unlockedRowValue}>{value}</Text>
            </View>

            <View style={styles.unlockedRowChip}>
                <Text style={styles.unlockedRowChipText}>Unlocked</Text>
            </View>
        </View>
    );
}

function UnlockedContactCard({
    firstName,
    contactDetails,
}: {
    firstName: string;
    contactDetails: ProfileContactDetails;
}) {
    return (
        <View style={styles.unlockedContactCard}>
            <View style={styles.contactCardHeader}>
                <View style={styles.unlockedBadge}>
                    <Text style={styles.contactLockGlyph}>🔓</Text>
                </View>

                <View style={styles.contactHeaderCopy}>
                    <Text style={styles.unlockedEyebrow}>Mutual Unlock Complete</Text>
                    <Text style={styles.contactTitle}>{firstName}'s contact details</Text>
                </View>
            </View>

            <View style={styles.contactRows}>
                {contactDetails.phone_number ? (
                    <RevealedContactRow label="Phone" value={contactDetails.phone_number} />
                ) : null}
                {contactDetails.whatsapp_number ? (
                    <RevealedContactRow label="WhatsApp" value={contactDetails.whatsapp_number} />
                ) : null}
                {!contactDetails.phone_number && !contactDetails.whatsapp_number ? (
                    <Text style={styles.contactBody}>
                        {firstName} hasn't added contact details yet.
                    </Text>
                ) : null}
            </View>

            <Text style={styles.unlockedFooter}>
                Both of you completed the micro-transaction. Contact info is now visible to both sides.
            </Text>
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

function normalizeMaritalStatus(status: string): string {
    return status.toLowerCase().trim().replace(/[\s_-]+/g, '_');
}

function isSameReligion(rel1: string, rel2: string): boolean {
    const r1 = rel1.toLowerCase().trim();
    const r2 = rel2.toLowerCase().trim();
    if (r1 === r2) return true;
    
    const getRoot = (r: string) => {
        if (r.includes('hindu') || r === 'sanatan') return 'hindu';
        if (r.includes('muslim') || r === 'islam' || r === 'shia' || r === 'sunni') return 'muslim';
        if (r.includes('christian') || r === 'catholic' || r === 'protestant' || r === 'orthodox') return 'christian';
        if (r.includes('sikh') || r === 'khalsa') return 'sikh';
        if (r.includes('jain') || r === 'shwetambar' || r === 'digambar') return 'jain';
        if (r.includes('buddhist') || r === 'buddhism') return 'buddhist';
        if (r.includes('parsi') || r === 'zoroastrian') return 'parsi';
        if (r.includes('jew') || r === 'hebrew') return 'jewish';
        return r;
    };
    
    return getRoot(r1) === getRoot(r2);
}

function matchesReligion(candidateRel: string, prefRel: string): boolean {
    if (prefRel === 'Any') return true;
    return isSameReligion(candidateRel, prefRel);
}

function getDietCategory(diet: string): string {
    const d = diet.toLowerCase().trim();
    if (d === 'veg' || d.includes('vegetarian') || d === 'eggetarian') return 'vegetarian';
    if (d === 'non-veg' || d.includes('non-vegetarian') || d.includes('non veg') || d.includes('meat')) return 'non-vegetarian';
    if (d === 'vegan') return 'vegan';
    if (d === 'jain') return 'jain';
    return d;
}

function matchesDiet(candidateDiet: string, prefDiet: string): boolean {
    if (prefDiet === 'Any') return true;
    return getDietCategory(candidateDiet) === getDietCategory(prefDiet);
}

function isSameLocation(loc1: string, loc2: string): boolean {
    const l1 = loc1.toLowerCase().trim();
    const l2 = loc2.toLowerCase().trim();
    if (l1 === l2) return true;

    const getCityName = (l: string) => {
        if (l.includes('bangalore') || l.includes('bengaluru')) return 'bangalore';
        if (l.includes('mumbai') || l.includes('bombay')) return 'mumbai';
        if (l.includes('delhi') || l.includes('ncr')) return 'delhi';
        if (l.includes('calcutta') || l.includes('kolkata')) return 'kolkata';
        if (l.includes('madras') || l.includes('chennai')) return 'chennai';
        return l.split(',')[0].trim();
    };

    const city1 = getCityName(l1);
    const city2 = getCityName(l2);
    return city1 === city2 || l1.includes(city2) || l2.includes(city1);
}

function buildFamilySectionCopy(candidate: MatchCandidate) {
    if (candidate.profile_owner && candidate.profile_owner !== 'self') {
        return `This profile is currently managed by ${candidate.profile_owner}. That usually means family is actively involved in conversations and decisions from the start.`;
    }

    return 'This is a self-managed profile. Family details have not been filled in yet, but the profile suggests direct communication with the person behind it.';
}

function buildCareerLifestyleCopy(candidate: MatchCandidate) {
    if (candidate.preferences?.trim()) {
        return `Their stated preferences focus on ${candidate.preferences.trim().toLowerCase()}. Use that as the starting point for career, lifestyle, and long-term expectation discussions.`;
    }

    if (candidate.bio?.trim()) {
        return 'Their bio gives some lifestyle signal already, but dedicated career details have not been filled in yet.';
    }

    return 'Career and lifestyle specifics have not been added yet, so this part of the profile will need to be explored in conversation.';
}

function buildProfileFitChecklist(candidate: MatchCandidate, viewerProfile: ProfileRecord | null) {
    return [
        {
            label: 'Your gender fits their stated partner preference',
            matched: viewerProfile ? matchesPartnerGenderPreference(viewerProfile.gender, candidate.partner_gender_preference) : false,
        },
        {
            label: 'Their gender fits your stated partner preference',
            matched: viewerProfile ? matchesPartnerGenderPreference(candidate.gender, viewerProfile.partner_gender_preference) : false,
        },
        {
            label: 'Location looks aligned',
            matched: viewerProfile ? normalizeToken(viewerProfile.location) === normalizeToken(candidate.location) : false,
        },
        {
            label: 'Photo album is available',
            matched: candidate.photo_urls.length > 0,
        },
        {
            label: 'Profile bio is filled in',
            matched: Boolean(candidate.bio?.trim()),
        },
        {
            label: 'Partner preference notes are filled in',
            matched: Boolean(candidate.preferences?.trim()),
        },
    ];
}

function normalizeToken(value: string | null | undefined) {
    return value?.trim().toLowerCase() ?? '';
}

function formatManagedByLabel(value: ProfileReliabilitySummary['managedBy']) {
    if (!value || value === 'self') {
        return 'Self-managed';
    }

    return `${value.charAt(0).toUpperCase()}${value.slice(1)}-managed`;
}

const styles = StyleSheet.create({
    safeArea: {
        backgroundColor: '#eef4f2',
        flex: 1,
    },
    container: {
        alignSelf: 'center',
        flex: 1,
        maxWidth: MAX_CONTENT_WIDTH,
        paddingBottom: 18,
        paddingHorizontal: 20,
        paddingTop: 12,
        width: '100%',
    },
    headerRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
        marginBottom: 16,
    },
    headerCopy: {
        flex: 1,
        gap: 4,
    },
    eyebrow: {
        color: '#c2643f',
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    title: {
        color: '#14313a',
        fontSize: 28,
        fontWeight: '800',
    },
    subtitle: {
        color: '#5d6d71',
        fontSize: 14,
        lineHeight: 21,
    },
    scrollContent: {
        gap: 16,
        paddingBottom: 10,
    },
    heroPhoto: {
        aspectRatio: 4 / 5,
        borderRadius: 28,
        width: '100%',
    },
    heroPlaceholder: {
        alignItems: 'center',
        aspectRatio: 4 / 5,
        backgroundColor: '#ead9c9',
        borderRadius: 28,
        gap: 8,
        justifyContent: 'center',
        minHeight: 220,
        width: '100%',
    },
    heroInitial: {
        color: '#7a4a2c',
        fontSize: 70,
        fontWeight: '800',
    },
    heroHint: {
        color: '#7a4a2c',
        fontSize: 14,
        fontWeight: '700',
    },
    badgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    pill: {
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    pillPrimary: {
        backgroundColor: '#14313a',
    },
    pillNeutral: {
        backgroundColor: '#edf3f2',
    },
    pillAccent: {
        backgroundColor: '#f0e2d2',
    },
    pillText: {
        fontSize: 12,
        fontWeight: '800',
    },
    pillTextPrimary: {
        color: '#ffffff',
    },
    pillTextNeutral: {
        color: '#47616a',
    },
    pillTextAccent: {
        color: '#7a4a2c',
    },
    sectionCard: {
        backgroundColor: '#fffaf5',
        borderColor: '#eadfd5',
        borderRadius: 24,
        borderWidth: 1,
        gap: 12,
        padding: 16,
    },
    sectionCardCompact: {
        flex: 1,
        minWidth: '47%',
    },
    sectionTitle: {
        color: '#14313a',
        fontSize: 18,
        fontWeight: '800',
    },
    sectionBody: {
        color: '#31494e',
        fontSize: 15,
        lineHeight: 23,
    },
    photoStrip: {
        gap: 10,
        paddingRight: 4,
    },
    photoThumbFrame: {
        borderColor: 'transparent',
        borderRadius: 18,
        borderWidth: 2,
        overflow: 'hidden',
    },
    photoThumbFrameActive: {
        borderColor: '#d9643d',
    },
    photoThumb: {
        height: 104,
        width: 82,
    },
    factGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    factCard: {
        backgroundColor: '#f7efe7',
        borderRadius: 18,
        gap: 4,
        minWidth: '47%',
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    factLabel: {
        color: '#8d6f5a',
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    factValue: {
        color: '#14313a',
        fontSize: 14,
        fontWeight: '700',
        lineHeight: 20,
    },
    twoColumnRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    loadingRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
    },
    insightRow: {
        alignItems: 'flex-start',
        flexDirection: 'row',
        gap: 10,
    },
    insightDot: {
        borderRadius: 999,
        height: 8,
        marginTop: 8,
        width: 8,
    },
    insightDotFit: {
        backgroundColor: '#d9643d',
    },
    insightDotFriction: {
        backgroundColor: '#c6a58a',
    },
    insightText: {
        color: '#35515c',
        flex: 1,
        fontSize: 14,
        lineHeight: 21,
    },
    preferenceRow: {
        paddingVertical: 4,
    },
    preferenceMain: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
    },
    preferenceLabel: {
        color: '#14313a',
        fontSize: 14,
        fontWeight: '700',
    },
    preferenceValue: {
        color: '#35515c',
        fontSize: 14,
    },
    preferencePref: {
        color: '#5d6d71',
        fontSize: 12,
        marginLeft: 32,
        marginTop: 2,
    },
    checklistRows: {
        gap: 10,
    },
    checklistRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
    },
    checklistIndicator: {
        alignItems: 'center',
        borderRadius: 999,
        height: 22,
        justifyContent: 'center',
        width: 22,
    },
    checklistIndicatorMatched: {
        backgroundColor: '#14313a',
    },
    checklistIndicatorOpen: {
        backgroundColor: '#f0e2d2',
    },
    checklistIndicatorText: {
        fontSize: 12,
        fontWeight: '800',
    },
    checklistIndicatorTextMatched: {
        color: '#ffffff',
    },
    checklistIndicatorTextOpen: {
        color: '#7a4a2c',
    },
    checklistLabel: {
        color: '#35515c',
        flex: 1,
        fontSize: 14,
        lineHeight: 20,
    },
    trustStripCard: {
        backgroundColor: '#14313a',
        borderRadius: 24,
        gap: 12,
        padding: 16,
    },
    trustStripHeader: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'space-between',
    },
    contactCard: {
        backgroundColor: '#fffaf5',
        borderColor: '#eadfd5',
        borderRadius: 24,
        borderWidth: 1,
        gap: 14,
        padding: 16,
    },
    contactCardHeader: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 12,
    },
    contactLockBadge: {
        alignItems: 'center',
        backgroundColor: '#f0e2d2',
        borderRadius: 14,
        height: 44,
        justifyContent: 'center',
        width: 44,
    },
    contactLockGlyph: {
        fontSize: 20,
    },
    contactHeaderCopy: {
        flex: 1,
        gap: 4,
    },
    contactEyebrow: {
        color: '#c2643f',
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    contactTitle: {
        color: '#14313a',
        fontSize: 18,
        fontWeight: '800',
    },
    contactRows: {
        gap: 10,
    },
    contactRow: {
        alignItems: 'center',
        backgroundColor: '#f7efe7',
        borderRadius: 16,
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    contactRowLeft: {
        flex: 1,
        gap: 3,
    },
    contactRowLabel: {
        color: '#8d6f5a',
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    contactRowValue: {
        color: '#14313a',
        fontSize: 16,
        fontWeight: '800',
        letterSpacing: 1.5,
    },
    contactRowLockChip: {
        backgroundColor: '#e7ddd2',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    contactRowLockChipText: {
        color: '#7a4a2c',
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
    },
    contactBody: {
        color: '#5d6d71',
        fontSize: 14,
        lineHeight: 21,
    },
    contactUnlockButton: {
        alignItems: 'center',
        backgroundColor: '#14313a',
        borderRadius: 16,
        paddingVertical: 14,
    },
    contactUnlockButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
    contactOrRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
    },
    contactOrLine: {
        backgroundColor: '#e7ddd2',
        flex: 1,
        height: 1,
    },
    contactOrText: {
        color: '#8d6f5a',
        fontSize: 12,
        fontWeight: '800',
        textTransform: 'uppercase',
    },
    contactPremiumButton: {
        alignItems: 'center',
        backgroundColor: '#f4e3c1',
        borderColor: '#e6c98f',
        borderRadius: 16,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 8,
        justifyContent: 'center',
        paddingVertical: 14,
    },
    contactPremiumGlyph: {
        fontSize: 15,
    },
    contactPremiumButtonText: {
        color: '#8a5a1f',
        fontSize: 14,
        fontWeight: '800',
    },
    contactPremiumHint: {
        color: '#8d6f5a',
        fontSize: 12,
        lineHeight: 18,
        textAlign: 'center',
    },
    // ── Unlocked Contact Card ──
    unlockedContactCard: {
        backgroundColor: '#f0faf5',
        borderColor: '#b8e0cc',
        borderRadius: 24,
        borderWidth: 1,
        gap: 14,
        padding: 16,
    },
    unlockedBadge: {
        alignItems: 'center',
        backgroundColor: '#d4f0e1',
        borderRadius: 14,
        height: 44,
        justifyContent: 'center',
        width: 44,
    },
    unlockedEyebrow: {
        color: '#2e8b57',
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    unlockedRowValue: {
        color: '#14313a',
        fontSize: 16,
        fontWeight: '800',
        letterSpacing: 0.6,
    },
    unlockedRowChip: {
        backgroundColor: '#d4f0e1',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    unlockedRowChipText: {
        color: '#2e8b57',
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
    },
    unlockedFooter: {
        color: '#5a9a78',
        fontSize: 12,
        lineHeight: 18,
        textAlign: 'center',
    },
    trustStripCopy: {
        flex: 1,
        gap: 4,
    },
    trustStripEyebrow: {
        color: '#f1c57b',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    trustStripTitle: {
        color: '#ffffff',
        fontSize: 18,
        fontWeight: '800',
    },
    trustStripButton: {
        backgroundColor: '#2e4951',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    trustStripButtonText: {
        color: '#e1ecee',
        fontSize: 12,
        fontWeight: '800',
    },
    trustStripLoadingRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
    },
    trustPillRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    footerRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 12,
    },
    passButton: {
        alignItems: 'center',
        backgroundColor: '#edf3f2',
        borderRadius: 18,
        flex: 1,
        paddingHorizontal: 18,
        paddingVertical: 15,
    },
    passButtonText: {
        color: '#47616a',
        fontSize: 14,
        fontWeight: '800',
    },
    connectButton: {
        alignItems: 'center',
        backgroundColor: '#d9643d',
        borderRadius: 18,
        flex: 1.25,
        paddingHorizontal: 18,
        paddingVertical: 15,
    },
    connectButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
    blockReportRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginVertical: 20,
        gap: 15,
    },
    secondaryActionButton: {
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    secondaryActionText: {
        color: '#7d8c90',
        fontSize: 13,
        fontWeight: '600',
        textDecorationLine: 'underline',
    },
    divider: {
        width: 1,
        height: 16,
        backgroundColor: '#cbd5e0',
    },
    notFoundContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: '#eff6f8',
    },
    notFoundEmoji: {
        fontSize: 64,
        marginBottom: 16,
    },
    notFoundTitle: {
        fontSize: 22,
        fontWeight: '700',
        color: '#11313c',
        marginBottom: 8,
    },
    notFoundSubtitle: {
        fontSize: 15,
        color: '#666',
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 20,
    },
    notFoundButton: {
        backgroundColor: '#123340',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
    },
    notFoundButtonText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '600',
    },
});