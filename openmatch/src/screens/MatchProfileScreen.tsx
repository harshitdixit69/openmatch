import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
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
import { getRequestTrustSummary } from '../lib/intentEscrowApi';
import { MatchCandidate } from '../lib/matchmaking';
import { trackPremiumEvent } from '../lib/premiumAnalytics';
import { getDisplayFirstName, matchesPartnerGenderPreference, ProfileRecord } from '../lib/profile';
import { MAX_CONTENT_WIDTH, useResponsiveLayout } from '../lib/responsiveLayout';

type MatchProfileScreenProps = {
    candidate: MatchCandidate;
    viewerProfile: ProfileRecord | null;
    compatibilitySummary: string | null;
    fitPoints: string[];
    frictionPoints: string[];
    summaryLoading: boolean;
    onClose: () => void;
    onPass: () => void;
    onConnect: () => void;
    onUnlockWithPremium?: () => void;
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
    onConnect,
    onUnlockWithPremium,
}: MatchProfileScreenProps) {
    const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
    const [trustSummary, setTrustSummary] = useState<ProfileReliabilitySummary | null>(null);
    const [trustLoading, setTrustLoading] = useState(false);
    const [trustDrawerVisible, setTrustDrawerVisible] = useState(false);
    const { height } = useResponsiveLayout();

    // Cap the hero image so it never dominates short viewports while still
    // scaling with the content column width via `aspectRatio`.
    const heroMaxHeight = Math.min(420, Math.round(height * 0.46));

    useEffect(() => {
        setSelectedPhotoIndex(0);
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

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
                <View style={styles.headerRow}>
                    <BackButton onPress={onClose} />

                    <View style={styles.headerCopy}>
                        <Text style={styles.eyebrow}>Full Profile</Text>
                        <Text style={styles.title}>{candidate.full_name}</Text>
                        <Text style={styles.subtitle}>Review photos, profile details, family context, and your AI compatibility view.</Text>
                    </View>
                </View>

                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    {activePhotoUrl ? (
                        <Image source={{ uri: activePhotoUrl }} style={[styles.heroPhoto, { maxHeight: heroMaxHeight }]} />
                    ) : (
                        <View style={[styles.heroPlaceholder, { maxHeight: heroMaxHeight }]}>
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

                    <MaskedContactCard firstName={firstName} onUnlock={onConnect} onUnlockWithPremium={handleUnlockWithPremium} />

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
                </ScrollView>

                <View style={styles.footerRow}>
                    <Pressable style={styles.passButton} onPress={onPass}>
                        <Text style={styles.passButtonText}>Pass</Text>
                    </Pressable>

                    <Pressable style={styles.connectButton} onPress={onConnect}>
                        <Text style={styles.connectButtonText}>Connect now</Text>
                    </Pressable>
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
});