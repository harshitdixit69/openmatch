import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Image,
    Linking,
    Modal,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { ChatMatch } from '../lib/chat';
import { fetchChatMatches } from '../lib/chatApi';
import { getDisplayFirstName, ProfileRecord } from '../lib/profile';
import { activateSpotlight, fetchCurrentProfile } from '../lib/profileApi';
import PremiumNotificationsScreen from './PremiumNotificationsScreen';
import PremiumPartnerPreferencesScreen from './PremiumPartnerPreferencesScreen';
import PremiumProfileEditScreen from './PremiumProfileEditScreen';
import PremiumSavedProfilesScreen from './PremiumSavedProfilesScreen';
import PremiumSearchScreen from './PremiumSearchScreen';
import PremiumSettingsScreen from './PremiumSettingsScreen';
import PremiumWhoViewedMeScreen from './PremiumWhoViewedMeScreen';
import PremiumChatScreen from './PremiumChatScreen';
import ConciergeHubScreen from './ConciergeHubScreen';
import PremiumAssistedProfileViewer from '../components/PremiumAssistedProfileViewer';
import OutreachTrackerCard, { OutreachLogRecord } from '../components/OutreachTrackerCard';

// ─────────────────────────────────────────────────────────────────────────────
// Types & Packages Data
// ─────────────────────────────────────────────────────────────────────────────

type PremiumHubTab = 'home' | 'matches' | 'inbox' | 'chat' | 'premium';

type ShellCounts = {
    total: number;
    unread: number;
    received: number;
    accepted: number;
    contacts: number;
    sent: number;
    unreadNotifications: number;
};

interface SubscriptionPackage {
    id: string;
    months: number;
    priceINR: number;
    originalPriceINR?: number;
    unlockCredits: number;
    aiCalls: number;
    pricePerMonth: number;
}

const PRO_PACKAGES: SubscriptionPackage[] = [
    { id: 'pro_1m', months: 1, priceINR: 299, originalPriceINR: 499, unlockCredits: 15, aiCalls: 0, pricePerMonth: 299 },
    { id: 'pro_3m', months: 3, priceINR: 749, originalPriceINR: 1199, unlockCredits: 45, aiCalls: 0, pricePerMonth: 249 },
    { id: 'pro_6m', months: 6, priceINR: 1199, originalPriceINR: 1999, unlockCredits: 90, aiCalls: 0, pricePerMonth: 199 },
    { id: 'pro_12m', months: 12, priceINR: 1799, originalPriceINR: 2999, unlockCredits: 180, aiCalls: 0, pricePerMonth: 149 },
];

const PRO_MAX_PACKAGES: SubscriptionPackage[] = [
    { id: 'pro_max_1m', months: 1, priceINR: 499, originalPriceINR: 799, unlockCredits: 30, aiCalls: 0, pricePerMonth: 499 },
    { id: 'pro_max_3m', months: 3, priceINR: 1249, originalPriceINR: 1999, unlockCredits: 90, aiCalls: 0, pricePerMonth: 416 },
    { id: 'pro_max_6m', months: 6, priceINR: 1999, originalPriceINR: 2999, unlockCredits: 180, aiCalls: 0, pricePerMonth: 333 },
    { id: 'pro_max_12m', months: 12, priceINR: 2999, originalPriceINR: 4999, unlockCredits: 360, aiCalls: 0, pricePerMonth: 249 },
];

const PRO_SUPREME_PACKAGES: SubscriptionPackage[] = [
    { id: 'pro_supreme_1m', months: 1, priceINR: 799, originalPriceINR: 1299, unlockCredits: 50, aiCalls: 0, pricePerMonth: 799 },
    { id: 'pro_supreme_3m', months: 3, priceINR: 1999, originalPriceINR: 3299, unlockCredits: 150, aiCalls: 0, pricePerMonth: 666 },
    { id: 'pro_supreme_6m', months: 6, priceINR: 3299, originalPriceINR: 4999, unlockCredits: 300, aiCalls: 0, pricePerMonth: 550 },
    { id: 'pro_supreme_12m', months: 12, priceINR: 4999, originalPriceINR: 7999, unlockCredits: 600, aiCalls: 0, pricePerMonth: 416 },
];

const EXCLUSIVE_PACKAGES: SubscriptionPackage[] = [
    { id: 'exclusive_3m', months: 3, priceINR: 2499, originalPriceINR: 3999, unlockCredits: 35, aiCalls: 15, pricePerMonth: 833 },
    { id: 'exclusive_6m', months: 6, priceINR: 4499, originalPriceINR: 6999, unlockCredits: 80, aiCalls: 30, pricePerMonth: 749 },
    { id: 'exclusive_12m', months: 12, priceINR: 7499, originalPriceINR: 11999, unlockCredits: 180, aiCalls: 60, pricePerMonth: 624 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function PremiumHubScreen({
    viewerProfile: initialViewerProfile,
    onSignOut,
}: {
    viewerProfile: ProfileRecord | null;
    onSignOut: () => void;
}) {
    const [activeTab, setActiveTab] = useState<PremiumHubTab>('home');
    const [viewerProfile, setViewerProfile] = useState<ProfileRecord | null>(initialViewerProfile);
    const [counts, setCounts] = useState<ShellCounts>({
        total: 0,
        unread: 0,
        received: 0,
        accepted: 0,
        contacts: 0,
        sent: 0,
        unreadNotifications: 0,
    });
    const [loadingData, setLoadingData] = useState(false);

    // Modals
    const [showNotifications, setShowNotifications] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const [showWhoViewedMe, setShowWhoViewedMe] = useState(false);
    const [showShortlist, setShowShortlist] = useState(false);
    const [showProfileEdit, setShowProfileEdit] = useState(false);
    const [showPartnerPrefs, setShowPartnerPrefs] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
    const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
    const [selectedLogModal, setSelectedLogModal] = useState<OutreachLogRecord | null>(null);

    // AI Broker Outreach Logs
    const [outreachLogs, setOutreachLogs] = useState<OutreachLogRecord[]>([
        {
            id: 'log-1',
            candidateName: 'Riya Rao',
            candidatePhotoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',
            callStatus: 'completed_accepted',
            callSummary: [
                'Riya appreciated shared interest in tech and architecture.',
                'Asked about family location flexibility in Mumbai.',
                'Approved mutual contact detail unlock with Relationship Manager.',
            ],
            candidateSentiment: 'Enthusiastic & Positive',
            updatedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
        },
        {
            id: 'log-2',
            candidateName: 'Ananya Sharma',
            candidatePhotoUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400',
            callStatus: 'calling',
            callSummary: [],
            candidateSentiment: 'In Progress',
            updatedAt: new Date().toISOString(),
        },
        {
            id: 'log-3',
            candidateName: 'Priya Malhotra',
            candidatePhotoUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400',
            callStatus: 'voicemail',
            callSummary: [
                'Voicemail reached after 4 rings.',
                'AI voice agent left a personalized pitch message.',
            ],
            candidateSentiment: 'Voicemail Left',
            updatedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
        },
    ]);

    // Spotlight
    const [secondsRemaining, setSecondsRemaining] = useState(0);
    const [activatingSpotlight, setActivatingSpotlight] = useState(false);
    const [showSpotlightConfirm, setShowSpotlightConfirm] = useState(false);

    // Membership / Upgrade Tab state
    const [memTabType, setMemTabType] = useState<'self-service' | 'assisted'>('self-service');
    const [selfServiceSubTier, setSelfServiceSubTier] = useState<'pro' | 'pro_max' | 'pro_supreme'>('pro_max');
    const [activeDuration, setActiveDuration] = useState<'1_month' | '3_months' | '6_months' | 'till_marriage'>('1_month');
    const [selectedPackageId, setSelectedPackageId] = useState<string>('pro_max_1m');
    const [checkoutLoading, setCheckoutLoading] = useState(false);

    // Load data
    const refreshData = async () => {
        setLoadingData(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();

            let unreadNotifCount = 0;
            if (user) {
                const res = await supabase
                    .from('notifications')
                    .select('id', { count: 'exact', head: true })
                    .eq('user_id', user.id)
                    .eq('is_read', false);
                unreadNotifCount = res.count ?? 0;
            }

            const [profile, matches] = await Promise.all([
                fetchCurrentProfile().catch(() => initialViewerProfile),
                fetchChatMatches().catch(() => [] as ChatMatch[]),
            ]);
            if (profile) setViewerProfile(profile);

            const total = matches.length;
            const unread = matches.reduce((acc: number, m: ChatMatch) => acc + (m.unreadCount || 0), 0);
            const received = matches.filter((m: ChatMatch) => m.matchRequestState === 'received').length;
            const accepted = matches.filter((m: ChatMatch) => m.status === 'connected').length;
            const contacts = matches.filter((m: ChatMatch) => m.isUnlocked).length;
            const sent = matches.filter((m: ChatMatch) => m.matchRequestState === 'sent').length;

            setCounts({
                total,
                unread,
                received,
                accepted,
                contacts,
                sent,
                unreadNotifications: unreadNotifCount,
            });
        } catch (e) {
            console.warn('Failed to refresh PremiumHubScreen data:', e);
        } finally {
            setLoadingData(false);
        }
    };

    useEffect(() => {
        void refreshData();
    }, []);

    // Spotlight logic
    const isSpotlightActive = useMemo(() => {
        if (!viewerProfile?.spotlight_active_until) return false;
        return new Date(viewerProfile.spotlight_active_until).getTime() > Date.now();
    }, [viewerProfile?.spotlight_active_until]);

    useEffect(() => {
        if (!isSpotlightActive || !viewerProfile?.spotlight_active_until) {
            setSecondsRemaining(0);
            return;
        }

        const expiry = new Date(viewerProfile.spotlight_active_until).getTime();
        function updateTimer() {
            const diff = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
            setSecondsRemaining(diff);
        }

        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [isSpotlightActive, viewerProfile?.spotlight_active_until]);

    const formatTimer = (totalSeconds: number) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleExecuteSpotlight = async () => {
        setShowSpotlightConfirm(false);
        setActivatingSpotlight(true);
        try {
            const result = await activateSpotlight();
            if (result.success) {
                Alert.alert('Spotlight Active! ✨', 'Your profile is featured at the top of feeds for 30 minutes.');
                await refreshData();
            }
        } catch (err: any) {
            Alert.alert('Activation Failed', err.message || 'Failed to activate Spotlight.');
        } finally {
            setActivatingSpotlight(false);
        }
    };

    // Packages & Selection Sync
    const syncSelection = (subTier: 'pro' | 'pro_max' | 'pro_supreme', duration: '1_month' | '3_months' | '6_months' | 'till_marriage') => {
        setActiveDuration(duration);
        const monthsMap = { '1_month': '1m', '3_months': '3m', '6_months': '6m', 'till_marriage': '12m' };
        setSelectedPackageId(`${subTier}_${monthsMap[duration]}`);
    };

    const handleTabChange = (tab: 'self-service' | 'assisted') => {
        setMemTabType(tab);
        if (tab === 'self-service') {
            syncSelection(selfServiceSubTier, activeDuration);
        } else {
            setActiveDuration('3_months');
            setSelectedPackageId('exclusive_3m');
        }
    };

    const handleSubTierChange = (subTier: 'pro' | 'pro_max' | 'pro_supreme') => {
        setSelfServiceSubTier(subTier);
        syncSelection(subTier, activeDuration);
    };

    const getPackages = () => {
        if (memTabType === 'assisted') return EXCLUSIVE_PACKAGES;
        return selfServiceSubTier === 'pro'
            ? PRO_PACKAGES
            : selfServiceSubTier === 'pro_max'
            ? PRO_MAX_PACKAGES
            : PRO_SUPREME_PACKAGES;
    };

    const packages = getPackages();
    const selectedPackage = packages.find((pkg) => pkg.id === selectedPackageId) || packages[0];

    const handleCheckout = async () => {
        setCheckoutLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('create-subscription-checkout', {
                body: {
                    packageTier: memTabType === 'self-service' ? 'plus' : 'vip',
                    subTier: memTabType === 'self-service' ? selfServiceSubTier : undefined,
                    durationMonths: selectedPackage.months,
                    successUrl: Platform.OS === 'web' ? window.location.origin : undefined,
                    cancelUrl: Platform.OS === 'web' ? window.location.origin : undefined,
                },
            });

            if (error) throw error;
            if (data?.checkoutUrl) {
                if (Platform.OS === 'web') {
                    window.location.href = data.checkoutUrl;
                } else {
                    const supported = await Linking.canOpenURL(data.checkoutUrl);
                    if (supported) {
                        await Linking.openURL(data.checkoutUrl);
                    } else {
                        Alert.alert('Checkout Unavailable', 'Could not open Checkout page.');
                    }
                }
            } else {
                throw new Error('No checkout URL returned.');
            }
        } catch (err: any) {
            Alert.alert('Payment Failed', err.message || 'Unable to start Stripe checkout session.');
        } finally {
            setCheckoutLoading(false);
        }
    };

    const handleExecuteSignOut = async () => {
        setShowSignOutConfirm(false);
        try {
            await supabase.auth.signOut();
            onSignOut();
        } catch (err) {
            console.error('Sign out error:', err);
        }
    };

    const firstName = getDisplayFirstName(viewerProfile?.full_name);
    const photoUrl = viewerProfile?.photo_urls?.[0];
    const expiryDateStr = viewerProfile?.subscription_expires_at
        ? new Date(viewerProfile.subscription_expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : 'August 20, 2026';

    // Duration Multipliers for comparison table
    const durationMonths = activeDuration === '1_month' ? 1 : activeDuration === '3_months' ? 3 : activeDuration === '6_months' ? 6 : 12;
    const contactPro = 15 * durationMonths;
    const contactMax = 30 * durationMonths;
    const contactSupreme = 50 * durationMonths;
    const interestMax = 50 * durationMonths;
    const interestSupreme = 80 * durationMonths;
    const spotlightMax = 1 * durationMonths;
    const spotlightSupreme = 3 * durationMonths;

    // TableRow helper
    const TableRow = ({ label, valPro, valMax, valSupreme, hasInfo }: { label: string; valPro: string; valMax: string; valSupreme: string; hasInfo?: boolean }) => (
        <View style={styles.tableRow}>
            <View style={styles.rowLabelCell}>
                <Text style={styles.rowLabelText}>{label}</Text>
                {hasInfo && <Text style={styles.infoIcon}>ⓘ</Text>}
            </View>
            <Pressable style={[styles.rowValCell, selfServiceSubTier === 'pro' && styles.activeValCell]} onPress={() => handleSubTierChange('pro')}>
                <Text style={[styles.rowValText, selfServiceSubTier === 'pro' && styles.rowValTextActive]}>{valPro}</Text>
            </Pressable>
            <Pressable style={[styles.rowValCell, selfServiceSubTier === 'pro_max' && styles.activeValCell]} onPress={() => handleSubTierChange('pro_max')}>
                <Text style={[styles.rowValText, selfServiceSubTier === 'pro_max' && styles.rowValTextActive]}>{valMax}</Text>
            </Pressable>
            <Pressable style={[styles.rowValCell, selfServiceSubTier === 'pro_supreme' && styles.activeValCell]} onPress={() => handleSubTierChange('pro_supreme')}>
                <Text style={[styles.rowValText, selfServiceSubTier === 'pro_supreme' && styles.rowValTextActive]}>{valSupreme}</Text>
            </Pressable>
        </View>
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Sub-screens Modals
    // ─────────────────────────────────────────────────────────────────────────

    if (showNotifications) return <PremiumNotificationsScreen onBack={() => setShowNotifications(false)} />;
    if (showPartnerPrefs) return <PremiumPartnerPreferencesScreen onBack={() => setShowPartnerPrefs(false)} />;
    if (showProfileEdit) return <PremiumProfileEditScreen onBack={() => setShowProfileEdit(false)} />;
    if (showSettings) return <PremiumSettingsScreen onBack={() => setShowSettings(false)} onSignedOut={onSignOut} />;
    if (showSearch) return <PremiumSearchScreen onBack={() => setShowSearch(false)} onSelectCandidate={(c) => { setShowSearch(false); setSelectedCandidateId(c.id); }} />;
    if (showShortlist) return <PremiumSavedProfilesScreen onBack={() => setShowShortlist(false)} onSelectCandidate={(c) => { setShowShortlist(false); setSelectedCandidateId(c.id); }} />;
    if (showWhoViewedMe) return <PremiumWhoViewedMeScreen onBack={() => setShowWhoViewedMe(false)} />;

    // Notification Bell Component
    const NotifBellBtn = () => (
        <Pressable style={styles.notifBtn} onPress={() => setShowNotifications(true)}>
            <Text style={styles.notifIcon}>🔔</Text>
            {counts.unreadNotifications > 0 && (
                <View style={styles.notifBadge}>
                    <Text style={styles.notifBadgeText}>
                        {counts.unreadNotifications > 9 ? '9+' : counts.unreadNotifications}
                    </Text>
                </View>
            )}
        </Pressable>
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Render Active Tab Content
    // ─────────────────────────────────────────────────────────────────────────

    const renderTabContent = () => {
        if (activeTab === 'chat') {
            return (
                <PremiumChatScreen
                    viewerProfile={viewerProfile}
                    onBack={() => setActiveTab('home')}
                    onViewProfile={(id) => setSelectedCandidateId(id)}
                />
            );
        }

        if (activeTab === 'matches') {
            return (
                <View style={{ flex: 1 }}>
                    <View style={styles.tabHeaderBar}>
                        <Text style={styles.tabHeaderTitle}>Curated Shortlist</Text>
                        <NotifBellBtn />
                    </View>
                    <ConciergeHubScreen
                        viewerProfile={viewerProfile}
                        onViewProfile={(id) => setSelectedCandidateId(id)}
                        onSignOut={() => setShowSignOutConfirm(true)}
                        onOpenChat={() => setActiveTab('chat')}
                        hideTabBar={true}
                    />
                </View>
            );
        }

        if (activeTab === 'inbox') {
            return (
                <View style={styles.panelContainer}>
                    <View style={styles.tabHeaderBar}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.inboxTitle}>AI Outreach Tracker</Text>
                            <Text style={styles.inboxSub}>Real-time updates on Retell AI broker calls</Text>
                        </View>
                        {__DEV__ && (
                            <Pressable
                                style={styles.simulateBtn}
                                onPress={() => {
                                    setOutreachLogs((prev) =>
                                        prev.map((log) =>
                                            log.callStatus === 'calling'
                                                ? {
                                                      ...log,
                                                      callStatus: 'completed_accepted',
                                                      candidateSentiment: 'Positive & Approved',
                                                      callSummary: [
                                                          'Ananya appreciated the personalized pitch.',
                                                          'Discussed career alignment in finance & technology.',
                                                          'Agreed to connect via direct chat.',
                                                      ],
                                                      updatedAt: new Date().toISOString(),
                                                  }
                                                : log,
                                        ),
                                    );
                                    Alert.alert('Simulated AI Call Completed! 🟢', 'Ananya Sharma accepted the pitch!');
                                }}
                            >
                                <Text style={styles.simulateBtnText}>⚡ Simulate Call</Text>
                            </Pressable>
                        )}
                        <NotifBellBtn />
                    </View>

                    <ScrollView contentContainerStyle={{ paddingVertical: 12, gap: 12 }} showsVerticalScrollIndicator={false}>
                        {outreachLogs.length === 0 ? (
                            <View style={styles.inboxEmptyCard}>
                                <Text style={styles.inboxEmptyIcon}>📥</Text>
                                <Text style={styles.inboxEmptyTitle}>No active AI calls</Text>
                                <Text style={styles.inboxEmptySub}>
                                    When your RM initiates AI voice broker outreach, tracking updates will appear here.
                                </Text>
                            </View>
                        ) : (
                            outreachLogs.map((log) => (
                                <OutreachTrackerCard
                                    key={log.id}
                                    log={log}
                                    onPress={() => setSelectedLogModal(log)}
                                />
                            ))
                        )}
                    </ScrollView>
                </View>
            );
        }

        if (activeTab === 'premium') {
            return (
                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    {/* Top Header */}
                    <View style={styles.upgradeHeaderRow}>
                        <Text style={styles.pageHeaderTitle}>Upgrade Membership</Text>
                        <Pressable onPress={() => Alert.alert('Need Help?', 'Contact premium-support@openmatch.co')}>
                            <Text style={styles.needHelpText}>Need Help?</Text>
                        </Pressable>
                    </View>

                    {/* Active Premium Card */}
                    {(() => {
                        const tier = viewerProfile?.subscription_tier || (viewerProfile as any)?.membership_tier;
                        const tierLabel = tier === 'assisted'
                            ? 'ASSISTED EXCLUSIVE'
                            : tier === 'vip'
                            ? 'VIP CONCIERGE'
                            : tier === 'pro_supreme'
                            ? 'PRO SUPREME'
                            : tier === 'pro'
                            ? 'PRO'
                            : 'PRO MAX';
                        return (
                            <View style={styles.activePremiumHero}>
                                <Text style={styles.activePremiumEyebrow}>👑 OPENMATCH {tierLabel} ACTIVE</Text>
                                <Text style={styles.activePremiumTitle}>Premium status is unlocked</Text>
                                <Text style={styles.activePremiumBody}>
                                    Thank you for supporting a fair matchmaking ecosystem. Your subscription is active until{' '}
                                    <Text style={{ fontWeight: '700', color: '#f0ece8' }}>{expiryDateStr}</Text>.
                                </Text>
                                <View style={styles.creditsBox}>
                                    <Text style={styles.creditsNumber}>
                                        🔑 {viewerProfile?.unlock_credits_remaining ?? viewerProfile?.manual_unlock_credits ?? 30}
                                    </Text>
                                    <Text style={styles.creditsLabel}>UNLOCK CREDITS</Text>
                                </View>
                            </View>
                        );
                    })()}

                    {/* Toggle: Self-service / Assisted */}
                    <View style={styles.toggleContainer}>
                        <Pressable
                            style={[styles.toggleSegment, memTabType === 'self-service' && styles.toggleSegmentActive]}
                            onPress={() => handleTabChange('self-service')}
                        >
                            <Text style={[styles.toggleText, memTabType === 'self-service' && styles.toggleTextActive]}>
                                Self-service
                            </Text>
                        </Pressable>
                        <Pressable
                            style={[styles.toggleSegment, memTabType === 'assisted' && styles.toggleSegmentActive]}
                            onPress={() => handleTabChange('assisted')}
                        >
                            <Text style={[styles.toggleText, memTabType === 'assisted' && styles.toggleTextActive]}>
                                Assisted
                            </Text>
                        </Pressable>
                    </View>

                    {memTabType === 'self-service' ? (
                        <View style={styles.tableContainer}>
                            <View style={styles.tableHeaderRow}>
                                <View style={styles.tableHeaderCellLeft} />
                                <Pressable
                                    style={[styles.tableHeaderCell, selfServiceSubTier === 'pro' && styles.selectedHeaderCell]}
                                    onPress={() => handleSubTierChange('pro')}
                                >
                                    <Text style={[styles.columnTitle, selfServiceSubTier === 'pro' && styles.columnTitleActive]}>Pro</Text>
                                    <View style={[styles.radioOuter, selfServiceSubTier === 'pro' && styles.radioOuterActive]}>
                                        {selfServiceSubTier === 'pro' && <View style={styles.radioInner} />}
                                    </View>
                                </Pressable>
                                <Pressable
                                    style={[styles.tableHeaderCell, selfServiceSubTier === 'pro_max' && styles.selectedHeaderCell]}
                                    onPress={() => handleSubTierChange('pro_max')}
                                >
                                    <Text style={[styles.columnTitle, selfServiceSubTier === 'pro_max' && styles.columnTitleActive]}>Pro Max</Text>
                                    <View style={[styles.radioOuter, selfServiceSubTier === 'pro_max' && styles.radioOuterActive]}>
                                        {selfServiceSubTier === 'pro_max' && <View style={styles.radioInner} />}
                                    </View>
                                </Pressable>
                                <Pressable
                                    style={[styles.tableHeaderCell, selfServiceSubTier === 'pro_supreme' && styles.selectedHeaderCell]}
                                    onPress={() => handleSubTierChange('pro_supreme')}
                                >
                                    <View style={styles.topSellerTag}>
                                        <Text style={styles.topSellerTagText}>TOP SELLER</Text>
                                    </View>
                                    <Text style={[styles.columnTitle, selfServiceSubTier === 'pro_supreme' && styles.columnTitleActive]}>Pro Supreme</Text>
                                    <View style={[styles.radioOuter, selfServiceSubTier === 'pro_supreme' && styles.radioOuterActive]}>
                                        {selfServiceSubTier === 'pro_supreme' && <View style={styles.radioInner} />}
                                    </View>
                                </Pressable>
                            </View>

                            <TableRow label="Contact sharing" valPro="✓" valMax="✓" valSupreme="✓" />
                            <TableRow label="Engage+" valPro="✓" valMax="✓" valSupreme="✓" hasInfo />
                            <TableRow label="Contact Details" valPro={`${contactPro} Unlocks`} valMax={`${contactMax} Unlocks`} valSupreme={`${contactSupreme} Unlocks`} />
                            <TableRow label="Super Interest" valPro="0" valMax={`${interestMax}`} valSupreme={`${interestSupreme}`} hasInfo />
                            <TableRow label="Spotlights" valPro="0" valMax={`${spotlightMax}`} valSupreme={`${spotlightSupreme}`} hasInfo />
                            <TableRow label="Gold Badge" valPro="✓" valMax="✓" valSupreme="✓" />
                        </View>
                    ) : (
                        <View style={styles.assistedBox}>
                            <Text style={styles.assistedTitle}>Exclusive Concierge</Text>
                            <Text style={styles.assistedSub}>Handhandled matchmaking by dedicated Relationship Manager</Text>
                        </View>
                    )}

                    {/* Discount Banner */}
                    <Text style={styles.discountText}>GET UPTO 40% OFF ON ALL PLANS</Text>

                    {/* Choose Duration */}
                    <Text style={styles.durationTitle}>CHOOSE A PLAN DURATION</Text>
                    <View style={styles.durationGrid}>
                        {packages.map((pkg) => {
                            const isSelected = pkg.id === selectedPackageId;
                            const label = pkg.months === 12 && memTabType === 'self-service' ? 'Till Marriage' : `${pkg.months} ${pkg.months === 1 ? 'month' : 'months'}`;
                            return (
                                <Pressable
                                    key={pkg.id}
                                    style={[styles.durationCard, isSelected && styles.durationCardSelected]}
                                    onPress={() => {
                                        setSelectedPackageId(pkg.id);
                                        const durMap: Record<number, '1_month' | '3_months' | '6_months' | 'till_marriage'> = {
                                            1: '1_month', 3: '3_months', 6: '6_months', 12: 'till_marriage'
                                        };
                                        if (durMap[pkg.months]) setActiveDuration(durMap[pkg.months]);
                                    }}
                                >
                                    <Text style={[styles.durationLabel, isSelected && styles.durationLabelSelected]}>{label}</Text>
                                    <View style={[styles.radioOuter, isSelected && styles.radioOuterActive]}>
                                        {isSelected && <View style={styles.radioInner} />}
                                    </View>
                                </Pressable>
                            );
                        })}
                    </View>

                    {/* Checkout Button */}
                    <Pressable
                        style={[styles.checkoutBtn, checkoutLoading && { opacity: 0.6 }]}
                        onPress={handleCheckout}
                        disabled={checkoutLoading}
                    >
                        {checkoutLoading ? (
                            <ActivityIndicator size="small" color="#0d0c0f" />
                        ) : (
                            <Text style={styles.checkoutBtnText}>
                                Get {memTabType === 'assisted' ? 'Exclusive' : selfServiceSubTier === 'pro' ? 'Pro' : selfServiceSubTier === 'pro_max' ? 'Pro Max' : 'Pro Supreme'} Now
                            </Text>
                        )}
                    </Pressable>
                </ScrollView>
            );
        }

        // Default: Home Tab
        return (
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Hero Header */}
                <View style={styles.homeHeroCard}>
                    <View style={styles.homeHeroHeader}>
                        {photoUrl ? (
                            <Image source={{ uri: photoUrl }} style={styles.userAvatar} />
                        ) : (
                            <View style={styles.userAvatarPlaceholder}>
                                <Text style={styles.userAvatarInitial}>{firstName?.charAt(0) || 'U'}</Text>
                            </View>
                        )}
                        <View style={{ flex: 1 }}>
                            <Text style={styles.eyebrow}>OPENMATCH</Text>
                            <Text style={styles.welcomeTitle}>{`Welcome back, ${firstName.toLowerCase() || 'member'}`}</Text>
                        </View>
                        <Pressable onPress={() => setShowSettings(true)} style={styles.settingsBtn}>
                            <Text style={styles.settingsIcon}>⚙</Text>
                        </Pressable>
                    </View>
                    <Text style={styles.heroSubText}>
                        Keep track of your match requests and unlocked conversations.
                    </Text>
                </View>

                {/* 4 Stats Cards */}
                <View style={styles.statsGrid}>
                    <View style={styles.statCard}>
                        <Text style={styles.statValue}>{counts.received}</Text>
                        <Text style={styles.statLabel}>Requests</Text>
                    </View>
                    <View style={[styles.statCard, styles.statCardAccent]}>
                        <Text style={[styles.statValue, { color: '#f0ece8' }]}>{counts.unread}</Text>
                        <Text style={[styles.statLabel, { color: '#8e8aa0' }]}>Unread</Text>
                    </View>
                    <View style={styles.statCard}>
                        <Text style={styles.statValue}>{counts.contacts}</Text>
                        <Text style={styles.statLabel}>Unlocked</Text>
                    </View>
                    <View style={styles.statCard}>
                        <Text style={styles.statValue}>{counts.total || 1}</Text>
                        <Text style={styles.statLabel}>Active</Text>
                    </View>
                </View>

                {/* Boost Your Visibility Card */}
                <View style={styles.spotlightCard}>
                    <View style={styles.spotlightRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.spotlightTitle}>
                                {isSpotlightActive ? '✨ Spotlight is Active!' : '✨ Boost Your Visibility'}
                            </Text>
                            <Text style={styles.spotlightSub}>
                                {isSpotlightActive
                                    ? 'Your profile is highlighted at the top of feeds.'
                                    : `You have ${viewerProfile?.spotlights_remaining ?? 1} Spotlight credit remaining.`}
                            </Text>
                        </View>
                        {isSpotlightActive ? (
                            <View style={styles.timerBadge}>
                                <Text style={styles.timerText}>{formatTimer(secondsRemaining)}</Text>
                            </View>
                        ) : (
                            <Pressable style={styles.activateBtn} onPress={() => setShowSpotlightConfirm(true)}>
                                <Text style={styles.activateBtnText}>Activate</Text>
                            </Pressable>
                        )}
                    </View>
                </View>

                {/* Quick Actions / Jump back in */}
                <View style={styles.quickActionsCard}>
                    <Text style={styles.quickActionsTitle}>Jump back in</Text>
                    <View style={styles.quickActionList}>
                        <Pressable style={styles.actionRowPrimary} onPress={() => setShowSearch(true)}>
                            <Text style={styles.actionTitlePrimary}>Search profiles</Text>
                            <Text style={styles.actionSubPrimary}>Filter by age, religion...</Text>
                        </Pressable>
                        <Pressable style={styles.actionRowGold} onPress={() => setShowWhoViewedMe(true)}>
                            <Text style={styles.actionTitleGold}>Who viewed me</Text>
                            <Text style={styles.actionSubGold}>Recent profile visitors</Text>
                        </Pressable>
                        <Pressable style={styles.actionRowDark} onPress={() => setShowShortlist(true)}>
                            <Text style={styles.actionTitleDark}>Saved profiles</Text>
                            <Text style={styles.actionSubDark}>Your bookmarks</Text>
                        </Pressable>
                        <Pressable style={styles.actionRowDark} onPress={() => setShowProfileEdit(true)}>
                            <Text style={styles.actionTitleDark}>Edit profile</Text>
                            <Text style={styles.actionSubDark}>Update your details</Text>
                        </Pressable>
                        <Pressable style={styles.actionRowDark} onPress={() => setShowPartnerPrefs(true)}>
                            <Text style={styles.actionTitleDark}>Edit preferences</Text>
                            <Text style={styles.actionSubDark}>Refine match filters</Text>
                        </Pressable>
                        <Pressable style={styles.actionRowGold} onPress={() => setShowSignOutConfirm(true)}>
                            <Text style={styles.actionTitleGold}>Sign out</Text>
                            <Text style={styles.actionSubGold}>Log out of your account</Text>
                        </Pressable>
                    </View>
                </View>
            </ScrollView>
        );
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Bottom Navigation Bar Items
    // ─────────────────────────────────────────────────────────────────────────

    const navTabs = [
        { key: 'home', label: 'Home' },
        { key: 'matches', label: 'Matches' },
        { key: 'inbox', label: 'Inbox' },
        { key: 'chat', label: 'Chat' },
        { key: 'premium', label: 'Premium' },
    ] as const;

    return (
        <SafeAreaView style={styles.container}>
            {/* Active Tab Screen */}
            <View style={{ flex: 1 }}>{renderTabContent()}</View>

            {/* Bottom Nav (Golden Black Aesthetic) */}
            <View style={styles.bottomNav}>
                {navTabs.map((t) => {
                    const isActive = activeTab === t.key;
                    return (
                        <Pressable
                            key={t.key}
                            style={[styles.navItem, isActive && styles.navItemActive]}
                            onPress={() => setActiveTab(t.key as PremiumHubTab)}
                        >
                            <Text style={[styles.navText, isActive && styles.navTextActive]}>
                                {t.label}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>

            {/* Profile Viewer Modal */}
            <Modal transparent={false} animationType="slide" visible={Boolean(selectedCandidateId)} onRequestClose={() => setSelectedCandidateId(null)}>
                {selectedCandidateId ? (
                    <PremiumAssistedProfileViewer
                        profileId={selectedCandidateId}
                        onClose={() => setSelectedCandidateId(null)}
                    />
                ) : null}
            </Modal>

            {/* Spotlight Modal */}
            <Modal transparent animationType="fade" visible={showSpotlightConfirm} onRequestClose={() => setShowSpotlightConfirm(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>✨ Activate Spotlight</Text>
                        <Text style={styles.modalBody}>Feature your profile at the top of candidate feeds for 30 minutes?</Text>
                        <View style={styles.modalBtns}>
                            <Pressable style={styles.cancelBtn} onPress={() => setShowSpotlightConfirm(false)}>
                                <Text style={styles.cancelText}>Cancel</Text>
                            </Pressable>
                            <Pressable style={styles.confirmBtn} onPress={handleExecuteSpotlight}>
                                <Text style={styles.confirmText}>Activate</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Sign Out Modal */}
            <Modal transparent animationType="fade" visible={showSignOutConfirm} onRequestClose={() => setShowSignOutConfirm(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>Sign Out</Text>
                        <Text style={styles.modalBody}>Are you sure you want to sign out of your account?</Text>
                        <View style={styles.modalBtns}>
                            <Pressable style={styles.cancelBtn} onPress={() => setShowSignOutConfirm(false)}>
                                <Text style={styles.cancelText}>Cancel</Text>
                            </Pressable>
                            <Pressable style={[styles.confirmBtn, { backgroundColor: '#d44e45' }]} onPress={handleExecuteSignOut}>
                                <Text style={[styles.confirmText, { color: '#fff' }]}>Sign Out</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* AI Outreach Call Summary Modal */}
            <Modal
                transparent
                animationType="slide"
                visible={selectedLogModal !== null}
                onRequestClose={() => setSelectedLogModal(null)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalCard, { width: '90%', maxWidth: 440, padding: 20 }]}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={styles.modalTitle}>🤖 Retell AI Broker Call</Text>
                            <Pressable onPress={() => setSelectedLogModal(null)}>
                                <Text style={{ fontSize: 18, color: GOLD, fontWeight: '700' }}>✕</Text>
                            </Pressable>
                        </View>

                        {selectedLogModal && (
                            <View style={{ gap: 14, marginTop: 12 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                    {selectedLogModal.candidatePhotoUrl ? (
                                        <Image
                                            source={{ uri: selectedLogModal.candidatePhotoUrl }}
                                            style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: GOLD }}
                                        />
                                    ) : (
                                        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#262238', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: GOLD }}>
                                            <Text style={{ fontSize: 18, fontWeight: '700', color: GOLD }}>
                                                {selectedLogModal.candidateName?.charAt(0) ?? '?'}
                                            </Text>
                                        </View>
                                    )}
                                    <View>
                                        <Text style={{ fontSize: 16, fontWeight: '800', color: TEXT_PRIMARY }}>
                                            {selectedLogModal.candidateName}
                                        </Text>
                                        <Text style={{ fontSize: 12, color: GOLD, fontWeight: '700' }}>
                                            Status: {selectedLogModal.callStatus.toUpperCase()}
                                        </Text>
                                    </View>
                                </View>

                                <View style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: BORDER }}>
                                    <Text style={{ fontSize: 11, color: TEXT_SUB, marginBottom: 4 }}>Candidate Sentiment</Text>
                                    <Text style={{ fontSize: 13, fontWeight: '800', color: GOLD }}>
                                        {selectedLogModal.candidateSentiment || 'In Progress'}
                                    </Text>
                                </View>

                                <View style={{ gap: 6 }}>
                                    <Text style={{ fontSize: 12, fontWeight: '800', color: GOLD }}>Key Conversation Highlights:</Text>
                                    {(selectedLogModal.callSummary || []).length > 0 ? (
                                        selectedLogModal.callSummary.map((point, i) => (
                                            <Text key={i} style={{ fontSize: 12, color: TEXT_PRIMARY, lineHeight: 18 }}>
                                                • {point}
                                            </Text>
                                        ))
                                    ) : (
                                        <Text style={{ fontSize: 12, color: TEXT_SUB, fontStyle: 'italic' }}>
                                            AI voice call active. Key insights will populate automatically upon call analysis.
                                        </Text>
                                    )}
                                </View>

                                <Pressable
                                    style={[styles.confirmBtn, { backgroundColor: GOLD, marginTop: 10 }]}
                                    onPress={() => setSelectedLogModal(null)}
                                >
                                    <Text style={[styles.confirmText, { color: '#0d0c0f' }]}>Close Summary</Text>
                                </Pressable>
                            </View>
                        )}
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles: Black & Gold Concierge Aesthetic
// ─────────────────────────────────────────────────────────────────────────────

const GOLD = '#d4b373';
const DARK_BG = '#0d0c0f';
const CARD_BG = '#1a1828';
const BORDER = '#2a2640';
const TEXT_PRIMARY = '#f0ece8';
const TEXT_MUTED = '#6c6880';
const TEXT_SUB = '#8e8aa0';

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: DARK_BG,
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 32,
    },
    panelContainer: {
        flex: 1,
        padding: 20,
        backgroundColor: DARK_BG,
    },
    tabHeaderBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
        marginBottom: 8,
    },
    tabHeaderTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: TEXT_PRIMARY,
    },

    // Notification Bell Button
    simulateBtn: {
        backgroundColor: 'rgba(212,179,115,0.15)',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderWidth: 1,
        borderColor: GOLD,
        marginRight: 8,
    },
    simulateBtnText: {
        fontSize: 11,
        fontWeight: '800',
        color: GOLD,
    },
    notifBtn: {
        position: 'relative',
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#262238',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: BORDER,
    },
    notifIcon: {
        fontSize: 16,
    },
    notifBadge: {
        position: 'absolute',
        top: -2,
        right: -2,
        backgroundColor: '#ef4444',
        borderRadius: 8,
        minWidth: 16,
        height: 16,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 3,
    },
    notifBadgeText: {
        fontSize: 9,
        fontWeight: '900',
        color: '#ffffff',
    },

    // Bottom Navigation Bar (Black & Gold Theme)
    bottomNav: {
        flexDirection: 'row',
        backgroundColor: '#12101a',
        paddingHorizontal: 8,
        paddingVertical: 10,
        gap: 6,
        borderTopWidth: 1,
        borderTopColor: BORDER,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 12,
    },
    navItem: {
        flex: 1,
        backgroundColor: '#1a1828',
        borderRadius: 20,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'transparent',
    },
    navItemActive: {
        backgroundColor: GOLD,
        borderColor: GOLD,
    },
    navText: {
        fontSize: 13,
        fontWeight: '700',
        color: TEXT_SUB,
    },
    navTextActive: {
        color: DARK_BG,
        fontWeight: '800',
    },

    // Home Hero Header
    homeHeroCard: {
        backgroundColor: CARD_BG,
        borderRadius: 18,
        padding: 18,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: BORDER,
    },
    homeHeroHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 10,
    },
    userAvatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 2,
        borderColor: GOLD,
    },
    userAvatarPlaceholder: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: BORDER,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: GOLD,
    },
    userAvatarInitial: {
        color: GOLD,
        fontSize: 18,
        fontWeight: '700',
    },
    eyebrow: {
        fontSize: 10,
        fontWeight: '800',
        color: GOLD,
        letterSpacing: 0.8,
    },
    welcomeTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: TEXT_PRIMARY,
        marginTop: 2,
    },
    settingsBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#262238',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: BORDER,
    },
    settingsIcon: {
        fontSize: 16,
        color: GOLD,
    },
    heroSubText: {
        fontSize: 13,
        color: TEXT_SUB,
        lineHeight: 18,
    },

    // Stats Grid
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 14,
    },
    statCard: {
        flex: 1,
        minWidth: '45%',
        backgroundColor: CARD_BG,
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: BORDER,
    },
    statCardAccent: {
        backgroundColor: '#221d38',
        borderColor: GOLD,
    },
    statValue: {
        fontSize: 24,
        fontWeight: '900',
        color: GOLD,
        marginBottom: 2,
    },
    statLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: TEXT_SUB,
    },

    // Spotlight Boost Card
    spotlightCard: {
        backgroundColor: CARD_BG,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1.5,
        borderColor: GOLD,
        marginBottom: 14,
    },
    spotlightRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    spotlightTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: GOLD,
        marginBottom: 3,
    },
    spotlightSub: {
        fontSize: 12,
        color: TEXT_SUB,
        lineHeight: 16,
    },
    activateBtn: {
        backgroundColor: GOLD,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    activateBtnText: {
        fontSize: 13,
        fontWeight: '800',
        color: DARK_BG,
    },
    timerBadge: {
        backgroundColor: 'rgba(212,179,115,0.15)',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderWidth: 1,
        borderColor: GOLD,
    },
    timerText: {
        fontSize: 14,
        fontWeight: '800',
        color: GOLD,
    },

    // Quick Actions
    quickActionsCard: {
        backgroundColor: CARD_BG,
        borderRadius: 18,
        padding: 16,
        borderWidth: 1,
        borderColor: BORDER,
    },
    quickActionsTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: TEXT_PRIMARY,
        marginBottom: 12,
    },
    quickActionList: {
        gap: 10,
    },
    actionRowPrimary: {
        backgroundColor: '#262035',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: GOLD,
    },
    actionTitlePrimary: {
        fontSize: 15,
        fontWeight: '800',
        color: GOLD,
    },
    actionSubPrimary: {
        fontSize: 12,
        color: TEXT_SUB,
        marginTop: 2,
    },
    actionRowGold: {
        backgroundColor: 'rgba(212,179,115,0.1)',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: 'rgba(212,179,115,0.3)',
    },
    actionTitleGold: {
        fontSize: 15,
        fontWeight: '800',
        color: GOLD,
    },
    actionSubGold: {
        fontSize: 12,
        color: TEXT_SUB,
        marginTop: 2,
    },
    actionRowDark: {
        backgroundColor: '#14121e',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: BORDER,
    },
    actionTitleDark: {
        fontSize: 15,
        fontWeight: '800',
        color: TEXT_PRIMARY,
    },
    actionSubDark: {
        fontSize: 12,
        color: TEXT_SUB,
        marginTop: 2,
    },

    // Upgrade Membership Tab Styles
    upgradeHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    pageHeaderTitle: {
        fontSize: 22,
        fontWeight: '900',
        color: TEXT_PRIMARY,
    },
    needHelpText: {
        fontSize: 13,
        fontWeight: '700',
        color: GOLD,
        textDecorationLine: 'underline',
    },
    activePremiumHero: {
        backgroundColor: CARD_BG,
        borderRadius: 18,
        padding: 20,
        borderColor: GOLD,
        borderWidth: 1.5,
        marginBottom: 16,
    },
    activePremiumEyebrow: {
        fontSize: 11,
        fontWeight: '900',
        color: GOLD,
        letterSpacing: 0.8,
        marginBottom: 6,
    },
    activePremiumTitle: {
        fontSize: 20,
        fontWeight: '900',
        color: TEXT_PRIMARY,
        marginBottom: 6,
    },
    activePremiumBody: {
        fontSize: 13,
        color: TEXT_SUB,
        lineHeight: 19,
        marginBottom: 16,
    },
    creditsBox: {
        backgroundColor: 'rgba(212,179,115,0.1)',
        borderRadius: 14,
        padding: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(212,179,115,0.3)',
    },
    creditsNumber: {
        fontSize: 26,
        fontWeight: '900',
        color: GOLD,
        marginBottom: 2,
    },
    creditsLabel: {
        fontSize: 10,
        fontWeight: '800',
        color: TEXT_SUB,
        letterSpacing: 0.8,
    },
    toggleContainer: {
        flexDirection: 'row',
        backgroundColor: '#14121e',
        borderRadius: 30,
        padding: 4,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: BORDER,
    },
    toggleSegment: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 26,
        alignItems: 'center',
    },
    toggleSegmentActive: {
        backgroundColor: GOLD,
    },
    toggleText: {
        fontSize: 14,
        fontWeight: '700',
        color: TEXT_MUTED,
    },
    toggleTextActive: {
        color: DARK_BG,
        fontWeight: '800',
    },

    // Comparison Table
    tableContainer: {
        backgroundColor: CARD_BG,
        borderRadius: 18,
        padding: 14,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: BORDER,
    },
    tableHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
    },
    tableHeaderCellLeft: {
        flex: 1.4,
    },
    tableHeaderCell: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 6,
        position: 'relative',
    },
    selectedHeaderCell: {
        backgroundColor: 'rgba(212,179,115,0.12)',
        borderRadius: 10,
    },
    columnTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: TEXT_SUB,
        marginBottom: 6,
    },
    columnTitleActive: {
        color: GOLD,
    },
    topSellerTag: {
        backgroundColor: GOLD,
        borderRadius: 4,
        paddingHorizontal: 5,
        paddingVertical: 2,
        position: 'absolute',
        top: -12,
    },
    topSellerTagText: {
        fontSize: 8,
        fontWeight: '900',
        color: DARK_BG,
    },
    radioOuter: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: BORDER,
        alignItems: 'center',
        justifyContent: 'center',
    },
    radioOuterActive: {
        borderColor: GOLD,
    },
    radioInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: GOLD,
    },
    tableRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#1e1b2e',
    },
    rowLabelCell: {
        flex: 1.4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    rowLabelText: {
        fontSize: 12,
        fontWeight: '600',
        color: TEXT_PRIMARY,
    },
    infoIcon: {
        fontSize: 12,
        color: TEXT_MUTED,
    },
    rowValCell: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    activeValCell: {
        backgroundColor: 'rgba(212,179,115,0.12)',
        borderRadius: 6,
        paddingVertical: 4,
    },
    rowValText: {
        fontSize: 12,
        fontWeight: '700',
        color: TEXT_SUB,
    },
    rowValTextActive: {
        color: GOLD,
    },
    discountText: {
        fontSize: 12,
        fontWeight: '900',
        color: GOLD,
        textAlign: 'center',
        letterSpacing: 0.8,
        marginBottom: 16,
    },

    // Duration Grid
    durationTitle: {
        fontSize: 11,
        fontWeight: '900',
        color: TEXT_MUTED,
        textAlign: 'center',
        letterSpacing: 0.8,
        marginBottom: 10,
    },
    durationGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 16,
    },
    durationCard: {
        flex: 1,
        minWidth: '46%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: CARD_BG,
        borderRadius: 14,
        padding: 14,
        borderWidth: 1.5,
        borderColor: BORDER,
    },
    durationCardSelected: {
        borderColor: GOLD,
        backgroundColor: 'rgba(212,179,115,0.12)',
    },
    durationLabel: {
        fontSize: 13,
        fontWeight: '800',
        color: TEXT_PRIMARY,
    },
    durationLabelSelected: {
        color: GOLD,
    },

    // Checkout
    checkoutBtn: {
        backgroundColor: GOLD,
        borderRadius: 16,
        paddingVertical: 16,
        alignItems: 'center',
        marginBottom: 24,
        shadowColor: GOLD,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
    },
    checkoutBtnText: {
        fontSize: 16,
        fontWeight: '800',
        color: DARK_BG,
    },
    assistedBox: {
        backgroundColor: CARD_BG,
        borderRadius: 18,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: BORDER,
    },
    assistedTitle: {
        fontSize: 18,
        fontWeight: '900',
        color: GOLD,
        marginBottom: 4,
    },
    assistedSub: {
        fontSize: 13,
        color: TEXT_SUB,
        lineHeight: 18,
    },

    // Inbox Empty
    inboxHeader: {
        marginBottom: 20,
    },
    inboxTitle: {
        fontSize: 22,
        fontWeight: '900',
        color: TEXT_PRIMARY,
    },
    inboxSub: {
        fontSize: 13,
        color: TEXT_SUB,
        marginTop: 2,
    },
    inboxEmptyCard: {
        backgroundColor: CARD_BG,
        borderRadius: 18,
        padding: 30,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: BORDER,
    },
    inboxEmptyIcon: {
        fontSize: 40,
        marginBottom: 10,
    },
    inboxEmptyTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: TEXT_PRIMARY,
        marginBottom: 4,
    },
    inboxEmptySub: {
        fontSize: 13,
        color: TEXT_SUB,
        textAlign: 'center',
        lineHeight: 18,
    },

    // Modals
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
    },
    modalCard: {
        backgroundColor: CARD_BG,
        borderRadius: 20,
        padding: 22,
        width: '100%',
        maxWidth: 340,
        borderWidth: 1,
        borderColor: BORDER,
    },
    modalTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: TEXT_PRIMARY,
        marginBottom: 8,
    },
    modalBody: {
        fontSize: 13,
        color: TEXT_SUB,
        lineHeight: 18,
        marginBottom: 18,
    },
    modalBtns: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 10,
    },
    cancelBtn: {
        paddingHorizontal: 14,
        paddingVertical: 9,
    },
    cancelText: {
        fontSize: 13,
        fontWeight: '700',
        color: TEXT_MUTED,
    },
    confirmBtn: {
        backgroundColor: GOLD,
        borderRadius: 10,
        paddingHorizontal: 16,
        paddingVertical: 9,
    },
    confirmText: {
        fontSize: 13,
        fontWeight: '800',
        color: DARK_BG,
    },
});
