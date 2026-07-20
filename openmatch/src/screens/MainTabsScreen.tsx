import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RealtimeChannel } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { subscribeToNotifications } from '../lib/notificationsApi';
import { supabase } from '../lib/supabase';

import { ChatMatch } from '../lib/chat';
import { fetchChatMatches, subscribeToInterestRequests, unsubscribeFromChannel, updateUserPresence } from '../lib/chatApi';
import { fetchPremiumAnalyticsSummary, PremiumAnalyticsSummary, trackPremiumEvent } from '../lib/premiumAnalytics';
import { getDisplayFirstName, ProfileRecord } from '../lib/profile';
import { fetchCurrentProfile, activateSpotlight } from '../lib/profileApi';
import { MatchCandidate } from '../lib/matchmaking';
import { fetchCompatibilitySnapshot } from '../lib/matchmakingApi';
import { MAX_CONTENT_WIDTH, TabBarSpacingContext } from '../lib/responsiveLayout';
import { ChatScreen } from './ChatScreen';
import { HomeScreen } from './HomeScreen';
import { ModerationQueueScreen } from './ModerationQueueScreen';
import { DashboardScreen } from './DashboardScreen';
import VipConciergeDashboard from './VipConciergeDashboard';
import ConciergeHubScreen from './ConciergeHubScreen';
import PremiumAssistedProfileViewer from '../components/PremiumAssistedProfileViewer';
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
    unreadNotifications: number;
};

const emptyShellCounts: ShellCounts = {
    total: 0,
    unread: 0,
    received: 0,
    accepted: 0,
    contacts: 0,
    sent: 0,
    unreadNotifications: 0,
};

export function MainTabsScreen() {
    const [activeTab, setActiveTab] = useState<AppTab>('matches');
    const [shellLoading, setShellLoading] = useState(true);
    const [viewerFirstName, setViewerFirstName] = useState('');
    const [viewerPhotoUrl, setViewerPhotoUrl] = useState<string | null>(null);
    const [viewerProfileId, setViewerProfileId] = useState<string | null>(null);
    const [shellCounts, setShellCounts] = useState<ShellCounts>(emptyShellCounts);
    const [isAdmin, setIsAdmin] = useState(false);
    const [showPartnerPrefs, setShowPartnerPrefs] = useState(false);
    const [showProfileEdit, setShowProfileEdit] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const [viewerProfile, setViewerProfile] = useState<ProfileRecord | null>(null);
    const [showShortlist, setShowShortlist] = useState(false);
    const [showMyMatches, setShowMyMatches] = useState(false);
    const [showWhoViewedMe, setShowWhoViewedMe] = useState(false);
    const [showNotifications, setShowNotifications] = useState(false);
    const [showDashboard, setShowDashboard] = useState(false);
    const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
    const [conciergeRefreshCounter, setConciergeRefreshCounter] = useState(0);
    const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
    const insets = useSafeAreaInsets();
    // Debounce ref: track the last time loadShellData was triggered by a tab
    // switch so rapid tab changes don't fire multiple heavy fetchChatMatches calls.
    const lastTabLoadAt = useRef<number>(0);
 
    // Android back button: dismiss the topmost open modal instead of exiting the app.
    useEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', () => {
            if (selectedProfileId) { 
                setSelectedProfileId(null); 
                setConciergeRefreshCounter(prev => prev + 1);
                return true; 
            }
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
            const { data: { user } } = await supabase.auth.getUser();
            
            const [profile, matches, unreadNotifsResult] = await Promise.all([
                fetchCurrentProfile().catch(() => null),
                fetchChatMatches().catch(() => [] as ChatMatch[]),
                user
                    ? supabase
                          .from('notifications')
                          .select('id', { count: 'exact', head: true })
                          .eq('user_id', user.id)
                          .eq('is_read', false)
                    : Promise.resolve({ count: 0 }),
            ]);

            setViewerFirstName(getDisplayFirstName(profile?.full_name));
            setViewerPhotoUrl(profile?.photo_urls?.[0] ?? null);
            setViewerProfileId(profile?.id ?? null);
            setViewerProfile(profile);
            
            const baseCounts = buildShellCounts(matches);
            baseCounts.unreadNotifications = unreadNotifsResult.count ?? 0;
            setShellCounts(baseCounts);
            
            setIsAdmin(profile?.is_admin === true);
        } catch (error) {
            console.warn('Failed to refresh main tab summary.', error);
        } finally {
            setShellLoading(false);
        }
    }

    function handleSignOut() {
        setShowSignOutConfirm(true);
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
                    viewerPhotoUrl={viewerPhotoUrl}
                    viewerProfileId={viewerProfileId}
                    viewerProfile={viewerProfile}
                    counts={shellCounts}
                    onOpenSettings={() => setShowSettings(true)}
                    onOpenSearch={() => setShowSearch(true)}
                    onOpenShortlist={() => setShowShortlist(true)}
                    onOpenWhoViewedMe={() => setShowWhoViewedMe(true)}
                    onOpenProfileEdit={() => setShowProfileEdit(true)}
                    onOpenPartnerPrefs={() => setShowPartnerPrefs(true)}
                    onOpenNotifications={() => setShowNotifications(true)}
                    onViewSelfProfile={(id) => setSelectedProfileId(id)}
                    onSignOut={handleSignOut}
                    onRefreshProfile={loadShellData}
                />
            );
        }

        if (activeTab === 'matches') {
            return (
                <HomeScreen
                    onOpenNotifications={() => setShowNotifications(true)}
                    unreadNotificationsCount={shellCounts.unreadNotifications}
                />
            );
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
                    onOpenNotifications={() => setShowNotifications(true)}
                    unreadNotificationsCount={shellCounts.unreadNotifications}
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
                    onOpenNotifications={() => setShowNotifications(true)}
                    unreadNotificationsCount={shellCounts.unreadNotifications}
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

        return <PremiumTab onOpenMatches={() => openTab('matches')} onOpenInbox={() => openTab('inbox')} viewerProfile={viewerProfile} />;
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

    if (viewerProfile?.subscription_tier === 'vip') {
        return (
            <VipConciergeDashboard
                viewerProfile={viewerProfile}
                onViewProfile={(id) => setSelectedProfileId(id)}
                onSignOut={handleSignOut}
            />
        );
    }

    if (viewerProfile?.subscription_tier === 'assisted' || (viewerProfile as any)?.membership_tier === 'assisted') {
        return (
            <>
                <ConciergeHubScreen
                    viewerProfile={viewerProfile}
                    onViewProfile={(id) => setSelectedProfileId(id)}
                    onSignOut={handleSignOut}
                    refreshCounter={conciergeRefreshCounter}
                />
                <Modal
                    transparent={false}
                    animationType="slide"
                    visible={Boolean(selectedProfileId)}
                    onRequestClose={() => {
                        setSelectedProfileId(null);
                        setConciergeRefreshCounter((prev) => prev + 1);
                    }}
                >
                    {selectedProfileId ? (
                        <PremiumAssistedProfileViewer
                            profileId={selectedProfileId}
                            onClose={() => {
                                setSelectedProfileId(null);
                                setConciergeRefreshCounter((prev) => prev + 1);
                            }}
                        />
                    ) : null}
                </Modal>
            </>
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

                <Modal
                    transparent
                    animationType="fade"
                    visible={showSignOutConfirm}
                    onRequestClose={() => setShowSignOutConfirm(false)}
                >
                    <View style={styles.confirmModalOverlay}>
                        <View style={styles.confirmModalContent}>
                            <Text style={styles.confirmModalTitle}>Sign out</Text>
                            <Text style={styles.confirmModalBody}>Are you sure you want to sign out of your account?</Text>
                            <View style={styles.confirmModalButtons}>
                                <Pressable style={styles.confirmCancelBtn} onPress={() => setShowSignOutConfirm(false)}>
                                    <Text style={styles.confirmCancelText}>Cancel</Text>
                                </Pressable>
                                <Pressable
                                    style={styles.confirmActionBtn}
                                    onPress={async () => {
                                        setShowSignOutConfirm(false);
                                        try {
                                            await updateUserPresence('offline').catch(() => {});
                                            await supabase.auth.signOut();
                                        } catch (err) {
                                            console.error('Sign out error:', err);
                                        }
                                    }}
                                >
                                    <Text style={styles.confirmActionText}>Sign out</Text>
                                </Pressable>
                            </View>
                        </View>
                    </View>
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
    viewerPhotoUrl,
    viewerProfileId,
    viewerProfile,
    counts,
    onOpenSettings,
    onOpenSearch,
    onOpenShortlist,
    onOpenWhoViewedMe,
    onOpenProfileEdit,
    onOpenPartnerPrefs,
    onOpenNotifications,
    onViewSelfProfile,
    onSignOut,
    onRefreshProfile,
}: {
    loading: boolean;
    viewerFirstName: string;
    viewerPhotoUrl: string | null;
    viewerProfileId: string | null;
    viewerProfile: ProfileRecord | null;
    counts: ShellCounts;
    onOpenSettings: () => void;
    onOpenSearch: () => void;
    onOpenShortlist: () => void;
    onOpenWhoViewedMe: () => void;
    onOpenProfileEdit: () => void;
    onOpenPartnerPrefs: () => void;
    onOpenNotifications: () => void;
    onViewSelfProfile: (profileId: string) => void;
    onSignOut: () => void;
    onRefreshProfile: () => Promise<void>;
}) {
    const [secondsRemaining, setSecondsRemaining] = useState(0);
    const [activatingSpotlight, setActivatingSpotlight] = useState(false);
    const [showSpotlightConfirm, setShowSpotlightConfirm] = useState(false);

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
    function handleActivateSpotlight() {
        setShowSpotlightConfirm(true);
    }

    async function handleExecuteSpotlight() {
        setShowSpotlightConfirm(false);
        setActivatingSpotlight(true);
        try {
            const result = await activateSpotlight();
            if (result.success) {
                Alert.alert('Spotlight Active!', 'Your profile is now featured at the top of other users matching feeds for the next 30 minutes!');
                await onRefreshProfile();
            }
        } catch (err: any) {
            Alert.alert('Activation Failed', err.message || 'Failed to activate Spotlight.');
        } finally {
            setActivatingSpotlight(false);
        }
    }
    return (
        <SafeAreaView style={styles.panelSafeArea} edges={['top', 'left', 'right']}>
            <ScrollView contentContainerStyle={styles.panelScrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.heroCard}>
                    <View style={styles.heroCardHeader}>
                        {viewerProfileId && (
                            <Pressable 
                                onPress={() => onViewSelfProfile(viewerProfileId)} 
                                style={({ pressed }) => [{ marginRight: 10, borderRadius: 24, overflow: 'hidden' }, pressed && { opacity: 0.8 }]}
                            >
                                {viewerPhotoUrl ? (
                                    <Image source={{ uri: viewerPhotoUrl }} style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: '#fff' }} />
                                ) : (
                                    <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#475569', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#fff' }}>
                                        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>
                                            {viewerFirstName?.charAt(0).toUpperCase() || 'U'}
                                        </Text>
                                    </View>
                                )}
                            </Pressable>
                        )}
                        <View style={{ flex: 1 }}>
                            <Text style={styles.heroEyebrow}>OpenMatch</Text>
                            <Text style={styles.heroTitle}>{viewerFirstName ? `Welcome back, ${viewerFirstName}` : 'Welcome back'}</Text>
                        </View>
                        <Pressable onPress={onOpenSettings} style={styles.settingsBtn}>
                            <Text style={styles.settingsBtnText}>⚙</Text>
                        </Pressable>
                    </View>
                    <Text style={styles.heroBody}>
                        Keep track of your match requests and unlocked conversations.
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

                {/* Spotlight Card */}
                {(isSpotlightActive || (viewerProfile && (viewerProfile.spotlights_remaining ?? 0) > 0)) && (
                    <View style={[styles.sectionCard, { borderLeftWidth: 4, borderLeftColor: '#c8a261', backgroundColor: '#fffdf9', paddingVertical: 16 }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <View style={{ flex: 1, gap: 4, paddingRight: 12 }}>
                                <Text style={{ fontSize: 16, fontWeight: '800', color: '#8a6b39' }}>
                                    {isSpotlightActive ? '✨ Spotlight is Active!' : '✨ Boost Your Visibility'}
                                </Text>
                                <Text style={{ fontSize: 14, color: '#4d6268', lineHeight: 20 }}>
                                    {isSpotlightActive 
                                        ? 'Your profile is highlighted at the top of feeds for matching candidates.' 
                                        : `You have ${viewerProfile?.spotlights_remaining} Spotlight credit${(viewerProfile?.spotlights_remaining ?? 0) === 1 ? '' : 's'} remaining.`}
                                </Text>
                            </View>
                            {isSpotlightActive ? (
                                <View style={{ backgroundColor: '#fdf3e7', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#edd3b2' }}>
                                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#a7702a', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>
                                        {formatTimer(secondsRemaining)}
                                    </Text>
                                </View>
                            ) : (
                                <Pressable 
                                    style={({ pressed }) => [
                                        { backgroundColor: '#c8a261', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
                                        pressed && { opacity: 0.8 },
                                        activatingSpotlight && { opacity: 0.5 }
                                    ]}
                                    onPress={handleActivateSpotlight}
                                    disabled={activatingSpotlight}
                                >
                                    {activatingSpotlight ? (
                                        <ActivityIndicator size="small" color="#fff" />
                                    ) : (
                                        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>Activate</Text>
                                    )}
                                </Pressable>
                            )}
                        </View>
                    </View>
                )}

                <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>Jump back in</Text>
                    <View style={styles.quickActionGrid}>
                        <QuickActionButton label="Search profiles" subtitle="Filter by age, religion…" tone="primary" onPress={onOpenSearch} />
                        <QuickActionButton label="Who viewed me" subtitle="Recent profile visitors" tone="accent" onPress={onOpenWhoViewedMe} />
                        <QuickActionButton label="Saved profiles" subtitle="Your bookmarks" tone="neutral" onPress={onOpenShortlist} />
                        <QuickActionButton label="Edit profile" subtitle="Update your details" tone="neutral" onPress={onOpenProfileEdit} />
                        <QuickActionButton label="Edit preferences" subtitle="Refine match filters" tone="neutral" onPress={onOpenPartnerPrefs} />
                        <QuickActionButton label="Sign out" subtitle="Log out of your account" tone="accent" onPress={onSignOut} />
                    </View>
                </View>
            </ScrollView>

            <Modal
                transparent
                animationType="fade"
                visible={showSpotlightConfirm}
                onRequestClose={() => setShowSpotlightConfirm(false)}
            >
                <View style={styles.confirmModalOverlay}>
                    <View style={styles.confirmModalContent}>
                        <Text style={styles.confirmModalTitle}>✨ Activate Spotlight</Text>
                        <Text style={styles.confirmModalBody}>Are you sure you want to activate your Spotlight for 30 minutes? This will feature your profile at the top of other users matching feeds.</Text>
                        <View style={styles.confirmModalButtons}>
                            <Pressable style={styles.confirmCancelBtn} onPress={() => setShowSpotlightConfirm(false)}>
                                <Text style={styles.confirmCancelText}>Cancel</Text>
                            </Pressable>
                            <Pressable
                                style={[styles.confirmActionBtn, { backgroundColor: '#c8a261' }]}
                                onPress={handleExecuteSpotlight}
                            >
                                <Text style={styles.confirmActionText}>Activate</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

interface SubscriptionPackage {
    id: string;
    months: number;
    priceINR: number;
    originalPriceINR?: number;
    unlockCredits: number;
    aiCalls: number;
}

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

function PremiumTab({ onOpenMatches, onOpenInbox, viewerProfile }: { onOpenMatches: () => void; onOpenInbox: () => void; viewerProfile: ProfileRecord | null }) {
    const isPremium = 
        viewerProfile?.subscription_tier === 'plus' || 
        viewerProfile?.subscription_tier === 'vip' || 
        viewerProfile?.subscription_tier === 'pro' || 
        viewerProfile?.subscription_tier === 'pro_max' || 
        viewerProfile?.subscription_tier === 'pro_supreme' ||
        viewerProfile?.subscription_tier === 'assisted';
    const isExpired = viewerProfile?.subscription_expires_at ? new Date(viewerProfile.subscription_expires_at).getTime() < Date.now() : true;
    const isActivePremium = isPremium && !isExpired;

    const [activeTab, setActiveTab] = useState<'self-service' | 'assisted'>('self-service');
    const [selfServiceSubTier, setSelfServiceSubTier] = useState<'pro' | 'pro_max' | 'pro_supreme'>('pro');
    const [activeDuration, setActiveDuration] = useState<'1_month' | '3_months' | '6_months' | 'till_marriage'>('1_month');
    const [selectedPackageId, setSelectedPackageId] = useState<string>('pro_1m');
    const [checkoutLoading, setCheckoutLoading] = useState(false);

    useEffect(() => {
        void trackPremiumEvent({
            eventName: 'premium_promo_impression',
            surface: 'premium_tab',
            context: 'tab_open',
        });
    }, []);

    const syncSelection = (subTier: 'pro' | 'pro_max' | 'pro_supreme', duration: '1_month' | '3_months' | '6_months' | 'till_marriage') => {
        setActiveDuration(duration);
        const monthsMap = {
            '1_month': '1m',
            '3_months': '3m',
            '6_months': '6m',
            'till_marriage': '12m'
        };
        setSelectedPackageId(`${subTier}_${monthsMap[duration]}`);
    };

    const handleTabChange = (tab: 'self-service' | 'assisted') => {
        setActiveTab(tab);
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
        if (activeTab === 'assisted') {
            return EXCLUSIVE_PACKAGES;
        }
        return selfServiceSubTier === 'pro' 
            ? PRO_PACKAGES 
            : selfServiceSubTier === 'pro_max' 
            ? PRO_MAX_PACKAGES 
            : PRO_SUPREME_PACKAGES;
    };

    const packages = getPackages();
    const selectedPackage = packages.find(pkg => pkg.id === selectedPackageId) || packages[0];

    const handleCheckout = async () => {
        setCheckoutLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('create-subscription-checkout', {
                body: {
                    packageTier: activeTab === 'self-service' ? 'plus' : 'vip',
                    subTier: activeTab === 'self-service' ? selfServiceSubTier : undefined,
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
                        Alert.alert('Checkout Unavailable', 'Could not open Checkout page on this device.');
                    }
                }
            } else {
                throw new Error('No checkout URL returned from server.');
            }
        } catch (err: any) {
            Alert.alert('Payment Failed', err.message || 'Unable to start Stripe checkout session.');
        } finally {
            setCheckoutLoading(false);
        }
    };

    const handleRequestCallBack = () => {
        Alert.alert('Call Back Requested', 'Our Dedicated Relationship Manager will contact you shortly to guide you.');
    };

    const handleNeedHelp = () => {
        Alert.alert('Need Help?', 'Contact us at premium-support@openmatch.co or call 1800-OPEN-MATCH.');
    };

    const expiryDateStr = viewerProfile?.subscription_expires_at 
        ? new Date(viewerProfile.subscription_expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : '';

    const TableRow = ({ label, valPro, valMax, valSupreme, hasInfo }: { label: string; valPro: string; valMax: string; valSupreme: string; hasInfo?: boolean }) => {
        return (
            <View style={styles.tableRow}>
                <View style={styles.rowLabelCell}>
                    <Text style={styles.rowLabelText}>{label}</Text>
                    {hasInfo && <Text style={styles.infoIcon}>ⓘ</Text>}
                </View>
                <Pressable style={[styles.rowValCell, selfServiceSubTier === 'pro' && styles.activeValCell]} onPress={() => handleSubTierChange('pro')}>
                    <Text style={styles.rowValText}>{valPro}</Text>
                </Pressable>
                <Pressable style={[styles.rowValCell, selfServiceSubTier === 'pro_max' && styles.activeValCell]} onPress={() => handleSubTierChange('pro_max')}>
                    <Text style={styles.rowValText}>{valMax}</Text>
                </Pressable>
                <Pressable style={[styles.rowValCell, selfServiceSubTier === 'pro_supreme' && styles.activeValCell]} onPress={() => handleSubTierChange('pro_supreme')}>
                    <Text style={styles.rowValText}>{valSupreme}</Text>
                </Pressable>
            </View>
        );
    };

    // Retrieve duration multiplier from currently selected package card
    const durationMonths = 
        activeDuration === '1_month' ? 1 : 
        activeDuration === '3_months' ? 3 : 
        activeDuration === '6_months' ? 6 : 12;

    // Dynamic 'Contact Details' values
    const contactPro = 15 * durationMonths;
    const contactMax = 30 * durationMonths;
    const contactSupreme = 50 * durationMonths;

    // Dynamic 'Super Interest' values
    const interestPro = 0 * durationMonths;
    const interestMax = 50 * durationMonths;
    const interestSupreme = 80 * durationMonths;

    // Dynamic 'Spotlights' values
    const spotlightPro = 0 * durationMonths;
    const spotlightMax = 1 * durationMonths;
    const spotlightSupreme = 3 * durationMonths;

    return (
        <SafeAreaView style={styles.panelSafeArea} edges={['top', 'left', 'right']}>
            <ScrollView contentContainerStyle={styles.panelScrollContent} showsVerticalScrollIndicator={false}>
                
                {/* Header Row */}
                <View style={styles.headerRow}>
                    <Text style={styles.pageHeaderTitle}>Upgrade Membership</Text>
                    <Pressable onPress={handleNeedHelp}>
                        <Text style={styles.needHelpText}>Need Help?</Text>
                    </Pressable>
                </View>

                {isActivePremium && (
                    /* Subscribed Premium Member View */
                    <View style={[styles.heroCard, { backgroundColor: '#14313a', borderColor: '#d9643d', borderWidth: 2, marginBottom: 16 }]}>
                        <Text style={[styles.heroEyebrow, { color: '#f9a159' }]}>
                            👑 OpenMatch {
                                viewerProfile?.subscription_tier === 'vip' ? 'VIP' :
                                viewerProfile?.subscription_tier === 'pro' ? 'Pro' :
                                viewerProfile?.subscription_tier === 'pro_max' ? 'Pro Max' :
                                viewerProfile?.subscription_tier === 'pro_supreme' ? 'Pro Supreme' : 'Plus'
                            } Active
                        </Text>
                        <Text style={styles.heroTitle}>Premium status is unlocked</Text>
                        <Text style={styles.heroBody}>
                            Thank you for supporting a fair matchmaking ecosystem. Your subscription is active until <Text style={{ fontWeight: '800', color: '#ffffff' }}>{expiryDateStr}</Text>.
                        </Text>
                        
                        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                            <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, alignItems: 'center' }}>
                                <Text style={{ fontSize: 24, fontWeight: '900', color: '#f9a159' }}>
                                    🔑 {viewerProfile?.unlock_credits_remaining ?? viewerProfile?.manual_unlock_credits ?? 0}
                                </Text>
                                <Text style={{ fontSize: 10, fontWeight: '700', color: '#c7d6d8', textTransform: 'uppercase', marginTop: 4 }}>
                                    Unlock Credits
                                </Text>
                            </View>
                            {(viewerProfile?.subscription_tier === 'vip' || (viewerProfile?.ai_call_credits ?? 0) > 0) && (
                                <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, alignItems: 'center' }}>
                                    <Text style={{ fontSize: 24, fontWeight: '900', color: '#f9a159' }}>
                                        📞 {viewerProfile?.ai_call_credits ?? 0}
                                    </Text>
                                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#c7d6d8', textTransform: 'uppercase', marginTop: 4 }}>
                                        AI Voice Calls
                                    </Text>
                                </View>
                            )}
                        </View>
                    </View>
                )}

                {/* Segmented Controller Toggle */}
                <View style={styles.upgradeToggleContainer}>
                    <Pressable
                        style={[
                            styles.upgradeToggleSegment,
                            activeTab === 'self-service' && styles.upgradeToggleSegmentActive,
                        ]}
                        onPress={() => handleTabChange('self-service')}
                    >
                        <Text
                            style={[
                                styles.upgradeToggleText,
                                activeTab === 'self-service' && styles.upgradeToggleTextActive,
                            ]}
                        >
                            Self-service
                        </Text>
                    </Pressable>
                    <Pressable
                        style={[
                            styles.upgradeToggleSegment,
                            activeTab === 'assisted' && styles.upgradeToggleSegmentActive,
                        ]}
                        onPress={() => handleTabChange('assisted')}
                    >
                        <Text
                            style={[
                                styles.upgradeToggleText,
                                activeTab === 'assisted' && styles.upgradeToggleTextActive,
                            ]}
                        >
                            Assisted
                        </Text>
                    </Pressable>
                </View>

                {activeTab === 'self-service' ? (
                    /* Self-service view comparison grid */
                    <View style={{ width: '100%' }}>
                        <View style={styles.tableContainer}>
                            {/* Table Headers */}
                            <View style={styles.tableHeaderRow}>
                                <View style={styles.tableHeaderCellLeft} />
                                <Pressable 
                                    style={[styles.tableHeaderCell, selfServiceSubTier === 'pro' && styles.selectedHeaderCell]} 
                                    onPress={() => handleSubTierChange('pro')}
                                >
                                    <Text style={styles.columnTitle}>Pro</Text>
                                    <View style={[styles.radioButtonOuter, selfServiceSubTier === 'pro' && styles.radioButtonOuterActive]}>
                                        {selfServiceSubTier === 'pro' && <View style={styles.radioButtonInner} />}
                                    </View>
                                </Pressable>
                                <Pressable 
                                    style={[styles.tableHeaderCell, selfServiceSubTier === 'pro_max' && styles.selectedHeaderCell]} 
                                    onPress={() => handleSubTierChange('pro_max')}
                                >
                                    <Text style={styles.columnTitle}>Pro Max</Text>
                                    <View style={[styles.radioButtonOuter, selfServiceSubTier === 'pro_max' && styles.radioButtonOuterActive]}>
                                        {selfServiceSubTier === 'pro_max' && <View style={styles.radioButtonInner} />}
                                    </View>
                                </Pressable>
                                <Pressable 
                                    style={[styles.tableHeaderCell, selfServiceSubTier === 'pro_supreme' && styles.selectedHeaderCell, { overflow: 'visible' }]} 
                                    onPress={() => handleSubTierChange('pro_supreme')}
                                >
                                    <View style={styles.topSellerBadge}>
                                        <Text style={styles.topSellerBadgeText}>Top Seller</Text>
                                    </View>
                                    <Text style={styles.columnTitle}>Pro Supreme</Text>
                                    <View style={[styles.radioButtonOuter, selfServiceSubTier === 'pro_supreme' && styles.radioButtonOuterActive]}>
                                        {selfServiceSubTier === 'pro_supreme' && <View style={styles.radioButtonInner} />}
                                    </View>
                                </Pressable>
                            </View>

                            {/* Table Rows */}
                            <TableRow label="Contact sharing" valPro="✓" valMax="✓" valSupreme="✓" />
                            <TableRow label="Engage+" valPro="✓" valMax="✓" valSupreme="✓" hasInfo />
                            <TableRow label="Contact Details" valPro={`${contactPro} Unlocks`} valMax={`${contactMax} Unlocks`} valSupreme={`${contactSupreme} Unlocks`} />
                            <TableRow label="Super Interest" valPro={`${interestPro}`} valMax={`${interestMax}`} valSupreme={`${interestSupreme}`} hasInfo />
                            <TableRow label="Spotlights" valPro={`${spotlightPro}`} valMax={`${spotlightMax}`} valSupreme={`${spotlightSupreme}`} hasInfo />
                            <TableRow label="Gold Badge" valPro="✓" valMax="✓" valSupreme="✓" />
                        </View>

                        {/* Discount Banner line */}
                        <View style={styles.discountBannerContainer}>
                            <View style={styles.bannerLine} />
                            <Text style={styles.discountBannerText}>GET UPTO 40% OFF ON ALL PLANS</Text>
                            <View style={styles.bannerLine} />
                        </View>
                    </View>
                ) : (
                    /* Assisted View (Exclusive) */
                    <View style={{ width: '100%' }}>
                        <Text style={styles.exclusiveTitle}>Exclusive</Text>
                        
                        <View style={styles.exclusiveFeatureList}>
                            <View style={styles.exclusiveFeatureItem}>
                                <View style={styles.exclusiveIconContainer}>
                                    <Text style={styles.exclusiveIconText}>🏅</Text>
                                </View>
                                <View style={styles.exclusiveFeatureTextContainer}>
                                    <Text style={styles.exclusiveFeatureTitle}>
                                        Benefits of Top Seller + unlimited matches daily
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.exclusiveFeatureItem}>
                                <View style={styles.exclusiveIconContainer}>
                                    <Text style={styles.exclusiveIconText}>👥</Text>
                                </View>
                                <View style={styles.exclusiveFeatureTextContainer}>
                                    <Text style={styles.exclusiveFeatureTitle}>
                                        Dedicated AI Matchmaker Concierge to help you
                                    </Text>
                                    <View style={styles.exclusiveFeatureSubBullets}>
                                        <Text style={styles.exclusiveFeatureSubBullet}>• AI Profile Ghostwriter optimizations</Text>
                                        <Text style={styles.exclusiveFeatureSubBullet}>• Find most relevant & serious matches</Text>
                                        <Text style={styles.exclusiveFeatureSubBullet}>• Get additional info of the bride & her family</Text>
                                        <Text style={styles.exclusiveFeatureSubBullet}>• With 3 times faster matching</Text>
                                        <Text style={styles.exclusiveFeatureSubBullet}>• Automated outbound call pitches via AI Broker</Text>
                                    </View>
                                </View>
                            </View>
                        </View>

                        {/* Exclusive Actions Sub-Row */}
                        <View style={styles.exclusiveActionsRow}>
                            <Pressable style={styles.requestCallBackBtn} onPress={handleRequestCallBack}>
                                <Text style={styles.requestCallBackText}>Request Call Back</Text>
                            </Pressable>
                            <Pressable onPress={handleRequestCallBack}>
                                <Text style={styles.knowMoreText}>Know more &gt;</Text>
                            </Pressable>
                        </View>
                    </View>
                )}

                {/* Choose a Plan Duration Grid */}
                <View style={styles.durationSection}>
                    <View style={styles.discountBannerContainer}>
                        <View style={styles.bannerLine} />
                        <Text style={styles.durationSectionTitle}>CHOOSE A PLAN DURATION</Text>
                        <View style={styles.bannerLine} />
                    </View>

                    <View style={styles.choosePlansGrid}>
                        {packages.map((pkg) => {
                            const isSelected = pkg.id === selectedPackageId;
                            const priceText = `₹${pkg.priceINR.toLocaleString('en-IN')}`;
                            const origPriceText = pkg.originalPriceINR ? `₹${pkg.originalPriceINR.toLocaleString('en-IN')}` : null;
                            const durationLabel = pkg.months === 12 && activeTab === 'self-service' ? 'Till Marriage' : `${pkg.months} ${pkg.months === 1 ? 'month' : 'months'}`;

                            return (
                                <Pressable
                                    key={pkg.id}
                                    style={[
                                        styles.newPackageCard,
                                        isSelected && styles.newPackageCardSelected,
                                    ]}
                                    onPress={() => {
                                        setSelectedPackageId(pkg.id);
                                        const durMap: Record<number, '1_month' | '3_months' | '6_months' | 'till_marriage'> = {
                                            1: '1_month',
                                            3: '3_months',
                                            6: '6_months',
                                            12: 'till_marriage'
                                        };
                                        if (durMap[pkg.months]) {
                                            setActiveDuration(durMap[pkg.months]);
                                        }
                                    }}
                                >
                                    <View style={styles.newPackageCardHeader}>
                                        <Text style={[styles.newPackageDuration, isSelected && styles.newPackageDurationSelected]}>
                                            {durationLabel}
                                        </Text>
                                        <View style={[styles.radioButtonOuter, isSelected && styles.radioButtonOuterActive, { marginTop: -2 }]}>
                                            {isSelected && <View style={styles.radioButtonInner} />}
                                        </View>
                                    </View>
                                    <View style={{ marginTop: 8 }}>
                                        {origPriceText && (
                                            <Text style={styles.newPackageOriginalPrice}>{origPriceText}</Text>
                                        )}
                                        <Text style={styles.newPackagePrice}>{priceText}</Text>
                                    </View>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                {/* Checkout CTA */}
                <Pressable
                    style={[styles.crimsonBtn, checkoutLoading && { opacity: 0.6 }]}
                    onPress={handleCheckout}
                    disabled={checkoutLoading}
                >
                    {checkoutLoading ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                        <Text style={styles.crimsonBtnText}>
                            {activeTab === 'self-service'
                                ? `Get ${selfServiceSubTier === 'pro' ? 'Pro' : selfServiceSubTier === 'pro_max' ? 'Pro Max' : 'Pro Supreme'} now`
                                : 'Get Exclusive now'}
                        </Text>
                    )}
                </Pressable>
                
                <Text style={styles.billingSubtext}>Recurring payment, cancel anytime</Text>

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
        gap: 10,
        paddingBottom: 20,
        paddingHorizontal: 16,
        paddingTop: 12,
    },
    heroCard: {
        backgroundColor: '#14313a',
        borderRadius: 20,
        gap: 8,
        padding: 16,
    },
    premiumHeroCard: {
        backgroundColor: '#29464f',
    },
    heroEyebrow: {
        color: '#f1c57b',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    heroCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    settingsBtn: {
        padding: 4,
        marginLeft: 8,
    },
    settingsBtnText: {
        fontSize: 24,
        color: 'rgba(255,255,255,0.6)',
    },
    heroTitle: {
        color: '#ffffff',
        fontSize: 24,
        fontWeight: '800',
    },
    heroBody: {
        color: '#d5e2e4',
        fontSize: 13.5,
        lineHeight: 19,
    },
    summaryLoadingCard: {
        alignItems: 'center',
        backgroundColor: '#ffffff',
        borderColor: '#d6e1df',
        borderRadius: 22,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 10,
        padding: 12,
    },
    summaryLoadingText: {
        color: '#35525b',
        fontSize: 13,
        fontWeight: '700',
    },
    summaryGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    summaryCard: {
        borderRadius: 16,
        flexBasis: '45%',
        flexGrow: 1,
        gap: 4,
        padding: 12,
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
        fontSize: 22,
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
        fontSize: 11.5,
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
        borderRadius: 18,
        borderWidth: 1,
        gap: 10,
        padding: 14,
    },
    sectionTitle: {
        color: '#14313a',
        fontSize: 15,
        fontWeight: '800',
    },
    quickActionGrid: {
        gap: 8,
    },
    quickActionButton: {
        borderRadius: 14,
        gap: 4,
        padding: 12,
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
        fontSize: 13.5,
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
        fontSize: 11.5,
        lineHeight: 16,
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
        gap: 10,
    },
    featureDot: {
        backgroundColor: '#d9643d',
        borderRadius: 999,
        height: 8,
        marginTop: 5,
        width: 8,
    },
    featureCopy: {
        flex: 1,
        gap: 4,
    },
    featureTitle: {
        color: '#14313a',
        fontSize: 13.5,
        fontWeight: '800',
    },
    featureBody: {
        color: '#5d6d71',
        fontSize: 12.5,
        lineHeight: 18,
    },
    confirmModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(10, 26, 31, 0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    confirmModalContent: {
        backgroundColor: '#ffffff',
        borderRadius: 24,
        padding: 24,
        width: '100%',
        maxWidth: 340,
        gap: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
        elevation: 6,
    },
    confirmModalTitle: {
        color: '#14313a',
        fontSize: 20,
        fontWeight: '800',
    },
    confirmModalBody: {
        color: '#5d6d71',
        fontSize: 15,
        lineHeight: 22,
    },
    confirmModalButtons: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 8,
    },
    confirmCancelBtn: {
        flex: 1,
        backgroundColor: '#edf3f2',
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    confirmCancelText: {
        color: '#244049',
        fontSize: 14,
        fontWeight: '700',
    },
    confirmActionBtn: {
        flex: 1,
        backgroundColor: '#d9643d',
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    confirmActionText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '700',
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        paddingHorizontal: 4,
        marginTop: 12,
        marginBottom: 8,
    },
    pageHeaderTitle: {
        fontSize: 22,
        fontWeight: '900',
        color: '#14313a',
    },
    needHelpText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#d1354c',
        textDecorationLine: 'underline',
    },
    upgradeToggleContainer: {
        flexDirection: 'row',
        backgroundColor: '#f7f6f5',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#e8e6e4',
        padding: 4,
        marginTop: 8,
        marginBottom: 16,
    },
    upgradeToggleSegment: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        borderRadius: 16,
    },
    upgradeToggleSegmentActive: {
        backgroundColor: '#ffffff',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
    },
    upgradeToggleText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#9e9c9a',
    },
    upgradeToggleTextActive: {
        color: '#14313a',
    },
    exclusiveTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#394d54',
        marginTop: 8,
        marginBottom: 16,
    },
    exclusiveFeatureList: {
        gap: 16,
        marginBottom: 20,
    },
    exclusiveFeatureItem: {
        flexDirection: 'row',
        gap: 12,
    },
    exclusiveIconContainer: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#f2f0fc',
        alignItems: 'center',
        justifyContent: 'center',
    },
    exclusiveIconText: {
        fontSize: 16,
        color: '#6558f5',
    },
    exclusiveFeatureTextContainer: {
        flex: 1,
        gap: 4,
    },
    exclusiveFeatureTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1d2a30',
        lineHeight: 20,
    },
    exclusiveFeatureSubBullets: {
        marginTop: 6,
        gap: 6,
        paddingLeft: 8,
    },
    exclusiveFeatureSubBullet: {
        fontSize: 13,
        color: '#55666c',
        lineHeight: 18,
    },
    exclusiveActionsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 24,
        paddingHorizontal: 4,
    },
    requestCallBackBtn: {
        borderWidth: 1.5,
        borderColor: '#d1354c',
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    requestCallBackText: {
        color: '#d1354c',
        fontSize: 14,
        fontWeight: '700',
    },
    knowMoreText: {
        color: '#d1354c',
        fontSize: 14,
        fontWeight: '700',
        textDecorationLine: 'underline',
    },
    tableContainer: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#f0eefc',
        overflow: 'hidden',
        marginBottom: 20,
    },
    tableHeaderRow: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: '#f0eefc',
        backgroundColor: '#fcfbfe',
    },
    tableHeaderCellLeft: {
        width: '31%',
        paddingVertical: 14,
        paddingHorizontal: 10,
        justifyContent: 'center',
    },
    tableHeaderCell: {
        width: '23%',
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        gap: 6,
        borderLeftWidth: 1,
        borderLeftColor: '#f0eefc',
    },
    selectedHeaderCell: {
        backgroundColor: '#fef5f6',
    },
    topSellerBadge: {
        position: 'absolute',
        top: -8,
        backgroundColor: '#10cc9f',
        paddingHorizontal: 5,
        paddingVertical: 2,
        borderRadius: 4,
    },
    topSellerBadgeText: {
        color: '#ffffff',
        fontSize: 8,
        fontWeight: '900',
        textTransform: 'uppercase',
    },
    columnTitle: {
        fontSize: 11,
        fontWeight: '800',
        color: '#1d2a30',
        textAlign: 'center',
    },
    radioButtonOuter: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: '#c8c6c4',
        alignItems: 'center',
        justifyContent: 'center',
    },
    radioButtonOuterActive: {
        borderColor: '#d1354c',
    },
    radioButtonInner: {
        width: 9,
        height: 9,
        borderRadius: 4.5,
        backgroundColor: '#d1354c',
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: '#f0eefc',
    },
    rowLabelCell: {
        width: '31%',
        paddingVertical: 12,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    rowLabelText: {
        fontSize: 10.5,
        fontWeight: '700',
        color: '#6c7d84',
    },
    infoIcon: {
        fontSize: 10,
        color: '#a0b0b6',
        fontWeight: 'bold',
    },
    rowValCell: {
        width: '23%',
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderLeftWidth: 1,
        borderLeftColor: '#f0eefc',
    },
    activeValCell: {
        backgroundColor: '#fef5f6',
    },
    rowValText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#1d2a30',
    },
    discountBannerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        marginVertical: 16,
        width: '100%',
    },
    bannerLine: {
        flex: 1,
        height: 1,
        backgroundColor: '#edf0f2',
    },
    discountBannerText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: '#d1354c',
        letterSpacing: 0.5,
    },
    durationSection: {
        width: '100%',
        marginBottom: 12,
    },
    durationSectionTitle: {
        fontSize: 11,
        fontWeight: '800',
        color: '#6c7d84',
        letterSpacing: 0.8,
    },
    choosePlansGrid: {
        flexDirection: 'row',
        gap: 10,
        width: '100%',
    },
    newPackageCard: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderWidth: 1.5,
        borderColor: '#e8e6e4',
        borderRadius: 12,
        padding: 12,
        position: 'relative',
        minHeight: 84,
        justifyContent: 'space-between',
    },
    newPackageCardSelected: {
        borderColor: '#d1354c',
        backgroundColor: '#fffafb',
    },
    newPackageCardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        width: '100%',
    },
    newPackageDuration: {
        fontSize: 13,
        fontWeight: '800',
        color: '#6c7d84',
    },
    newPackageDurationSelected: {
        color: '#d1354c',
    },
    newPackageOriginalPrice: {
        fontSize: 11,
        color: '#a0a0a0',
        textDecorationLine: 'line-through',
        marginBottom: 2,
    },
    newPackagePrice: {
        fontSize: 16,
        fontWeight: '900',
        color: '#1d2a30',
    },
    crimsonBtn: {
        backgroundColor: '#d1354c',
        borderRadius: 8,
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 12,
        marginBottom: 8,
    },
    crimsonBtnText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '800',
    },
    billingSubtext: {
        fontSize: 11,
        color: '#8a9a9f',
        textAlign: 'center',
        marginBottom: 16,
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
                        subscription_tier: pData.subscription_tier,
                    });
                }

                if (vProfile && vProfile.id !== profileId) {
                    setSummaryLoading(true);
                    const summary = await fetchCompatibilitySnapshot(profileId);
                    if (active) {
                        setCompatibilitySummary(summary?.summary || null);
                        setFitPoints(summary?.fitPoints || []);
                        setFrictionPoints(summary?.frictionPoints || []);
                    }
                } else {
                    if (active) {
                        setCompatibilitySummary("This is how your profile appears to other matches.");
                        setFitPoints([]);
                        setFrictionPoints([]);
                    }
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

