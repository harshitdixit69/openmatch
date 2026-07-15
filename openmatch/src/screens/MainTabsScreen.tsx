import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RealtimeChannel } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { subscribeToNotifications } from '../lib/notificationsApi';
import { supabase } from '../lib/supabase';

import { ChatMatch } from '../lib/chat';
import { fetchChatMatches, subscribeToInterestRequests, unsubscribeFromChannel, updateUserPresence } from '../lib/chatApi';
import { fetchPremiumAnalyticsSummary, PremiumAnalyticsSummary, trackPremiumEvent } from '../lib/premiumAnalytics';
import { getDisplayFirstName, ProfileRecord } from '../lib/profile';
import { fetchCurrentProfile } from '../lib/profileApi';
import { MatchCandidate } from '../lib/matchmaking';
import { fetchCompatibilitySnapshot } from '../lib/matchmakingApi';
import { MAX_CONTENT_WIDTH, TabBarSpacingContext } from '../lib/responsiveLayout';
import { ChatScreen } from './ChatScreen';
import { HomeScreen } from './HomeScreen';
import { ModerationQueueScreen } from './ModerationQueueScreen';
import { DashboardScreen } from './DashboardScreen';
import { MyMatchesScreen } from './MyMatchesScreen';
import { NotificationsScreen } from './NotificationsScreen';
import { PartnerPreferencesScreen } from './PartnerPreferencesScreen';
import { ProfileEditScreen } from './ProfileEditScreen';
import { SearchScreen } from './SearchScreen';
import { SettingsScreen } from './SettingsScreen';
import { ShortlistScreen } from './ShortlistScreen';
import { WhoViewedMeScreen } from './WhoViewedMeScreen';
import { MatchProfileScreen } from './MatchProfileScreen';


// Base height of the tab bar content (padding + tab button minHeight) before the
// device's bottom safe-area inset is added. Used to reserve space so scrollable
// screens never hide content behind the pinned tab bar.
const TAB_BAR_BASE_HEIGHT = 64;

type AppTab = 'home' | 'matches' | 'inbox' | 'chat' | 'premium' | 'moderation';

type ShellCounts = {
    total: number;
    unread: number;
    received: number;
    accepted: number;
    contacts: number;
    sent: number;
};

const emptyShellCounts: ShellCounts = {
    total: 0,
    unread: 0,
    received: 0,
    accepted: 0,
    contacts: 0,
    sent: 0,
};

export function MainTabsScreen() {
    const [activeTab, setActiveTab] = useState<AppTab>('matches');
    const [shellLoading, setShellLoading] = useState(true);
    const [viewerFirstName, setViewerFirstName] = useState('');
    const [shellCounts, setShellCounts] = useState<ShellCounts>(emptyShellCounts);
    const [isAdmin, setIsAdmin] = useState(false);
    const [showPartnerPrefs, setShowPartnerPrefs] = useState(false);
    const [showProfileEdit, setShowProfileEdit] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const [showShortlist, setShowShortlist] = useState(false);
    const [showMyMatches, setShowMyMatches] = useState(false);
    const [showWhoViewedMe, setShowWhoViewedMe] = useState(false);
    const [showNotifications, setShowNotifications] = useState(false);
    const [showDashboard, setShowDashboard] = useState(false);
    const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
    const insets = useSafeAreaInsets();
    // Debounce ref: track the last time loadShellData was triggered by a tab
    // switch so rapid tab changes don't fire multiple heavy fetchChatMatches calls.
    const lastTabLoadAt = useRef<number>(0);

    // Android back button: dismiss the topmost open modal instead of exiting the app.
    useEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', () => {
            if (selectedProfileId) { setSelectedProfileId(null); return true; }
            if (showDashboard) { setShowDashboard(false); return true; }
            if (showNotifications) { setShowNotifications(false); return true; }
            if (showWhoViewedMe) { setShowWhoViewedMe(false); return true; }
            if (showMyMatches) { setShowMyMatches(false); return true; }
            if (showShortlist) { setShowShortlist(false); return true; }
            if (showSearch) { setShowSearch(false); return true; }
            if (showSettings) { setShowSettings(false); return true; }
            if (showProfileEdit) { setShowProfileEdit(false); return true; }
            if (showPartnerPrefs) { setShowPartnerPrefs(false); return true; }
            return false;
        });
        return () => handler.remove();
    }, [selectedProfileId, showDashboard, showNotifications, showWhoViewedMe, showMyMatches, showShortlist, showSearch, showSettings, showProfileEdit, showPartnerPrefs]);

    // Keep the home-indicator clear on notched devices while still leaving a
    // comfortable tap area on phones without a bottom inset.
    const tabBarBottomPadding = insets.bottom > 0 ? insets.bottom + 6 : 16;
    // Total space the tab bar reserves, shared with child screens via context.
    const tabBarSpacing = TAB_BAR_BASE_HEIGHT + insets.bottom;
    useEffect(() => {
        let isMounted = true;
        let heartbeatInterval: any = null;

        async function triggerPresence(status: 'online' | 'offline') {
            try {
                await updateUserPresence(status);
            } catch (err) {
                console.warn('Failed to update presence state:', err);
            }
        }

        function startHeartbeat() {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            void triggerPresence('online');
            heartbeatInterval = setInterval(() => {
                if (isMounted) {
                    void triggerPresence('online');
                }
            }, 30000);
        }

        function stopHeartbeat() {
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
                heartbeatInterval = null;
            }
            void triggerPresence('offline');
        }

        startHeartbeat();

        const appStateSub = AppState.addEventListener('change', (nextState) => {
            if (!isMounted) return;
            if (nextState === 'active') {
                startHeartbeat();
            } else if (nextState === 'background' || nextState === 'inactive') {
                stopHeartbeat();
            }
        });

        return () => {
            isMounted = false;
            stopHeartbeat();
            appStateSub.remove();
        };
    }, []);

    useEffect(() => {
        void loadShellData();
    }, []);

    useEffect(() => {
        let mounted = true;
        let channel: RealtimeChannel | null = null;

        async function setupSubscription() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user || !mounted) return;

            channel = subscribeToNotifications(user.id, async (n) => {
                if (!mounted) return;

                // Load notification settings from AsyncStorage
                try {
                    const saved = await AsyncStorage.getItem(`openmatch:notifPrefs:${user.id}`);
                    const prefs = saved ? JSON.parse(saved) : null;
                    
                    // Map notification type to preference key
                    let isEnabled = true;
                    if (prefs) {
                        if (n.type === 'message_received') {
                            isEnabled = prefs.new_messages !== false;
                        } else if (n.type === 'new_match') {
                            isEnabled = prefs.new_matches !== false;
                        } else if (n.type === 'request_accepted' || n.type === 'request_received') {
                            isEnabled = prefs.request_accepted !== false;
                        } else if (n.type === 'request_ghosted') {
                            isEnabled = prefs.ghosting_reminders !== false;
                        } else if (n.type === 'system') {
                            isEnabled = prefs.broker_calls !== false;
                        }
                    }

                    if (isEnabled) {
                        // Alert foreground popup
                        if (Platform.OS === 'web') {
                            alert(`${n.title}\n\n${n.body}`);
                        } else {
                            Alert.alert(n.title, n.body);
                        }
                    }
                } catch (err) {
                    console.warn('Failed to parse notification preferences in subscription:', err);
                }
            });
        }

        void setupSubscription();

        return () => {
            mounted = false;
            if (channel) {
                channel.unsubscribe();
            }
        };
    }, []);

    useEffect(() => {
        // Skip the very first render (handled by the mount effect above) and
        // avoid re-fetching if we already loaded within the last 5 seconds.
        const now = Date.now();
        if (now - lastTabLoadAt.current < 5000) return;
        lastTabLoadAt.current = now;
        void loadShellData();
    }, [activeTab]);

    useEffect(() => {
        let isMounted = true;
        const channel = subscribeToInterestRequests(() => {
            if (!isMounted) {
                return;
            }

            void loadShellData();
        });

        // Poll every 45s instead of 20s — realtime subscriptions handle
        // immediate changes; the interval is only a staleness safety net.
        const intervalId = setInterval(() => {
            if (!isMounted) {
                return;
            }

            void loadShellData();
        }, 45000);

        return () => {
            isMounted = false;
            clearInterval(intervalId);
            void unsubscribeFromChannel(channel as RealtimeChannel);
        };
    }, []);

    async function loadShellData() {
        lastTabLoadAt.current = Date.now();
        try {
            const [profile, matches] = await Promise.all([
                fetchCurrentProfile().catch(() => null),
                fetchChatMatches().catch(() => [] as ChatMatch[]),
            ]);

            setViewerFirstName(getDisplayFirstName(profile?.full_name));
            setShellCounts(buildShellCounts(matches));
            setIsAdmin(profile?.is_admin === true);
        } catch (error) {
            console.warn('Failed to refresh main tab summary.', error);
        } finally {
            setShellLoading(false);
        }
    }

    const tabItems = useMemo(
        () => {
            const items: { label: string; subtitle: string; value: AppTab; badge: number | undefined; disabled: boolean }[] = [
                { label: 'Home', subtitle: 'Dashboard', value: 'home' as const, badge: undefined, disabled: false },
                { label: 'Matches', subtitle: 'Feed', value: 'matches' as const, badge: undefined, disabled: false },
                {
                    label: 'Inbox',
                    subtitle: 'Requests',
                    value: 'inbox' as const,
                    badge: shellCounts.received > 0 ? shellCounts.received : undefined,
                    disabled: false,
                },
                {
                    label: 'Chat',
                    subtitle: 'Active',
                    value: 'chat' as const,
                    badge: shellCounts.unread > 0 ? shellCounts.unread : undefined,
                    disabled: false,
                },
                { label: 'Premium', subtitle: 'Insights', value: 'premium' as const, badge: undefined, disabled: false },
            ];

            if (isAdmin) {
                items.push({
                    label: 'Moderate',
                    subtitle: 'Queue',
                    value: 'moderation' as const,
                    badge: undefined,
                    disabled: false,
                });
            }

            return items;
        },
        [shellCounts.contacts, shellCounts.received, shellCounts.unread, isAdmin],
    );

    function openTab(tab: AppTab) {
        setActiveTab(tab);
    }

    function renderActiveTab() {
        if (activeTab === 'home') {
            return (
                <HomeHubTab
                    loading={shellLoading}
                    viewerFirstName={viewerFirstName}
                    counts={shellCounts}
                    onOpenMatches={() => openTab('matches')}
                    onOpenInbox={() => openTab('inbox')}
                    onOpenChat={() => openTab('chat')}
                    onOpenPremium={() => openTab('premium')}
                    onOpenPartnerPrefs={() => setShowPartnerPrefs(true)}
                    onOpenProfileEdit={() => setShowProfileEdit(true)}
                    onOpenSettings={() => setShowSettings(true)}
                    onOpenSearch={() => setShowSearch(true)}
                    onOpenShortlist={() => setShowShortlist(true)}
                    onOpenMyMatches={() => setShowMyMatches(true)}
                    onOpenWhoViewedMe={() => setShowWhoViewedMe(true)}
                    onOpenNotifications={() => setShowNotifications(true)}
                    onOpenDashboard={() => setShowDashboard(true)}
                />
            );
        }

        if (activeTab === 'matches') {
            return <HomeScreen />;
        }

        if (activeTab === 'inbox') {
            return (
                <ChatScreen
                    key="inbox-tab"
                    onClose={() => openTab('matches')}
                    initialMatchListFilter="received"
                    initialVisibilityFilter="all"
                    isChatScreen={false}
                    onViewProfile={(profileId) => setSelectedProfileId(profileId)}
                />
            );
        }

        if (activeTab === 'chat') {
            return (
                <ChatScreen
                    key="chat-tab"
                    onClose={() => openTab('matches')}
                    initialMatchListFilter="accepted"
                    initialVisibilityFilter={shellCounts.unread > 0 ? 'unread' : 'all'}
                    isChatScreen={true}
                    onViewProfile={(profileId) => setSelectedProfileId(profileId)}
                />
            );
        }

        if (activeTab === 'moderation') {
            return (
                <ModerationQueueScreen
                    onClose={() => openTab('home')}
                />
            );
        }

        return <PremiumTab onOpenMatches={() => openTab('matches')} onOpenInbox={() => openTab('inbox')} />;
    }

    if (showPartnerPrefs) {
        return <PartnerPreferencesScreen onBack={() => setShowPartnerPrefs(false)} />;
    }

    if (showProfileEdit) {
        return <ProfileEditScreen onBack={() => setShowProfileEdit(false)} />;
    }

    if (showSettings) {
        return <SettingsScreen onBack={() => setShowSettings(false)} onSignedOut={() => { }} />;
    }

    if (showSearch) {
        return (
            <SearchScreen
                onBack={() => setShowSearch(false)}
                onSelectCandidate={() => setShowSearch(false)}
            />
        );
    }

    if (showShortlist) {
        return (
            <ShortlistScreen
                onBack={() => setShowShortlist(false)}
                onSelectCandidate={() => setShowShortlist(false)}
            />
        );
    }

    if (showMyMatches) {
        return (
            <MyMatchesScreen
                onBack={() => setShowMyMatches(false)}
                onOpenChat={(match) => {
                    setShowMyMatches(false);
                    setActiveTab('chat');
                }}
            />
        );
    }

    if (showWhoViewedMe) {
        return (
            <WhoViewedMeScreen
                onBack={() => setShowWhoViewedMe(false)}
            />
        );
    }

    if (showNotifications) {
        return (
            <NotificationsScreen
                onBack={() => setShowNotifications(false)}
            />
        );
    }

    if (showDashboard) {
        return (
            <DashboardScreen
                onBack={() => setShowDashboard(false)}
            />
        );
    }

    return (
        <TabBarSpacingContext.Provider value={tabBarSpacing}>
            <View style={styles.shell}>
                <View
                    style={[
                        styles.contentArea,
                        // Home & Premium hubs render their own top SafeAreaView.
                        // Matches/Inbox/Chat previously relied on the (now removed)
                        // utility bar for notch spacing, so add the top inset here.
                        activeTab === 'matches' || activeTab === 'inbox' || activeTab === 'chat'
                            ? { paddingTop: insets.top }
                            : null,
                    ]}
                >
                    {renderActiveTab()}
                    {/* Floating search button on the Matches tab */}
                    {activeTab === 'matches' && (
                        <Pressable
                            style={[styles.fab, { bottom: tabBarSpacing + 16 }]}
                            onPress={() => setShowSearch(true)}
                        >
                            <Text style={styles.fabText}>⌕</Text>
                        </Pressable>
                    )}
                </View>

                <View style={[styles.tabBar, { paddingBottom: tabBarBottomPadding }]}>
                    {tabItems.map((tab) => (
                        <TabButton
                            key={tab.value}
                            label={tab.label}
                            subtitle={tab.subtitle}
                            badge={tab.badge}
                            disabled={tab.disabled}
                            active={activeTab === tab.value}
                            onPress={() => openTab(tab.value)}
                        />
                    ))}
                </View>

                <Modal
                    transparent={false}
                    animationType="slide"
                    visible={Boolean(selectedProfileId)}
                    onRequestClose={() => setSelectedProfileId(null)}
                >
                    {selectedProfileId ? (
                        <MatchProfileScreenModal
                            profileId={selectedProfileId}
                            onClose={() => setSelectedProfileId(null)}
                            onOpenChat={(otherUserId) => {
                                setSelectedProfileId(null);
                                setActiveTab('chat');
                            }}
                        />
                    ) : null}
                </Modal>
            </View>
        </TabBarSpacingContext.Provider>
    );
}

type TabButtonProps = {
    label: string;
    subtitle: string;
    badge?: number;
    disabled?: boolean;
    active: boolean;
    onPress: () => void;
};

function TabButton({ label, subtitle, badge, disabled = false, active, onPress }: TabButtonProps) {
    return (
        <Pressable
            style={[styles.tabButton, active ? styles.tabButtonActive : null, disabled ? styles.tabButtonDisabled : null]}
            onPress={onPress}
            disabled={disabled}
        >
            {badge ? (
                <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{badge > 99 ? '99+' : String(badge)}</Text>
                </View>
            ) : null}
            <Text
                style={[
                    styles.tabLabel,
                    active ? styles.tabLabelActive : null,
                    disabled && !active ? styles.tabLabelDisabled : null,
                ]}
            >
                {label}
            </Text>
        </Pressable>
    );
}

function HomeHubTab({
    loading,
    viewerFirstName,
    counts,
    onOpenMatches,
    onOpenInbox,
    onOpenChat,
    onOpenPremium,
    onOpenPartnerPrefs,
    onOpenProfileEdit,
    onOpenSettings,
    onOpenSearch,
    onOpenShortlist,
    onOpenMyMatches,
    onOpenWhoViewedMe,
    onOpenNotifications,
    onOpenDashboard,
}: {
    loading: boolean;
    viewerFirstName: string;
    counts: ShellCounts;
    onOpenMatches: () => void;
    onOpenInbox: () => void;
    onOpenChat: () => void;
    onOpenPremium: () => void;
    onOpenPartnerPrefs: () => void;
    onOpenProfileEdit: () => void;
    onOpenSettings: () => void;
    onOpenSearch: () => void;
    onOpenShortlist: () => void;
    onOpenMyMatches: () => void;
    onOpenWhoViewedMe: () => void;
    onOpenNotifications: () => void;
    onOpenDashboard: () => void;
}) {
    return (
        <SafeAreaView style={styles.panelSafeArea} edges={['top', 'left', 'right']}>
            <ScrollView contentContainerStyle={styles.panelScrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.heroCard}>
                    <View style={styles.heroCardHeader}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.heroEyebrow}>OpenMatch</Text>
                            <Text style={styles.heroTitle}>{viewerFirstName ? `Welcome back, ${viewerFirstName}` : 'Welcome back'}</Text>
                        </View>
                        <Pressable onPress={onOpenSettings} style={styles.settingsBtn}>
                            <Text style={styles.settingsBtnText}>⚙</Text>
                        </Pressable>
                    </View>
                    <Text style={styles.heroBody}>
                        Keep track of fresh matches, pending requests, and unlocked conversations without hiding the core journey behind a subscription wall.
                    </Text>
                </View>

                {loading ? (
                    <View style={styles.summaryLoadingCard}>
                        <ActivityIndicator size="small" color="#123340" />
                        <Text style={styles.summaryLoadingText}>Refreshing your tab summary...</Text>
                    </View>
                ) : (
                    <View style={styles.summaryGrid}>
                        <SummaryCard label="Requests" value={counts.received} tone="accent" />
                        <SummaryCard label="Unread" value={counts.unread} tone="primary" />
                        <SummaryCard label="Unlocked" value={counts.contacts} tone="neutral" />
                        <SummaryCard label="Active" value={counts.total} tone="neutral" />
                    </View>
                )}

                <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>Jump back in</Text>
                    <View style={styles.quickActionGrid}>
                        <QuickActionButton label="Open matches" subtitle="See your ranked feed" tone="primary" onPress={onOpenMatches} />
                        <QuickActionButton label="My matches" subtitle="All connected profiles" tone="primary" onPress={onOpenMyMatches} />
                        <QuickActionButton label="Who viewed me" subtitle="Recent profile visitors" tone="accent" onPress={onOpenWhoViewedMe} />
                        <QuickActionButton label="Notifications" subtitle="All your recent alerts" tone="neutral" onPress={onOpenNotifications} />
                        <QuickActionButton label="My dashboard" subtitle="Stats & trust scores" tone="neutral" onPress={onOpenDashboard} />
                        <QuickActionButton label="Search profiles" subtitle="Filter by age, religion…" tone="primary" onPress={onOpenSearch} />
                        <QuickActionButton label="Saved profiles" subtitle="Your bookmarks" tone="neutral" onPress={onOpenShortlist} />
                        <QuickActionButton label="Review inbox" subtitle="Handle fresh requests" tone="accent" onPress={onOpenInbox} />
                        <QuickActionButton label="Continue chat" subtitle="Focus on active threads" tone="neutral" onPress={onOpenChat} />
                        <QuickActionButton label="Edit profile" subtitle="Update your details" tone="neutral" onPress={onOpenProfileEdit} />
                        <QuickActionButton label="Edit preferences" subtitle="Refine match filters" tone="neutral" onPress={onOpenPartnerPrefs} />
                        <QuickActionButton label="See premium" subtitle="Fair-pay extras only" tone="neutral" onPress={onOpenPremium} />
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

function PremiumTab({ onOpenMatches, onOpenInbox }: { onOpenMatches: () => void; onOpenInbox: () => void }) {
    const [loadingSummary, setLoadingSummary] = useState(true);
    const [analyticsSummary, setAnalyticsSummary] = useState<PremiumAnalyticsSummary | null>(null);

    useEffect(() => {
        let isMounted = true;

        void trackPremiumEvent({
            eventName: 'premium_promo_impression',
            surface: 'premium_tab',
            context: 'tab_open',
        });

        void (async () => {
            const summary = await fetchPremiumAnalyticsSummary(14);
            if (!isMounted) {
                return;
            }

            setAnalyticsSummary(summary);
            setLoadingSummary(false);
        })();

        return () => {
            isMounted = false;
        };
    }, []);

    return (
        <SafeAreaView style={styles.panelSafeArea} edges={['top', 'left', 'right']}>
            <ScrollView contentContainerStyle={styles.panelScrollContent} showsVerticalScrollIndicator={false}>
                <View style={[styles.heroCard, styles.premiumHeroCard]}>
                    <Text style={styles.heroEyebrow}>Premium</Text>
                    <Text style={styles.heroTitle}>Fair-pay upgrades, not lockouts</Text>
                    <Text style={styles.heroBody}>
                        Premium surfaces can spotlight serious profiles and concierge-style help, but matching, escrow chat, and mutual unlock stay usable for free users.
                    </Text>
                </View>

                <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>Premium analytics snapshot</Text>

                    {loadingSummary ? (
                        <View style={styles.summaryLoadingCard}>
                            <ActivityIndicator size="small" color="#123340" />
                            <Text style={styles.summaryLoadingText}>Loading recent premium events...</Text>
                        </View>
                    ) : analyticsSummary ? (
                        <>
                            <View style={styles.summaryGrid}>
                                <SummaryCard label="Impressions" value={analyticsSummary.totalImpressions} tone="neutral" />
                                <SummaryCard label="CTA taps" value={analyticsSummary.totalCtaTaps} tone="accent" />
                                <SummaryCard label="CTR %" value={Number(analyticsSummary.totalCtrPercent.toFixed(1))} tone="primary" />
                                <SummaryCard label="Highlight opens" value={analyticsSummary.highlightOpens} tone="neutral" />
                            </View>

                            <View style={styles.featureRow}>
                                <View style={styles.featureDot} />
                                <View style={styles.featureCopy}>
                                    <Text style={styles.featureTitle}>Top variant</Text>
                                    <Text style={styles.featureBody}>{analyticsSummary.topVariant ?? 'No variant data yet'}</Text>
                                </View>
                            </View>

                            <View style={styles.featureRow}>
                                <View style={styles.featureDot} />
                                <View style={styles.featureCopy}>
                                    <Text style={styles.featureTitle}>By surface</Text>
                                    <Text style={styles.featureBody}>
                                        Home: {analyticsSummary.bySurface.home_feed.impressions} imp / {analyticsSummary.bySurface.home_feed.ctaTaps} taps ({analyticsSummary.bySurface.home_feed.ctrPercent}%)
                                    </Text>
                                    <Text style={styles.featureBody}>
                                        Inbox: {analyticsSummary.bySurface.chat_inbox.impressions} imp / {analyticsSummary.bySurface.chat_inbox.ctaTaps} taps ({analyticsSummary.bySurface.chat_inbox.ctrPercent}%)
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.featureRow}>
                                <View style={styles.featureDot} />
                                <View style={styles.featureCopy}>
                                    <Text style={styles.featureTitle}>A/B arm CTR</Text>
                                    <Text style={styles.featureBody}>
                                        Arm A: {analyticsSummary.byExperimentArm.A.impressions} imp / {analyticsSummary.byExperimentArm.A.ctaTaps} taps ({analyticsSummary.byExperimentArm.A.ctrPercent}%)
                                    </Text>
                                    <Text style={styles.featureBody}>
                                        Arm B: {analyticsSummary.byExperimentArm.B.impressions} imp / {analyticsSummary.byExperimentArm.B.ctaTaps} taps ({analyticsSummary.byExperimentArm.B.ctrPercent}%)
                                    </Text>
                                </View>
                            </View>
                        </>
                    ) : (
                        <Text style={styles.featureBody}>Premium analytics will appear here once events are generated.</Text>
                    )}
                </View>

                <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>What this tab can grow into</Text>
                    <FeatureRow title="VIP profile styling" body="Highlighted profile treatments that improve visibility without forcing contact access." />
                    <FeatureRow title="Priority discovery" body="Editorially surfaced suggestions and premium presentation cards, not coercive paywalls." />
                    <FeatureRow title="Conversion moments" body="Contextual premium placements that sit beside the fair unlock model instead of replacing it." />
                </View>

                <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>Keep the core flow moving</Text>
                    <View style={styles.quickActionGrid}>
                        <QuickActionButton label="Back to matches" subtitle="Continue discovery" tone="primary" onPress={onOpenMatches} />
                        <QuickActionButton label="Back to inbox" subtitle="Reply to requests" tone="accent" onPress={onOpenInbox} />
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: 'primary' | 'accent' | 'neutral' }) {
    return (
        <View
            style={[
                styles.summaryCard,
                tone === 'primary' ? styles.summaryCardPrimary : tone === 'accent' ? styles.summaryCardAccent : styles.summaryCardNeutral,
            ]}
        >
            <Text
                style={[
                    styles.summaryValue,
                    tone === 'primary' ? styles.summaryValuePrimary : tone === 'accent' ? styles.summaryValueAccent : styles.summaryValueNeutral,
                ]}
            >
                {value}
            </Text>
            <Text
                style={[
                    styles.summaryLabel,
                    tone === 'primary' ? styles.summaryLabelPrimary : tone === 'accent' ? styles.summaryLabelAccent : styles.summaryLabelNeutral,
                ]}
            >
                {label}
            </Text>
        </View>
    );
}

function QuickActionButton({
    label,
    subtitle,
    tone,
    onPress,
}: {
    label: string;
    subtitle: string;
    tone: 'primary' | 'accent' | 'neutral';
    onPress: () => void;
}) {
    return (
        <Pressable
            style={[
                styles.quickActionButton,
                tone === 'primary'
                    ? styles.quickActionButtonPrimary
                    : tone === 'accent'
                        ? styles.quickActionButtonAccent
                        : styles.quickActionButtonNeutral,
            ]}
            onPress={onPress}
        >
            <Text
                style={[
                    styles.quickActionLabel,
                    tone === 'primary'
                        ? styles.quickActionLabelPrimary
                        : tone === 'accent'
                            ? styles.quickActionLabelAccent
                            : styles.quickActionLabelNeutral,
                ]}
            >
                {label}
            </Text>
            <Text
                style={[
                    styles.quickActionSubtitle,
                    tone === 'primary'
                        ? styles.quickActionSubtitlePrimary
                        : tone === 'accent'
                            ? styles.quickActionSubtitleAccent
                            : styles.quickActionSubtitleNeutral,
                ]}
            >
                {subtitle}
            </Text>
        </Pressable>
    );
}

function FeatureRow({ title, body }: { title: string; body: string }) {
    return (
        <View style={styles.featureRow}>
            <View style={styles.featureDot} />
            <View style={styles.featureCopy}>
                <Text style={styles.featureTitle}>{title}</Text>
                <Text style={styles.featureBody}>{body}</Text>
            </View>
        </View>
    );
}

function buildShellCounts(matches: ChatMatch[]): ShellCounts {
    return matches.reduce<ShellCounts>(
        (counts, match) => {
            counts.total += 1;
            counts.unread += match.unreadCount;

            if (match.isUnlocked) {
                counts.contacts += 1;
            } else if (match.matchRequestState === 'received' || match.unlockState.canAccept) {
                counts.received += 1;
            } else if (
                match.matchRequestState === 'sent' ||
                match.interestRequest?.status === 'declined' ||
                match.unlockState.waitingOn === 'other_acceptance' ||
                match.unlockState.waitingOn === 'other_payment'
            ) {
                counts.sent += 1;
            } else if (
                match.interestRequest?.status === 'accepted' ||
                match.interestRequest?.status === 'ghosted' ||
                match.status === 'connected'
            ) {
                counts.accepted += 1;
            } else {
                counts.accepted += 1;
            }

            return counts;
        },
        { ...emptyShellCounts },
    );
}

const styles = StyleSheet.create({
    shell: {
        alignItems: 'center',
        backgroundColor: '#eef4f2',
        flex: 1,
    },
    utilityBar: {
        alignItems: 'center',
        alignSelf: 'center',
        backgroundColor: '#fffaf5',
        borderBottomColor: '#d7e1e2',
        borderBottomWidth: 1,
        flexDirection: 'row',
        gap: 10,
        maxWidth: MAX_CONTENT_WIDTH,
        paddingHorizontal: 14,
        paddingVertical: 10,
        width: '100%',
    },
    utilityMenuButton: {
        backgroundColor: '#edf3f2',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    utilityMenuButtonText: {
        color: '#35525b',
        fontSize: 12,
        fontWeight: '800',
    },
    utilityCenterCopy: {
        flex: 1,
        gap: 1,
    },
    utilityTitle: {
        color: '#14313a',
        fontSize: 15,
        fontWeight: '800',
    },
    utilitySubtitle: {
        color: '#5d6d71',
        fontSize: 11,
        fontWeight: '600',
    },
    utilityActionsRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
    },
    utilityActionButton: {
        alignItems: 'center',
        backgroundColor: '#edf3f2',
        borderRadius: 999,
        flexDirection: 'row',
        gap: 6,
        paddingHorizontal: 11,
        paddingVertical: 8,
    },
    utilityActionButtonText: {
        color: '#35525b',
        fontSize: 12,
        fontWeight: '800',
    },
    utilityBadge: {
        backgroundColor: '#d9643d',
        borderRadius: 999,
        minWidth: 20,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    utilityBadgeText: {
        color: '#ffffff',
        fontSize: 10,
        fontWeight: '800',
        textAlign: 'center',
    },
    contentArea: {
        alignSelf: 'center',
        flex: 1,
        // `minHeight: 0` + `overflow: hidden` stop a tall child screen from
        // growing past its flex share and pushing the tab bar up into the
        // middle of the viewport (the original web-preview bug). Child screens
        // scroll within this bounded area instead.
        minHeight: 0,
        maxWidth: MAX_CONTENT_WIDTH,
        overflow: 'hidden',
        width: '100%',
    },
    tabBar: {
        alignSelf: 'center',
        backgroundColor: '#fffaf5',
        borderTopColor: '#d7e1e2',
        borderTopWidth: 1,
        flexDirection: 'row',
        gap: 8,
        maxWidth: MAX_CONTENT_WIDTH,
        paddingHorizontal: 12,
        paddingTop: 12,
        width: '100%',
    },
    fab: {
        position: 'absolute',
        right: 20,
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#123340',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
        elevation: 6,
    },
    fabText: { fontSize: 24, color: '#fff', lineHeight: 28 },
    tabButton: {
        alignItems: 'center',
        backgroundColor: '#edf3f2',
        borderRadius: 18,
        flex: 1,
        gap: 2,
        justifyContent: 'center',
        minHeight: 44,
        paddingHorizontal: 4,
        paddingVertical: 8,
        position: 'relative',
    },
    tabButtonActive: {
        backgroundColor: '#14313a',
    },
    tabButtonDisabled: {
        backgroundColor: '#f5f0ea',
        opacity: 0.88,
    },
    tabBadge: {
        alignItems: 'center',
        backgroundColor: '#d9643d',
        borderRadius: 999,
        justifyContent: 'center',
        minWidth: 20,
        paddingHorizontal: 6,
        paddingVertical: 3,
        position: 'absolute',
        right: 6,
        top: 6,
    },
    tabBadgeText: {
        color: '#ffffff',
        fontSize: 10,
        fontWeight: '800',
    },
    tabLabel: {
        color: '#35525b',
        fontSize: 12,
        fontWeight: '800',
    },
    tabLabelActive: {
        color: '#ffffff',
    },
    tabLabelDisabled: {
        color: '#8b8f95',
    },
    tabSubtitle: {
        color: '#6c8085',
        fontSize: 10,
        fontWeight: '700',
    },
    tabSubtitleActive: {
        color: '#c7d6d8',
    },
    tabSubtitleDisabled: {
        color: '#a8a0a0',
    },
    panelSafeArea: {
        backgroundColor: '#eef4f2',
        flex: 1,
    },
    panelScrollContent: {
        gap: 14,
        paddingBottom: 20,
        paddingHorizontal: 20,
        paddingTop: 16,
    },
    heroCard: {
        backgroundColor: '#14313a',
        borderRadius: 28,
        gap: 10,
        padding: 22,
    },
    premiumHeroCard: {
        backgroundColor: '#29464f',
    },
    heroEyebrow: {
        color: '#f1c57b',
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    heroCardHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 4,
    },
    settingsBtn: {
        padding: 4,
        marginLeft: 8,
    },
    settingsBtnText: {
        fontSize: 22,
        color: 'rgba(255,255,255,0.6)',
    },
    heroTitle: {
        color: '#ffffff',
        fontSize: 28,
        fontWeight: '800',
    },
    heroBody: {
        color: '#d5e2e4',
        fontSize: 15,
        lineHeight: 22,
    },
    summaryLoadingCard: {
        alignItems: 'center',
        backgroundColor: '#ffffff',
        borderColor: '#d6e1df',
        borderRadius: 22,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 10,
        padding: 18,
    },
    summaryLoadingText: {
        color: '#35525b',
        fontSize: 14,
        fontWeight: '700',
    },
    summaryGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    summaryCard: {
        borderRadius: 22,
        flexBasis: '47%',
        flexGrow: 1,
        gap: 6,
        padding: 18,
    },
    summaryCardPrimary: {
        backgroundColor: '#14313a',
    },
    summaryCardAccent: {
        backgroundColor: '#f0e2d2',
    },
    summaryCardNeutral: {
        backgroundColor: '#ffffff',
        borderColor: '#d6e1df',
        borderWidth: 1,
    },
    summaryValue: {
        fontSize: 28,
        fontWeight: '800',
    },
    summaryValuePrimary: {
        color: '#ffffff',
    },
    summaryValueAccent: {
        color: '#7a4a2c',
    },
    summaryValueNeutral: {
        color: '#14313a',
    },
    summaryLabel: {
        fontSize: 13,
        fontWeight: '700',
    },
    summaryLabelPrimary: {
        color: '#c7d6d8',
    },
    summaryLabelAccent: {
        color: '#7a4a2c',
    },
    summaryLabelNeutral: {
        color: '#5d6d71',
    },
    sectionCard: {
        backgroundColor: '#ffffff',
        borderColor: '#d6e1df',
        borderRadius: 24,
        borderWidth: 1,
        gap: 14,
        padding: 18,
    },
    sectionTitle: {
        color: '#14313a',
        fontSize: 18,
        fontWeight: '800',
    },
    quickActionGrid: {
        gap: 10,
    },
    quickActionButton: {
        borderRadius: 20,
        gap: 4,
        padding: 16,
    },
    quickActionButtonPrimary: {
        backgroundColor: '#14313a',
    },
    quickActionButtonAccent: {
        backgroundColor: '#f0e2d2',
    },
    quickActionButtonNeutral: {
        backgroundColor: '#edf3f2',
    },
    quickActionLabel: {
        fontSize: 15,
        fontWeight: '800',
    },
    quickActionLabelPrimary: {
        color: '#ffffff',
    },
    quickActionLabelAccent: {
        color: '#744a33',
    },
    quickActionLabelNeutral: {
        color: '#244049',
    },
    quickActionSubtitle: {
        fontSize: 13,
        lineHeight: 19,
    },
    quickActionSubtitlePrimary: {
        color: '#c7d6d8',
    },
    quickActionSubtitleAccent: {
        color: '#7a4a2c',
    },
    quickActionSubtitleNeutral: {
        color: '#5d6d71',
    },
    featureRow: {
        flexDirection: 'row',
        gap: 12,
    },
    featureDot: {
        backgroundColor: '#d9643d',
        borderRadius: 999,
        height: 10,
        marginTop: 7,
        width: 10,
    },
    featureCopy: {
        flex: 1,
        gap: 4,
    },
    featureTitle: {
        color: '#14313a',
        fontSize: 15,
        fontWeight: '800',
    },
    featureBody: {
        color: '#5d6d71',
        fontSize: 14,
        lineHeight: 21,
    },
});

function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

type MatchProfileScreenModalProps = {
    profileId: string;
    onClose: () => void;
    onOpenChat?: (otherUserId: string) => void;
};

function MatchProfileScreenModal({
    profileId,
    onClose,
    onOpenChat,
}: MatchProfileScreenModalProps) {
    const [candidate, setCandidate] = useState<MatchCandidate | null>(null);
    const [loading, setLoading] = useState(true);
    const [viewerProfile, setViewerProfile] = useState<ProfileRecord | null>(null);
    const [compatibilitySummary, setCompatibilitySummary] = useState<string | null>(null);
    const [fitPoints, setFitPoints] = useState<string[]>([]);
    const [frictionPoints, setFrictionPoints] = useState<string[]>([]);
    const [summaryLoading, setSummaryLoading] = useState(false);

    useEffect(() => {
        let active = true;

        async function load() {
            setLoading(true);
            try {
                const { data: pData, error: pErr } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', profileId)
                    .single();
                if (pErr) throw pErr;

                const { data: locData } = await supabase
                    .from('profile_locations')
                    .select('latitude, longitude')
                    .eq('profile_id', profileId)
                    .maybeSingle();
                
                const vProfile = await fetchCurrentProfile();
                
                let distance_km: number | null = null;
                if (locData && vProfile) {
                    const { data: vLoc } = await supabase
                        .from('profile_locations')
                        .select('latitude, longitude')
                        .eq('profile_id', vProfile.id)
                        .maybeSingle();
                    if (vLoc) {
                        distance_km = calculateHaversineDistance(
                            vLoc.latitude,
                            vLoc.longitude,
                            locData.latitude,
                            locData.longitude
                        );
                    }
                }

                if (active) {
                    setViewerProfile(vProfile);
                    setCandidate({
                        id: pData.id,
                        full_name: pData.full_name,
                        gender: pData.gender,
                        dob: pData.dob,
                        location: pData.location,
                        bio: pData.bio,
                        preferences: pData.preferences,
                        photo_urls: pData.photo_urls || [],
                        height_cm: pData.height_cm,
                        profile_owner: pData.profile_owner,
                        partner_gender_preference: pData.partner_gender_preference,
                        similarity: 0.8,
                        distance_km,
                        verification_status: pData.verification_status,
                    });
                }

                setSummaryLoading(true);
                const summary = await fetchCompatibilitySnapshot(profileId);
                if (active) {
                    setCompatibilitySummary(summary?.summary || null);
                    setFitPoints(summary?.fitPoints || []);
                    setFrictionPoints(summary?.frictionPoints || []);
                }
            } catch (err) {
                console.warn('Failed to load profile details for review:', err);
                Alert.alert('Profile unavailable', 'This profile could not be loaded.');
                onClose();
            } finally {
                if (active) {
                    setLoading(false);
                    setSummaryLoading(false);
                }
            }
        }
        void load();

        return () => {
            active = false;
        };
    }, [profileId]);

    if (loading || !candidate) {
        return (
            <View style={{ flex: 1, backgroundColor: '#eff6f8', justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#11313c" />
            </View>
        );
    }

    return (
        <MatchProfileScreen
            candidate={candidate}
            viewerProfile={viewerProfile}
            compatibilitySummary={compatibilitySummary}
            fitPoints={fitPoints}
            frictionPoints={frictionPoints}
            summaryLoading={summaryLoading}
            onClose={onClose}
            onPass={onClose}
            onConnect={onClose}
            onOpenChat={onOpenChat}
        />
    );
}

