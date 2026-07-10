import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RealtimeChannel } from '@supabase/supabase-js';

import { ChatMatch } from '../lib/chat';
import { fetchChatMatches, subscribeToInterestRequests, unsubscribeFromChannel } from '../lib/chatApi';
import { fetchPremiumAnalyticsSummary, PremiumAnalyticsSummary, trackPremiumEvent } from '../lib/premiumAnalytics';
import { getDisplayFirstName } from '../lib/profile';
import { fetchCurrentProfile } from '../lib/profileApi';
import { MAX_CONTENT_WIDTH, TabBarSpacingContext } from '../lib/responsiveLayout';
import { ChatScreen } from './ChatScreen';
import { HomeScreen } from './HomeScreen';

// Base height of the tab bar content (padding + tab button minHeight) before the
// device's bottom safe-area inset is added. Used to reserve space so scrollable
// screens never hide content behind the pinned tab bar.
const TAB_BAR_BASE_HEIGHT = 64;

type AppTab = 'home' | 'matches' | 'inbox' | 'chat' | 'premium';

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
    const insets = useSafeAreaInsets();

    // Keep the home-indicator clear on notched devices while still leaving a
    // comfortable tap area on phones without a bottom inset.
    const tabBarBottomPadding = insets.bottom > 0 ? insets.bottom + 6 : 16;
    // Total space the tab bar reserves, shared with child screens via context.
    const tabBarSpacing = TAB_BAR_BASE_HEIGHT + insets.bottom;

    useEffect(() => {
        void loadShellData();
    }, []);

    useEffect(() => {
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

        const intervalId = setInterval(() => {
            if (!isMounted) {
                return;
            }

            void loadShellData();
        }, 20000);

        return () => {
            isMounted = false;
            clearInterval(intervalId);
            void unsubscribeFromChannel(channel as RealtimeChannel);
        };
    }, []);

    async function loadShellData() {
        try {
            const [profile, matches] = await Promise.all([
                fetchCurrentProfile().catch(() => null),
                fetchChatMatches().catch(() => [] as ChatMatch[]),
            ]);

            setViewerFirstName(getDisplayFirstName(profile?.full_name));
            setShellCounts(buildShellCounts(matches));
        } catch (error) {
            console.warn('Failed to refresh main tab summary.', error);
        } finally {
            setShellLoading(false);
        }
    }

    const tabItems = useMemo(
        () => [
            { label: 'Home', subtitle: 'Soon', value: 'home' as const, badge: undefined, disabled: true },
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
        ],
        [shellCounts.contacts, shellCounts.received, shellCounts.unread],
    );

    function openTab(tab: AppTab) {
        if (tab === 'home') {
            return;
        }

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
                />
            );
        }

        return <PremiumTab onOpenMatches={() => openTab('matches')} onOpenInbox={() => openTab('inbox')} />;
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
}: {
    loading: boolean;
    viewerFirstName: string;
    counts: ShellCounts;
    onOpenMatches: () => void;
    onOpenInbox: () => void;
    onOpenChat: () => void;
    onOpenPremium: () => void;
}) {
    return (
        <SafeAreaView style={styles.panelSafeArea} edges={['top', 'left', 'right']}>
            <ScrollView contentContainerStyle={styles.panelScrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.heroCard}>
                    <Text style={styles.heroEyebrow}>OpenMatch</Text>
                    <Text style={styles.heroTitle}>{viewerFirstName ? `Welcome back, ${viewerFirstName}` : 'Welcome back'}</Text>
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
                        <QuickActionButton label="Review inbox" subtitle="Handle fresh requests" tone="accent" onPress={onOpenInbox} />
                        <QuickActionButton label="Continue chat" subtitle="Focus on active threads" tone="neutral" onPress={onOpenChat} />
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