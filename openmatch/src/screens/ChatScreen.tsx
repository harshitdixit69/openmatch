import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RealtimeChannel } from '@supabase/supabase-js';

import { BackButton } from '../components/BackButton';
import { PhoneIcon } from '../components/PhoneIcon';
import { RequestTrustDrawer } from '../components/RequestTrustDrawer';
import { WhatsAppLogo } from '../components/WhatsAppLogo';
import { fetchChatCopilot } from '../lib/aiApi';
import { BrokerCallSummary, ChatChemistry, ChatMatch, ChatMessage, MatchUnlockAction } from '../lib/chat';
import { ProfileReliabilitySummary } from '../lib/intentEscrow';
import { getRequestTrustSummary } from '../lib/intentEscrowApi';
import { getDisplayFirstName } from '../lib/profile';
import {
    acceptMatchRequest,
    createUnlockPaymentIntent,
    declineMatchRequest,
    fetchBrokerCallSummary,
    fetchChatMatchById,
    fetchChatMatches,
    fetchChatMessages,
    getCachedChatMatches,
    markInterestRequestFirstReply,
    markMatchMessagesRead,
    sendEscrowMessage,
    sendBrokerConsent,
    subscribeToAllBrokerCalls,
    subscribeToAllFollowupJobs,
    subscribeToBrokerCalls,
    subscribeToInterestRequests,
    subscribeToMatchMessages,
    triggerOutboundBrokerCall,
    triggerIntentCallback,
    unsubscribeFromChannel,
    updateMatchUnlock,
    clearTypingIndicator,
    getMatchPresence,
    setTypingIndicator,
    subscribeToTypingIndicators,
    subscribeToUserPresence,
    blockUser,
    reportUser,
    extendSlaDeadline,
} from '../lib/chatApi';
import { fetchCurrentProfile } from '../lib/profileApi';
import {
    getUnsupportedUnlockMessage,
    presentUnlockPaymentSheet,
    supportsUnlockPayments,
} from '../lib/paymentSheet';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';
import { supabase } from '../lib/supabase';
import { trackPremiumEvent } from '../lib/premiumAnalytics';
import { PremiumPromoVariant, resolvePremiumPromoVariant } from '../lib/premiumTargeting';
import {
    recordPremiumPopupCtaTapped,
    recordPremiumPopupDismissed,
    recordPremiumPopupShown,
    shouldShowPremiumPopup,
} from '../lib/premiumPopup';
import { PremiumPromoModal } from '../components/PremiumPromoModal';
import { PostAcceptanceCountdownBanner } from '../components/PostAcceptanceCountdownBanner';

type ChatScreenProps = {
    onClose: () => void;
    initialMatchListFilter?: ChatListFilter;
    initialVisibilityFilter?: MessageVisibilityFilter;
    isChatScreen?: boolean;
    onViewProfile?: (profileId: string) => void;
    onOpenNotifications?: () => void;
    unreadNotificationsCount?: number;
};

type RecoverySuggestionAction = 'request_unlock' | 'accept_unlock' | 'pay_unlock' | 'call' | 'whatsapp';

type RecoverySuggestion = {
    title: string;
    body: string;
    action: RecoverySuggestionAction | null;
    actionLabel: string | null;
};

function getPresenceStatusText(presence: { status: string; last_seen_at: string; is_online: boolean } | null) {
    if (!presence) return 'Offline';
    if (presence.is_online) return 'Online';
    
    const lastSeen = new Date(presence.last_seen_at).getTime();
    if (!lastSeen || isNaN(lastSeen)) return 'Offline';

    const diffMs = Date.now() - lastSeen;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `Active ${diffMins}m ago`;
    if (diffHours < 24) return `Active ${diffHours}h ago`;
    return `Active ${diffDays}d ago`;
}

export function ChatScreen({
    onClose,
    initialMatchListFilter = 'accepted',
    initialVisibilityFilter = 'all',
    isChatScreen = false,
    onViewProfile,
    onOpenNotifications,
    unreadNotificationsCount = 0,
}: ChatScreenProps) {
    const { width: windowWidth } = useWindowDimensions();
    const isNarrowHeader = windowWidth < 400;
    const initialCachedMatches = getCachedChatMatches();
    const [matches, setMatches] = useState<ChatMatch[]>(initialCachedMatches ?? []);
    const [matchesLoading, setMatchesLoading] = useState(!initialCachedMatches);
    const [matchesRefreshing, setMatchesRefreshing] = useState(false);
    const [matchSearchQuery, setMatchSearchQuery] = useState('');
    const [matchListFilter, setMatchListFilter] = useState<ChatListFilter>(initialMatchListFilter);
    const [messageVisibilityFilter, setMessageVisibilityFilter] = useState<MessageVisibilityFilter>(initialVisibilityFilter);
    const [activeMatch, setActiveMatch] = useState<ChatMatch | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [promptSuggestions, setPromptSuggestions] = useState<string[]>([]);
    const [promptsLoading, setPromptsLoading] = useState(false);
    const [chemistry, setChemistry] = useState<ChatChemistry | null>(null);
    const [unlocking, setUnlocking] = useState(false);
    const [matchRequestPending, setMatchRequestPending] = useState(false);
    const [matchRequestAction, setMatchRequestAction] = useState<'accept' | 'decline' | null>(null);
    const [matchRequestActionMatchId, setMatchRequestActionMatchId] = useState<string | null>(null);
    const [callbackPendingRequestId, setCallbackPendingRequestId] = useState<string | null>(null);
    const [brokerConsentPendingRequestId, setBrokerConsentPendingRequestId] = useState<string | null>(null);
    const [brokerNudgePendingRequestId, setBrokerNudgePendingRequestId] = useState<string | null>(null);
    const [extendingSla, setExtendingSla] = useState(false);
    const [brokerSummary, setBrokerSummary] = useState<BrokerCallSummary | null>(null);
    const [brokerSummaryLoading, setBrokerSummaryLoading] = useState(false);
    const [showBrokerTools, setShowBrokerTools] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [contactShareBlocked, setContactShareBlocked] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [currentUserFirstName, setCurrentUserFirstName] = useState('');
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    const [trustSummaries, setTrustSummaries] = useState<Record<string, ProfileReliabilitySummary>>({});
    const [trustDrawerMatch, setTrustDrawerMatch] = useState<Pick<ChatMatch, 'otherUserId' | 'otherUserName' | 'otherUserProfileOwner' | 'interestRequest'> | null>(null);
    const [trustLoadingProfileId, setTrustLoadingProfileId] = useState<string | null>(null);
    const [premiumPopup, setPremiumPopup] = useState<PremiumPromoVariant | null>(null);
    const [otherUserTyping, setOtherUserTyping] = useState(false);
    const [dropdownVisible, setDropdownVisible] = useState(false);
    const [otherUserPresence, setOtherUserPresence] = useState<{ user_id: string; status: string; last_seen_at: string; is_online: boolean } | null>(null);
    const lastSentTypingAt = useRef<number>(0);

    // Guards against overlapping / duplicate loadMatches runs (mount effect,
    // three realtime subscriptions and action handlers can all trigger it).
    // Concurrent callers share the single in-flight fetch instead of each
    // firing their own network round-trip.
    const matchesInFlightRef = useRef<Promise<void> | null>(null);

    useEffect(() => {
        // If we already have cached matches, refresh silently in the background
        // (no full-screen spinner). Otherwise show the loader for the first load.
        void loadMatches(!initialCachedMatches);
        void syncCurrentUser();
    }, []);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setCurrentTime(Date.now());
        }, 60000);

        return () => clearInterval(intervalId);
    }, []);

    useEffect(() => {
        let isMounted = true;
        const channel = subscribeToInterestRequests(() => {
            if (!isMounted) {
                return;
            }

            void loadMatches(false);

            if (activeMatch?.id) {
                void loadMessages(activeMatch.id);
            }
        });

        return () => {
            isMounted = false;
            void unsubscribeFromChannel(channel as RealtimeChannel);
        };
    }, [activeMatch?.id]);

    useEffect(() => {
        let isMounted = true;
        const channel = subscribeToAllBrokerCalls(() => {
            if (!isMounted) {
                return;
            }

            void loadMatches(false);
        });

        return () => {
            isMounted = false;
            void unsubscribeFromChannel(channel as RealtimeChannel);
        };
    }, []);

    useEffect(() => {
        let isMounted = true;
        const channel = subscribeToAllFollowupJobs(() => {
            if (!isMounted) {
                return;
            }

            void loadMatches(false);
        });

        return () => {
            isMounted = false;
            void unsubscribeFromChannel(channel as RealtimeChannel);
        };
    }, []);

    useEffect(() => {
        if (!activeMatch) {
            setOtherUserTyping(false);
            setOtherUserPresence(null);
            return;
        }

        void loadMessages(activeMatch.id);

        let isMounted = true;

        async function fetchInitialPresence() {
            try {
                const presence = await getMatchPresence(activeMatch!.id);
                if (isMounted) {
                    setOtherUserPresence(presence);
                }
            } catch (err) {
                console.warn('Failed to load initial match presence:', err);
            }
        }
        void fetchInitialPresence();

        const channel = subscribeToMatchMessages(activeMatch.id, (message) => {
            if (!isMounted) {
                return;
            }

            setMessages((current) => mergeMessages(current, [message]));

            if (message.senderId !== currentUserId) {
                void syncMatchReadState(activeMatch.id);
            }
        });

        const otherUserId = activeMatch.otherUserId;

        const typingChannel = subscribeToTypingIndicators(activeMatch.id, (payload) => {
            if (!isMounted) return;
            const { event, row } = payload;
            if (row && row.user_id === otherUserId) {
                if (event === 'DELETE') {
                    setOtherUserTyping(false);
                } else {
                    const expiresAt = new Date(row.expires_at).getTime();
                    if (expiresAt > Date.now()) {
                        setOtherUserTyping(true);
                    } else {
                        setOtherUserTyping(false);
                    }
                }
            }
        });

        let presenceChannel: any = null;
        if (otherUserId) {
            presenceChannel = subscribeToUserPresence(otherUserId, (newPresence) => {
                if (!isMounted) return;
                setOtherUserPresence({
                    user_id: newPresence.user_id,
                    status: newPresence.status,
                    last_seen_at: newPresence.last_seen_at,
                    is_online: newPresence.status === 'online' && (new Date(newPresence.last_seen_at).getTime() > Date.now() - 2 * 60 * 1000)
                });
            });
        }

        return () => {
            isMounted = false;
            void unsubscribeFromChannel(channel as RealtimeChannel);
            if (typingChannel) void unsubscribeFromChannel(typingChannel as RealtimeChannel);
            if (presenceChannel) void unsubscribeFromChannel(presenceChannel as RealtimeChannel);
            setOtherUserTyping(false);
            setOtherUserPresence(null);
            lastSentTypingAt.current = 0;
        };
    }, [activeMatch?.id, currentUserId]);

    useEffect(() => {
        if (!otherUserTyping) return;
        const timer = setTimeout(() => {
            setOtherUserTyping(false);
        }, 6000);
        return () => clearTimeout(timer);
    }, [otherUserTyping]);

    useEffect(() => {
        const requestId = activeMatch?.interestRequest?.id;
        if (!requestId) {
            return;
        }

        let isMounted = true;
        const channel = subscribeToBrokerCalls(requestId, () => {
            if (!isMounted) {
                return;
            }

            void refreshBrokerSummary(requestId);
        });

        return () => {
            isMounted = false;
            void unsubscribeFromChannel(channel as RealtimeChannel);
        };
    }, [activeMatch?.interestRequest?.id]);

    useEffect(() => {
        setPromptSuggestions([]);
        setChemistry(null);
        setShowBrokerTools(false);
    }, [activeMatch?.id]);

    useEffect(() => {
        setContactShareBlocked(false);
    }, [activeMatch?.id]);

    useEffect(() => {
        const requestId = activeMatch?.interestRequest?.id;
        if (!requestId) {
            setBrokerSummary(null);
            return;
        }

        let isMounted = true;
        setBrokerSummaryLoading(true);

        void fetchBrokerCallSummary(requestId)
            .then((summary) => {
                if (isMounted) {
                    setBrokerSummary(summary);
                }
            })
            .catch((error) => {
                console.warn('Could not load broker summary.', error);
                if (isMounted) {
                    setBrokerSummary(null);
                }
            })
            .finally(() => {
                if (isMounted) {
                    setBrokerSummaryLoading(false);
                }
            });

        return () => {
            isMounted = false;
        };
    }, [activeMatch?.interestRequest?.id]);

    useEffect(() => {
        if (!activeMatch || !currentUserId) {
            return;
        }

        void syncMatchReadState(activeMatch.id);
    }, [activeMatch?.id, currentUserId]);

    async function syncCurrentUser() {
        const {
            data: { user },
            error,
        } = await supabase.auth.getUser();

        if (error) {
            Alert.alert('Session error', error.message);
            return;
        }

        setCurrentUserId(user?.id ?? null);

        try {
            const profile = await fetchCurrentProfile(user?.id);
            setCurrentUserFirstName(getDisplayFirstName(profile?.full_name));
        } catch (profileError) {
            console.warn('Failed to load current user display name.', profileError);
        }
    }

    async function openTrustDrawer(match: ChatMatch) {
        setTrustDrawerMatch({
            otherUserId: match.otherUserId,
            otherUserName: match.otherUserName,
            otherUserProfileOwner: match.otherUserProfileOwner,
            interestRequest: match.interestRequest,
        });

        if (trustSummaries[match.otherUserId]) {
            return;
        }

        setTrustLoadingProfileId(match.otherUserId);

        try {
            const summary = await getRequestTrustSummary(match.otherUserId, {
                managedBy: match.otherUserProfileOwner ?? null,
                ghostRiskScore: match.matchRequestState === 'received' ? match.interestRequest?.senderGhostRiskScore ?? null : null,
            });

            setTrustSummaries((current) => ({
                ...current,
                [match.otherUserId]: summary,
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not load trust details.';
            Alert.alert('Trust summary unavailable', message);
        } finally {
            setTrustLoadingProfileId((current) => (current === match.otherUserId ? null : current));
        }
    }

    async function loadMatches(showLoader: boolean) {
        // If a fetch is already running, reuse it instead of starting a
        // duplicate network round-trip (dedupes dev double-mount + overlapping
        // realtime triggers).
        if (matchesInFlightRef.current) {
            return matchesInFlightRef.current;
        }

        if (showLoader) {
            setMatchesLoading(true);
        } else {
            setMatchesRefreshing(true);
        }

        const run = (async () => {
            try {
                const nextMatches = await fetchChatMatches();
                setMatches(nextMatches);

                if (activeMatch) {
                    const updatedActiveMatch = nextMatches.find((match) => match.id === activeMatch.id) ?? null;
                    setActiveMatch(updatedActiveMatch);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Could not load matches.';
                Alert.alert('Chat unavailable', message);
            } finally {
                setMatchesLoading(false);
                setMatchesRefreshing(false);
                matchesInFlightRef.current = null;
            }
        })();

        matchesInFlightRef.current = run;
        return run;
    }

    async function loadMessages(matchId: string) {
        setMessagesLoading(true);

        try {
            const nextMessages = await fetchChatMessages(matchId);
            setMessages(nextMessages);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not load messages.';
            Alert.alert('Message load failed', message);
        } finally {
            setMessagesLoading(false);
        }
    }

    async function syncMatchReadState(matchId: string) {
        if (!currentUserId) {
            return;
        }

        try {
            const updatedCount = await markMatchMessagesRead(matchId);

            if (updatedCount > 0) {
                const readTimestamp = new Date().toISOString();
                setMessages((current) =>
                    current.map((message) =>
                        message.matchId === matchId && message.senderId !== currentUserId && !message.readAt
                            ? { ...message, readAt: readTimestamp }
                            : message,
                    ),
                );
            }

            setMatches((current) =>
                current.map((match) => (match.id === matchId ? { ...match, unreadCount: 0 } : match)),
            );
            setActiveMatch((current) => (current?.id === matchId ? { ...current, unreadCount: 0 } : current));
        } catch (error) {
            console.warn('Could not mark messages as read.', error);
        }
    }

    async function handleContactAction(action: 'call' | 'whatsapp') {
        if (!activeMatch) {
            return;
        }

        await handleMatchCardContactAction(activeMatch, action);
    }

    async function handleMatchCardContactAction(match: ChatMatch, action: 'call' | 'whatsapp') {
        try {
            if (action === 'call') {
                if (!match.otherUserPhoneNumber) {
                    Alert.alert('No phone number', `${match.otherUserName} has not added a phone number yet.`);
                    return;
                }

                const callUrl = `tel:${encodeURIComponent(match.otherUserPhoneNumber)}`;
                const supported = await Linking.canOpenURL(callUrl);
                if (!supported) {
                    throw new Error('Calling is not supported on this device.');
                }

                await Linking.openURL(callUrl);
                return;
            }

            if (!match.otherUserWhatsappNumber) {
                Alert.alert('No WhatsApp number', `${match.otherUserName} has not added a WhatsApp number yet.`);
                return;
            }

            const normalizedNumber = match.otherUserWhatsappNumber.replace(/[^\d]/g, '');
            if (!normalizedNumber) {
                throw new Error('The WhatsApp number is invalid.');
            }

            await Linking.openURL(`https://wa.me/${normalizedNumber}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not open the contact action.';
            Alert.alert(action === 'call' ? 'Call unavailable' : 'WhatsApp unavailable', message);
        }
    }

    function handleMoreOptions() {
        if (!activeMatch) return;
        
        if (Platform.OS === 'web') {
            const action = window.prompt(
                `Choose an option for ${activeMatch.otherUserName}:\nType "block" to block, or "report" to report.`
            );
            if (action === null) return;
            const normalizedAction = action.trim().toLowerCase();
            if (normalizedAction === 'block') {
                confirmBlockUser(activeMatch.otherUserId, activeMatch.otherUserName);
            } else if (normalizedAction === 'report') {
                promptReportUser(activeMatch.otherUserId, activeMatch.otherUserName);
            } else if (normalizedAction) {
                alert('Invalid choice. Please type "block" or "report".');
            }
            return;
        }

        Alert.alert(
            'Options',
            `Choose an action for ${activeMatch.otherUserName}`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Report User',
                    style: 'destructive',
                    onPress: () => promptReportUser(activeMatch.otherUserId, activeMatch.otherUserName),
                },
                {
                    text: 'Block User',
                    style: 'destructive',
                    onPress: () => confirmBlockUser(activeMatch.otherUserId, activeMatch.otherUserName),
                },
            ]
        );
    }

    function promptReportUser(reportedId: string, reportedName: string) {
        if (Platform.OS === 'web') {
            const reason = window.prompt(
                `Report ${reportedName}:\nType a reason (e.g. "Inappropriate Messages", "Fake Profile / Scam", "Harassment", "Other"):`
            );
            if (reason) {
                submitUserReport(reportedId, reason.trim());
            }
            return;
        }

        Alert.alert(
            'Report User',
            `Why are you reporting ${reportedName}?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Inappropriate Messages',
                    onPress: () => submitUserReport(reportedId, 'Inappropriate Messages'),
                },
                {
                    text: 'Fake Profile / Scam',
                    onPress: () => submitUserReport(reportedId, 'Fake Profile / Scam'),
                },
                {
                    text: 'Harassment',
                    onPress: () => submitUserReport(reportedId, 'Harassment'),
                },
                {
                    text: 'Other',
                    onPress: () => submitUserReport(reportedId, 'Other (General)'),
                }
            ]
        );
    }

    async function submitUserReport(reportedId: string, reason: string) {
        try {
            await reportUser(reportedId, reason, `Reported via chat screen.`);
            if (Platform.OS === 'web') {
                alert('Report Submitted. Thank you.');
            } else {
                Alert.alert('Report Submitted', 'Thank you. The moderation team has been notified.');
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

    function confirmBlockUser(blockedId: string, blockedName: string) {
        if (Platform.OS === 'web') {
            const confirm = window.confirm(`Are you sure you want to block ${blockedName}? You will not see each other or be able to chat again.`);
            if (confirm) {
                void executeBlockUser(blockedId, blockedName);
            }
            return;
        }

        Alert.alert(
            'Block User',
            `Are you sure you want to block ${blockedName}? You will not see each other or be able to chat again.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Block',
                    style: 'destructive',
                    onPress: () => void executeBlockUser(blockedId, blockedName),
                }
            ]
        );
    }

    async function executeBlockUser(blockedId: string, blockedName: string) {
        try {
            await blockUser(blockedId);
            if (Platform.OS === 'web') {
                alert(`${blockedName} has been blocked.`);
            } else {
                Alert.alert('User Blocked', `${blockedName} has been blocked.`);
            }
            setActiveMatch(null);
            setNotice(null);
            void loadMatches(false);
        } catch (err) {
            console.error('Failed to block user:', err);
            if (Platform.OS === 'web') {
                alert('Could not block user.');
            } else {
                Alert.alert('Error', 'Could not block user.');
            }
        }
    }

    async function handleDraftChange(text: string) {
        setDraft(text);

        if (!activeMatch) return;

        const trimmed = text.trim();
        if (!trimmed) {
            try {
                await clearTypingIndicator(activeMatch.id);
            } catch (err) {
                // silent
            }
            return;
        }

        const now = Date.now();
        if (now - lastSentTypingAt.current > 3000) {
            lastSentTypingAt.current = now;
            try {
                await setTypingIndicator(activeMatch.id);
            } catch (err) {
                // silent
            }
        }
    }

    async function handleSend() {
        if (!activeMatch || sending || !draft.trim()) {
            return;
        }

        setSending(true);
        setNotice(null);

        try {
            try {
                void clearTypingIndicator(activeMatch.id);
            } catch (err) {
                // silent
            }
            const result = await sendEscrowMessage(activeMatch.id, draft);
            setDraft('');
            setMessages((current) => mergeMessages(current, [result.message]));
            setContactShareBlocked(result.blocked && !result.unlocked);
            setNotice(result.blocked ? null : result.notice);



            if (
                activeMatch.interestRequest?.status === 'accepted' &&
                activeMatch.interestRequest.senderId === currentUserId &&
                !activeMatch.interestRequest.firstReplyAt
            ) {
                try {
                    await markInterestRequestFirstReply(activeMatch.interestRequest.id);
                    const nextMatch = await fetchChatMatchById(activeMatch.id);
                    if (nextMatch) {
                        applyMatchUpdate(nextMatch);
                    }
                } catch (firstReplyError) {
                    console.warn('Could not mark the first reply SLA as complete.', firstReplyError);
                }
            }

            if (result.unlocked !== activeMatch.isUnlocked) {
                setActiveMatch({ ...activeMatch, isUnlocked: result.unlocked });
                setMatches((current) =>
                    current.map((match) =>
                        match.id === activeMatch.id ? { ...match, isUnlocked: result.unlocked } : match,
                    ),
                );
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not send the message.';
            Alert.alert('Send failed', message);
        } finally {
            setSending(false);
        }
    }

    async function handleUnlock() {
        if (!activeMatch || unlocking) {
            return;
        }

        const isWeb = Platform.OS === 'web';

        if (!isWeb && !supportsUnlockPayments()) {
            setNotice(getUnsupportedUnlockMessage());
            return;
        }

        setUnlocking(true);
        setNotice(null);

        try {
            const intent = await createUnlockPaymentIntent(
                activeMatch.id,
                isWeb ? {
                    isWeb: true,
                    successUrl: window.location.href,
                    cancelUrl: window.location.href,
                } : undefined
            );

            if (intent.alreadyUnlocked) {
                await refreshUnlockedMatch(activeMatch.id);
                setNotice('This conversation is already unlocked. Direct chat is available now.');
                return;
            }

            if (isWeb) {
                if (intent.checkoutUrl) {
                    window.location.href = intent.checkoutUrl;
                } else {
                    throw new Error('Checkout session URL was not returned.');
                }
                return;
            }

            const paymentSheetResult = await presentUnlockPaymentSheet(intent);

            if (paymentSheetResult.status === 'unsupported' || paymentSheetResult.status === 'canceled') {
                if (paymentSheetResult.message) {
                    setNotice(paymentSheetResult.message);
                }
                return;
            }

            const unlockedMatch = await waitForUnlock(activeMatch.id);
            if (unlockedMatch) {
                applyMatchUpdate(unlockedMatch);
                setNotice('Direct chat unlocked. Contact details can now be shared without AI redaction.');
                void maybeShowPremiumPopup();
            } else {
                const nextMatch = await refreshUnlockedMatch(activeMatch.id);
                if (nextMatch?.unlockState.hasCurrentUserPaid && !nextMatch.isUnlocked) {
                    setNotice(`Your payment is complete. Waiting for ${nextMatch.otherUserName} to pay their share.`);
                } else {
                    await loadMatches(false);
                    setNotice('Payment was submitted. Unlock confirmation can take a few seconds to appear.');
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not start the unlock flow.';
            Alert.alert('Unlock failed', message);
        } finally {
            if (!isWeb) {
                setUnlocking(false);
            }
        }
    }

    async function handleUnlockAction(action: MatchUnlockAction) {
        if (!activeMatch || unlocking) {
            return;
        }

        setUnlocking(true);
        setNotice(null);

        try {
            const result = await updateMatchUnlock(activeMatch.id, action);
            const nextMatch = await refreshUnlockedMatch(activeMatch.id);
            if (nextMatch) {
                applyMatchUpdate(nextMatch);
            }

            setNotice(
                result.message ??
                (action === 'request'
                    ? 'Unlock request sent.'
                    : action === 'accept'
                        ? 'Unlock request accepted.'
                        : 'Unlock request declined.'),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not update the unlock request.';
            Alert.alert('Unlock update failed', message);
        } finally {
            setUnlocking(false);
        }
    }

    async function handleRecoverySuggestionAction(action: RecoverySuggestionAction) {
        if (!activeMatch) {
            return;
        }

        if (action === 'request_unlock') {
            await handleUnlockAction('request');
            return;
        }

        if (action === 'accept_unlock') {
            await handleUnlockAction('accept');
            return;
        }

        if (action === 'pay_unlock') {
            await handleUnlock();
            return;
        }

        await handleMatchCardContactAction(activeMatch, action);
    }

    async function handleLoadPromptSuggestions() {
        if (!activeMatch || promptsLoading) {
            return;
        }

        setPromptsLoading(true);

        try {
            const result = await fetchChatCopilot(activeMatch.id);
            setPromptSuggestions(result.replySuggestions);
            setChemistry(result.chemistry);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'AI copilot is unavailable right now.';
            setNotice(message);
        } finally {
            setPromptsLoading(false);
        }
    }

    async function maybeShowPremiumPopup() {
        try {
            const variant = await resolvePremiumPromoVariant('chat_inbox');
            if (!(await shouldShowPremiumPopup(variant))) {
                return;
            }

            setPremiumPopup(variant);
            await recordPremiumPopupShown();
            void trackPremiumEvent({
                eventName: 'premium_promo_impression',
                surface: 'chat_inbox',
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
            surface: 'chat_inbox',
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
            surface: 'chat_inbox',
            context: `popup_${variant.id}_dismiss`,
            metadata: { placement: 'modal', variant: variant.id, experimentArm: variant.experimentArm },
        });
        void recordPremiumPopupDismissed();
        setPremiumPopup(null);
    }

    async function handleRequestAction(match: ChatMatch, action: 'accept' | 'decline') {
        if (matchRequestPending || match.matchRequestState !== 'received') {
            return;
        }

        setMatchRequestPending(true);
        setMatchRequestAction(action);
        setMatchRequestActionMatchId(match.id);
        setNotice(null);

        try {
            const result = action === 'accept' ? await acceptMatchRequest(match.id) : await declineMatchRequest(match.id);

            await loadMatches(false);

            if (activeMatch?.id === match.id) {
                const nextMatch = await fetchChatMatchById(match.id);
                setActiveMatch(nextMatch);

                if (action === 'accept') {
                    await loadMessages(match.id);
                }
            }

            setNotice(
                result.notice ??
                (action === 'accept'
                    ? 'Request accepted. A default reply was sent automatically.'
                    : 'Request declined.'),
            );

            if (action === 'accept') {
                void maybeShowPremiumPopup();
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : `Could not ${action} the request.`;
            Alert.alert(action === 'accept' ? 'Request accept failed' : 'Request decline failed', message);
        } finally {
            setMatchRequestPending(false);
            setMatchRequestAction(null);
            setMatchRequestActionMatchId(null);
        }
    }

    async function handleTriggerIntentCallback(match: ChatMatch, mode: 'availability_check' | 'schedule_prompt') {
        const requestId = match.interestRequest?.id;
        if (!requestId) {
            return;
        }

        setCallbackPendingRequestId(requestId);
        setNotice(null);

        try {
            await triggerIntentCallback(requestId, mode);
            const nextMatch = await fetchChatMatchById(match.id);
            if (nextMatch) {
                applyMatchUpdate(nextMatch);
            } else {
                await loadMatches(false);
            }

            setNotice('Callback queued. We\'ll update this soon.');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not queue the callback right now.';
            Alert.alert('Callback unavailable', message);
        } finally {
            setCallbackPendingRequestId((current) => (current === requestId ? null : current));
        }
    }

    async function refreshBrokerSummary(requestId: string) {
        try {
            const summary = await fetchBrokerCallSummary(requestId);
            setBrokerSummary(summary);
            return summary;
        } catch (error) {
            console.warn('Could not refresh broker summary.', error);
            return null;
        }
    }

    async function handleBrokerConsent(match: ChatMatch, consent: boolean) {
        const requestId = match.interestRequest?.id;
        if (!requestId) {
            return;
        }

        setBrokerConsentPendingRequestId(requestId);
        setNotice(null);

        try {
            const result = await sendBrokerConsent(requestId, consent, 'voice', 'retell');
            if (result.consentStatus === 'granted') {
                setNotice('Broker consent saved. You can now queue a broker nudge during this countdown window.');
            } else {
                setNotice('Broker consent declined. We will not queue broker outreach for this request.');
            }

            await refreshBrokerSummary(requestId);

            const nextMatch = await fetchChatMatchById(match.id);
            if (nextMatch) {
                applyMatchUpdate(nextMatch);
            } else {
                await loadMatches(false);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not save broker consent.';
            Alert.alert('Broker consent unavailable', message);
        } finally {
            setBrokerConsentPendingRequestId((current) => (current === requestId ? null : current));
        }
    }

    async function handleQueueBrokerNudge(match: ChatMatch, channel: 'voice' | 'sms_whatsapp') {
        const requestId = match.interestRequest?.id;
        if (!requestId) {
            return;
        }

        setBrokerNudgePendingRequestId(requestId);
        setNotice(null);

        try {
            const result = await triggerOutboundBrokerCall(requestId, match.otherUserId, {
                mode: 'countdown_nudge',
                channel,
                provider: channel === 'sms_whatsapp' ? 'twilio' : 'retell',
            });

            setNotice(
                result.notice ??
                `Broker ${channel === 'voice' ? 'voice' : 'WhatsApp'} nudge queued for this accepted request.`,
            );

            await refreshBrokerSummary(requestId);

            const nextMatch = await fetchChatMatchById(match.id);
            if (nextMatch) {
                applyMatchUpdate(nextMatch);
            } else {
                await loadMatches(false);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not queue a broker nudge.';
            Alert.alert('Broker nudge unavailable', message);
        } finally {
            setBrokerNudgePendingRequestId((current) => (current === requestId ? null : current));
        }
    }

    async function handleExtendSla(match: ChatMatch) {
        const requestId = match.interestRequest?.id;
        if (!requestId) return;

        setExtendingSla(true);
        try {
            const updatedRequest = await extendSlaDeadline(requestId);
            Alert.alert('Deadline Extended', 'Your reply SLA deadline has been extended by 24 hours.');
            
            const nextMatch = await fetchChatMatchById(match.id);
            if (nextMatch) {
                applyMatchUpdate({
                    ...nextMatch,
                    interestRequest: updatedRequest,
                });
            } else {
                await loadMatches(false);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not extend deadline.';
            Alert.alert('Extension failed', message);
        } finally {
            setExtendingSla(false);
        }
    }

    const chatHeaderSubtitle = useMemo(() => {
        if (!activeMatch) {
            return '';
        }

        if (activeMatch.matchRequestState === 'received') {
            return 'This request is in your Inbox and this chat thread.';
        }

        if (activeMatch.matchRequestState === 'sent') {
            return 'Your request is visible in Chat while you wait for acceptance.';
        }

        if (activeMatch.interestRequest?.status === 'ghosted') {
            return 'This request expired because the sender did not reply after acceptance.';
        }

        if (
            activeMatch.interestRequest?.status === 'accepted' &&
            activeMatch.interestRequest.senderId === currentUserId &&
            activeMatch.interestRequest.firstReplyDueAt &&
            !activeMatch.interestRequest.firstReplyAt
        ) {
            return `Reply within ${formatCountdownLabel(activeMatch.interestRequest.firstReplyDueAt, currentTime)} to keep this request active.`;
        }

        return activeMatch.isUnlocked
            ? ''
            : '';
    }, [activeMatch, currentTime, currentUserFirstName, currentUserId]);

    const inboxTabCounts = useMemo(
        () => ({
            received: matches.filter((match) => matchesChatListFilter(match, 'received')).length,
            accepted: matches.filter((match) => matchesChatListFilter(match, 'accepted')).length,
            contacts: matches.filter((match) => matchesChatListFilter(match, 'contacts')).length,
            sent: matches.filter((match) => matchesChatListFilter(match, 'sent')).length,
        }),
        [matches],
    );

    const unreadMatchCount = useMemo(
        () => matches.filter((match) => match.unreadCount > 0).length,
        [matches],
    );

    const needsReplyCount = useMemo(
        () => matches.filter((match) => requiresReplySoon(match, currentUserId)).length,
        [currentUserId, matches],
    );

    const visibleMatches = useMemo(() => {
        const normalizedSearch = matchSearchQuery.trim().toLowerCase();

        return matches.filter((match) => {
            const matchesSearch =
                !normalizedSearch ||
                match.otherUserName.toLowerCase().includes(normalizedSearch) ||
                match.otherUserLocation.toLowerCase().includes(normalizedSearch) ||
                (match.otherUserBio ?? '').toLowerCase().includes(normalizedSearch) ||
                (match.otherUserPreferences ?? '').toLowerCase().includes(normalizedSearch);

            if (!matchesSearch) {
                return false;
            }

            if (messageVisibilityFilter === 'unread' && match.unreadCount === 0) {
                return false;
            }

            if (messageVisibilityFilter === 'needs_reply' && !requiresReplySoon(match, currentUserId)) {
                return false;
            }

            return matchesChatListFilter(match, matchListFilter);
        });
    }, [currentUserId, matchListFilter, matchSearchQuery, matches, messageVisibilityFilter]);

    // The message list is rendered `inverted`, so it needs the newest item
    // first. Memoize the reversed copy so we don't clone/reverse the whole
    // array on every render (e.g. the 60s currentTime tick or any keystroke).
    const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

    const canQueueBrokerNudge = !brokerSummaryLoading && brokerSummary?.otherUserConsent === 'granted';
    const hasCurrentUserBrokerConsent = brokerSummary?.currentUserConsent === 'granted';
    const activeBrokerDetail = getBrokerSummaryDetail(brokerSummary);
    const isCurrentUserOriginalSender = activeMatch?.interestRequest?.senderId === currentUserId;
    const canQueueCurrentBrokerNudge = !isCurrentUserOriginalSender && canQueueBrokerNudge;

    const unlockCardCopy = activeMatch ? getUnlockCardCopy(activeMatch, contactShareBlocked) : null;
    const unlockModalVisible = Boolean(activeMatch && !activeMatch.isUnlocked && contactShareBlocked && unlockCardCopy);
    const activeRecoverySuggestion = useMemo(
        () => (activeMatch ? getRecoverySuggestion(activeMatch) : null),
        [activeMatch],
    );

    function applyMatchUpdate(nextMatch: ChatMatch) {
        setActiveMatch(nextMatch);
        setMatches((current) =>
            current.map((match) => (match.id === nextMatch.id ? nextMatch : match)),
        );
    }

    function dismissUnlockModal() {
        setContactShareBlocked(false);
    }

    async function refreshUnlockedMatch(matchId: string) {
        const nextMatch = await fetchChatMatchById(matchId);
        if (nextMatch) {
            applyMatchUpdate(nextMatch);
        }
        return nextMatch;
    }

    async function waitForUnlock(matchId: string) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
            const nextMatch = await refreshUnlockedMatch(matchId);
            if (nextMatch?.isUnlocked) {
                return nextMatch;
            }

            await new Promise((resolve) => {
                setTimeout(resolve, 1500);
            });
        }

        return null;
    }

    return (
        <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.container}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
            >
                <View style={styles.headerRow}>
                    <View style={styles.headerTitleRow}>
                        <BackButton
                            onPress={() => {
                                if (activeMatch) {
                                    setActiveMatch(null);
                                    setNotice(null);
                                    return;
                                }

                                onClose();
                            }}
                        />

                        <Pressable
                            style={styles.headerProfileContainer}
                            onPress={() => {
                                if (activeMatch) {
                                    onViewProfile?.(activeMatch.otherUserId);
                                }
                            }}
                            disabled={!activeMatch}
                        >
                            {activeMatch ? (
                                <>
                                    {activeMatch.otherUserPhotoUrls?.[0] ? (
                                        <Image source={{ uri: activeMatch.otherUserPhotoUrls[0] }} style={styles.headerAvatar} />
                                    ) : (
                                        <View style={styles.headerAvatarPlaceholder}>
                                            <Text style={styles.headerAvatarInitial}>
                                                {activeMatch.otherUserName.slice(0, 1).toUpperCase()}
                                            </Text>
                                        </View>
                                    )}
                                    <View style={styles.headerCopy}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
                                                {activeMatch.otherUserName}
                                            </Text>
                                            {activeMatch.otherUserVerificationStatus === 'verified' ? (
                                                <Text style={{ fontSize: 14, marginLeft: 4, color: '#1a7a5e' }}>✅</Text>
                                            ) : null}
                                        </View>
                                        <Text
                                            style={[
                                                styles.headerSubtitle,
                                                otherUserTyping ? styles.headerSubtitleTyping : null,
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {otherUserTyping ? 'typing...' : getPresenceStatusText(otherUserPresence)}
                                        </Text>
                                    </View>
                                </>
                            ) : (
                                <View style={styles.headerCopy}>
                                    <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
                                        {currentUserFirstName ? `${currentUserFirstName}'s chats` : 'Escrow Chat'}
                                    </Text>
                                </View>
                            )}
                        </Pressable>

                        {activeMatch ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, zIndex: 1000 }}>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.copilotHeaderButton,
                                        pressed && styles.headerButtonPressed,
                                    ]}
                                    onPress={() => {
                                        if (promptSuggestions.length > 0 || chemistry) {
                                            setPromptSuggestions([]);
                                            setChemistry(null);
                                        } else {
                                            void handleLoadPromptSuggestions();
                                        }
                                    }}
                                    disabled={promptsLoading}
                                    accessibilityRole="button"
                                    accessibilityLabel="AI chat copilot"
                                >
                                    <Text style={styles.copilotHeaderButtonText}>
                                        {promptsLoading ? '✨…' : '✨ Help'}
                                    </Text>
                                </Pressable>
                                <View style={{ position: 'relative', zIndex: 1100 }}>
                                    <Pressable
                                        style={({ pressed }) => [
                                            styles.moreHeaderButton,
                                            pressed && styles.headerButtonPressed,
                                        ]}
                                        onPress={() => setDropdownVisible(!dropdownVisible)}
                                        accessibilityRole="button"
                                        accessibilityLabel="More options"
                                    >
                                        <Text style={styles.moreHeaderButtonText}>⋮</Text>
                                    </Pressable>

                                    {dropdownVisible && (
                                        <>
                                            <Pressable
                                                style={styles.dropdownBackdrop}
                                                onPress={() => setDropdownVisible(false)}
                                            />
                                            <View style={styles.headerDropdownMenu}>
                                                <Pressable
                                                    style={styles.headerDropdownItem}
                                                    onPress={() => {
                                                        setDropdownVisible(false);
                                                        confirmBlockUser(activeMatch.otherUserId, activeMatch.otherUserName);
                                                    }}
                                                >
                                                    <Text style={styles.headerDropdownItemText}>Block User</Text>
                                                </Pressable>
                                                <View style={styles.headerDropdownDivider} />
                                                <Pressable
                                                    style={styles.headerDropdownItem}
                                                    onPress={() => {
                                                        setDropdownVisible(false);
                                                        promptReportUser(activeMatch.otherUserId, activeMatch.otherUserName);
                                                    }}
                                                >
                                                    <Text style={styles.headerDropdownItemTextDestructive}>Report User</Text>
                                                </Pressable>
                                            </View>
                                        </>
                                    )}
                                </View>
                            </View>
                        ) : (
                            onOpenNotifications && (
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.moreHeaderButton,
                                        { width: 42, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center', position: 'relative' },
                                        pressed && styles.headerButtonPressed,
                                    ]}
                                    onPress={onOpenNotifications}
                                >
                                    <Text style={{ fontSize: 18 }}>🔔</Text>
                                    {unreadNotificationsCount > 0 && (
                                        <View style={{
                                            position: 'absolute',
                                            right: -2,
                                            top: -2,
                                            backgroundColor: '#ef4444',
                                            borderRadius: 6,
                                            width: 12,
                                            height: 12,
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }} />
                                    )}
                                </Pressable>
                            )
                        )}
                    </View>

                    {activeMatch?.isUnlocked && (
                        <View style={styles.contactActionSubBar}>
                            {activeMatch.otherUserPhoneNumber ? (
                                <Pressable
                                    style={({ pressed }) => [styles.subBarCallButton, pressed && styles.subBarButtonPressed]}
                                    onPress={() => void handleContactAction('call')}
                                >
                                    <PhoneIcon size={16} color="#ffffff" />
                                    <Text style={styles.subBarCallText}>Call {activeMatch.otherUserName}</Text>
                                </Pressable>
                            ) : null}
                            {activeMatch.otherUserWhatsappNumber ? (
                                <Pressable
                                    style={({ pressed }) => [styles.subBarWhatsappButton, pressed && styles.subBarButtonPressed]}
                                    onPress={() => void handleContactAction('whatsapp')}
                                >
                                    <WhatsAppLogo size={16} color="#ffffff" />
                                    <Text style={styles.subBarWhatsappText}>WhatsApp</Text>
                                </Pressable>
                            ) : null}
                            {!activeMatch.otherUserPhoneNumber && !activeMatch.otherUserWhatsappNumber && (
                                <View style={styles.subBarUnlockNoteBadge}>
                                    <Text style={styles.subBarUnlockNoteIcon}>🔓</Text>
                                    <Text style={styles.subBarUnlockNoteText}>No contact details available yet</Text>
                                </View>
                            )}
                        </View>
                    )}

                    {chatHeaderSubtitle ? <Text style={styles.subtitle}>{chatHeaderSubtitle}</Text> : null}
                </View>

                {!activeMatch ? (
                    <View style={styles.listArea}>
                        {matchesLoading ? (
                            <View style={styles.centeredState}>
                                <InboxSkeletonList />
                                <Text style={styles.stateText}>Loading your conversations...</Text>
                            </View>
                        ) : matches.length === 0 ? (
                            <View style={styles.emptyCard}>
                                <Text style={styles.emptyTitle}>No conversations yet</Text>
                                <Text style={styles.emptyBody}>
                                    Swipe right on a match from the feed first. Each interested swipe creates a pending conversation here.
                                </Text>

                                <Pressable
                                    style={styles.refreshButton}
                                    onPress={() => void loadMatches(false)}
                                    disabled={matchesRefreshing}
                                >
                                    <Text style={styles.refreshButtonText}>
                                        {matchesRefreshing ? 'Refreshing...' : 'Refresh chats'}
                                    </Text>
                                </Pressable>
                            </View>
                        ) : (
                            <>
                                <View style={styles.inboxToolbarCard}>
                                    <TextInput
                                        style={styles.inboxSearchInput}
                                        placeholder="Search chats by name, city, or profile text"
                                        placeholderTextColor="#8b9aa0"
                                        value={matchSearchQuery}
                                        onChangeText={setMatchSearchQuery}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                    />

                                    {!isChatScreen && (
                                        <FlatList
                                            data={chatListFilters}
                                            horizontal
                                            keyExtractor={(item) => item.value}
                                            showsHorizontalScrollIndicator={false}
                                            contentContainerStyle={styles.matchFilterList}
                                            renderItem={({ item }) => (
                                                <MatchFilterChip
                                                    label={item.label}
                                                    count={inboxTabCounts[item.value]}
                                                    active={matchListFilter === item.value}
                                                    onPress={() => setMatchListFilter(item.value)}
                                                />
                                            )}
                                        />
                                    )}

                                    <ScrollView
                                        horizontal
                                        showsHorizontalScrollIndicator={false}
                                        contentContainerStyle={styles.messageVisibilityRow}
                                        style={styles.messageVisibilityScroller}
                                    >
                                        <MatchFilterChip
                                            label="All"
                                            count={matches.length}
                                            active={messageVisibilityFilter === 'all'}
                                            onPress={() => setMessageVisibilityFilter('all')}
                                        />
                                        <MatchFilterChip
                                            label="Unread"
                                            count={unreadMatchCount}
                                            active={messageVisibilityFilter === 'unread'}
                                            onPress={() => setMessageVisibilityFilter('unread')}
                                        />
                                        {!isChatScreen && (
                                            <MatchFilterChip
                                                label="Needs reply"
                                                count={needsReplyCount}
                                                active={messageVisibilityFilter === 'needs_reply'}
                                                onPress={() => setMessageVisibilityFilter('needs_reply')}
                                            />
                                        )}
                                    </ScrollView>
                                </View>

                                {visibleMatches.length === 0 ? (
                                    <View style={styles.emptyCard}>
                                        <Text style={styles.emptyTitle}>{getEmptyInboxTitle(matchListFilter)}</Text>
                                        <Text style={styles.emptyBody}>{getEmptyInboxBody(matchListFilter)}</Text>

                                        <Pressable
                                            style={styles.refreshButton}
                                            onPress={() => {
                                                setMatchSearchQuery('');
                                                setMatchListFilter('accepted');
                                                setMessageVisibilityFilter('all');
                                            }}
                                        >
                                            <Text style={styles.refreshButtonText}>Clear filters</Text>
                                        </Pressable>
                                    </View>
                                ) : (
                                    <FlatList
                                        data={visibleMatches}
                                        keyExtractor={(item) => item.id}
                                        contentContainerStyle={styles.matchListContent}
                                        initialNumToRender={8}
                                        maxToRenderPerBatch={8}
                                        windowSize={7}
                                        removeClippedSubviews
                                        renderItem={({ item }) => {
                                            if (isChatScreen) {
                                                return (
                                                    <ChatListItemCard
                                                        item={item}
                                                        onPress={() => {
                                                            setNotice(null);
                                                            setActiveMatch(item);
                                                        }}
                                                    />
                                                );
                                            }

                                            const handleCardPress = () => {
                                                const premiumHighlight = getPremiumInboxHighlight(item);
                                                if (premiumHighlight) {
                                                    void trackPremiumEvent({
                                                        eventName: 'premium_highlight_card_open',
                                                        surface: 'chat_inbox',
                                                        context: 'match_card',
                                                        metadata: {
                                                            matchId: item.id,
                                                            otherUserId: item.otherUserId,
                                                            reason: premiumHighlight,
                                                        },
                                                    });
                                                }

                                                if (matchListFilter === 'received' || matchListFilter === 'sent' || (matchListFilter === 'accepted' && initialMatchListFilter === 'received')) {
                                                    onViewProfile?.(item.otherUserId);
                                                } else {
                                                    setNotice(null);
                                                    setActiveMatch(item);
                                                }
                                            };

                                            return (
                                                <ProfileListItemCard
                                                    item={item}
                                                    onPress={handleCardPress}
                                                    currentUserId={currentUserId}
                                                    matchRequestPending={matchRequestPending}
                                                    matchRequestAction={matchRequestAction}
                                                    matchRequestActionMatchId={matchRequestActionMatchId}
                                                    brokerConsentPendingRequestId={brokerConsentPendingRequestId}
                                                    onAcceptRequest={(m) => void handleRequestAction(m, 'accept')}
                                                    onDeclineRequest={(m) => void handleRequestAction(m, 'decline')}
                                                    onBrokerConsent={(m, consent) => void handleBrokerConsent(m, consent)}
                                                    onContactAction={(m, act) => void handleMatchCardContactAction(m, act)}
                                                    onOpenChat={(m) => {
                                                        setNotice(null);
                                                        setActiveMatch(m);
                                                    }}
                                                    onViewProfile={onViewProfile}
                                                />
                                            );
                                        }}
                                    />
                                )}
                            </>
                        )}
                    </View>
                ) : (
                    <>
                        {notice ? (
                            <View style={styles.noticeCard}>
                                <Text style={styles.noticeText}>{notice}</Text>
                            </View>
                        ) : null}

                        <Modal
                            transparent
                            animationType="fade"
                            visible={unlockModalVisible}
                            onRequestClose={dismissUnlockModal}
                        >
                            <View style={styles.unlockModalBackdrop}>
                                <Pressable style={styles.unlockModalScrim} onPress={dismissUnlockModal} />

                                <View style={styles.unlockModalSheet}>
                                    <View style={styles.unlockModalTopRow}>
                                        <Text style={styles.unlockModalLabel}>Share contacts after mutual unlock</Text>

                                        <Pressable style={styles.unlockModalCloseButton} onPress={dismissUnlockModal}>
                                            <Text style={styles.unlockModalCloseButtonText}>Close</Text>
                                        </Pressable>
                                    </View>

                                    <View style={styles.unlockCard}>
                                        <View style={styles.unlockHeaderRow}>
                                            <View style={styles.unlockCopy}>
                                                <Text style={styles.unlockEyebrow}>{unlockCardCopy?.eyebrow}</Text>
                                                <Text style={styles.unlockTitle}>{unlockCardCopy?.title}</Text>
                                            </View>

                                            <Text style={styles.unlockBadge}>{unlockCardCopy?.badge}</Text>
                                        </View>

                                        <Text style={styles.unlockBody}>{unlockCardCopy?.body}</Text>

                                        <View style={styles.unlockActionsRow}>
                                            {unlockCardCopy?.primaryAction ? (
                                                <Pressable
                                                    style={[styles.unlockButton, unlocking ? styles.sendButtonDisabled : null]}
                                                    onPress={() =>
                                                        void (unlockCardCopy.primaryAction === 'pay'
                                                            ? handleUnlock()
                                                            : handleUnlockAction(unlockCardCopy.primaryAction as MatchUnlockAction))
                                                    }
                                                    disabled={unlocking}
                                                >
                                                    <Text style={styles.unlockButtonText}>
                                                        {unlocking
                                                            ? 'Working...'
                                                            : unlockCardCopy.primaryLabel}
                                                    </Text>
                                                </Pressable>
                                            ) : null}

                                            {unlockCardCopy?.secondaryAction ? (
                                                <Pressable
                                                    style={[styles.unlockSecondaryButton, unlocking ? styles.sendButtonDisabled : null]}
                                                    onPress={() =>
                                                        void handleUnlockAction(unlockCardCopy.secondaryAction as MatchUnlockAction)
                                                    }
                                                    disabled={unlocking}
                                                >
                                                    <Text style={styles.unlockSecondaryButtonText}>
                                                        {unlockCardCopy.secondaryLabel}
                                                    </Text>
                                                </Pressable>
                                            ) : null}
                                        </View>
                                    </View>
                                </View>
                            </View>
                        </Modal>

                        {activeMatch.status === 'pending' ? (
                            <View style={styles.requestCard}>
                                <View style={styles.requestHeaderRow}>
                                    <View style={styles.requestCopy}>
                                        <Text style={styles.requestEyebrow}>
                                            {activeMatch.matchRequestState === 'received' ? 'New request' : 'Request pending'}
                                        </Text>
                                        <Text style={styles.requestTitle}>
                                            {activeMatch.matchRequestState === 'received'
                                                ? `${activeMatch.otherUserName} wants to connect`
                                                : `Waiting for ${activeMatch.otherUserName}`}
                                        </Text>
                                    </View>

                                    <Text style={styles.requestBadge}>
                                        {activeMatch.matchRequestState === 'received' ? 'Inbox' : 'Chat'}
                                    </Text>
                                </View>

                                <Text style={styles.requestBody}>
                                    {activeMatch.matchRequestState === 'received'
                                        ? 'This request now appears in your Inbox and this chat thread. Accept it to move the match into an active conversation. A default reply will be sent automatically.'
                                        : 'Your request is now visible in Inbox and Chat. The other person can accept it from here, and their default reply will appear automatically once they do.'}
                                </Text>

                                {activeMatch.interestRequest?.personalizedReason ? (
                                    <View style={styles.requestReasonCard}>
                                        <Text style={styles.requestReasonLabel}>
                                            {activeMatch.matchRequestState === 'received' ? 'Reason they sent' : 'Reason you sent'}
                                        </Text>
                                        <Text style={styles.requestReasonText}>{activeMatch.interestRequest.personalizedReason}</Text>
                                    </View>
                                ) : null}

                                {activeMatch.matchRequestState === 'received' ? (
                                    <View style={styles.requestActionsRow}>
                                        <Pressable
                                            style={[styles.requestPrimaryButton, matchRequestPending ? styles.sendButtonDisabled : null]}
                                            onPress={() => void handleRequestAction(activeMatch, 'accept')}
                                            disabled={matchRequestPending}
                                        >
                                            <Text style={styles.requestPrimaryButtonText}>
                                                {matchRequestPending && matchRequestAction === 'accept' && matchRequestActionMatchId === activeMatch.id
                                                    ? 'Accepting...'
                                                    : 'Accept request'}
                                            </Text>
                                        </Pressable>

                                        <Pressable
                                            style={[styles.requestSecondaryButton, matchRequestPending ? styles.sendButtonDisabled : null]}
                                            onPress={() => void handleRequestAction(activeMatch, 'decline')}
                                            disabled={matchRequestPending}
                                        >
                                            <Text style={styles.requestSecondaryButtonText}>
                                                {matchRequestPending && matchRequestAction === 'decline' && matchRequestActionMatchId === activeMatch.id
                                                    ? 'Declining...'
                                                    : 'Decline'}
                                            </Text>
                                        </Pressable>
                                    </View>
                                ) : null}
                            </View>
                        ) : null}

                        <RequestTrustDrawer
                            visible={Boolean(trustDrawerMatch)}
                            loading={Boolean(trustDrawerMatch) && trustLoadingProfileId === trustDrawerMatch?.otherUserId}
                            summary={trustDrawerMatch ? trustSummaries[trustDrawerMatch.otherUserId] ?? null : null}
                            subjectName={trustDrawerMatch?.otherUserName ?? 'Trust summary'}
                            onClose={() => {
                                setTrustDrawerMatch(null);
                                setTrustLoadingProfileId(null);
                            }}
                        />

                        {activeMatch.interestRequest &&
                            activeMatch.interestRequest.senderId === currentUserId &&
                            !activeMatch.interestRequest.firstReplyAt &&
                            activeMatch.interestRequest.firstReplyDueAt ? (
                            <View style={styles.deadlineCardMuted}>
                                <Text style={styles.deadlineTitleMuted}>Waiting for your reply</Text>
                                <Text style={styles.deadlineBodyMuted}>
                                    You still have {formatCountdownLabel(activeMatch.interestRequest.firstReplyDueAt, currentTime)} to follow up after acceptance.
                                </Text>

                                {!activeMatch.interestRequest.slaExtended ? (
                                    <Pressable
                                        style={[
                                            styles.callbackActionButton,
                                            { marginTop: 8, marginBottom: 12, alignSelf: 'flex-start', backgroundColor: '#d9643d' },
                                            extendingSla ? styles.sendButtonDisabled : null
                                        ]}
                                        onPress={() => void handleExtendSla(activeMatch)}
                                        disabled={extendingSla}
                                    >
                                        <Text style={[styles.callbackActionButtonText, { color: '#ffffff' }]}>
                                            {extendingSla ? 'Extending…' : 'Extend Reply SLA (+24h)'}
                                        </Text>
                                    </Pressable>
                                ) : (
                                    <Text style={[styles.deadlineBodyMuted, { fontSize: 13, marginTop: 4, marginBottom: 12, fontStyle: 'italic', color: '#888' }]}>
                                        (SLA has been extended by 24h)
                                    </Text>
                                )}

                                <BrokerToolsToggle
                                    open={showBrokerTools}
                                    onToggle={() => setShowBrokerTools((prev) => !prev)}
                                    summary="Voice reminder"
                                />

                                {showBrokerTools ? (
                                    <>
                                        <View style={styles.brokerActionsRow}>
                                            <Pressable
                                                style={[
                                                    styles.callbackActionButton,
                                                    brokerNudgePendingRequestId === activeMatch.interestRequest.id
                                                        ? styles.sendButtonDisabled
                                                        : null,
                                                ]}
                                                onPress={() => void handleQueueBrokerNudge(activeMatch, 'voice')}
                                                disabled={brokerNudgePendingRequestId === activeMatch.interestRequest.id}
                                            >
                                                <Text style={styles.callbackActionButtonText}>
                                                    {brokerNudgePendingRequestId === activeMatch.interestRequest.id
                                                        ? 'Sending…'
                                                        : 'Send a voice reminder'}
                                                </Text>
                                            </Pressable>
                                        </View>
                                    </>
                                ) : null}
                            </View>
                        ) : null}

                        {activeMatch.interestRequest &&
                            activeMatch.interestRequest.senderId === currentUserId &&
                            messages.filter((m) => m.senderId === activeMatch.otherUserId).length <= 1 &&
                            (activeMatch.interestRequest.firstReplyAt || !activeMatch.interestRequest.firstReplyDueAt) ? (
                            <View style={styles.deadlineCardMuted}>
                                <Text style={styles.deadlineTitleMuted}>Waiting for {activeMatch.otherUserName} to reply</Text>
                                <Text style={styles.deadlineBodyMuted}>
                                    You've sent your follow-up. We can nudge them with a voice reminder if they haven't responded.
                                </Text>

                                <BrokerToolsToggle
                                    open={showBrokerTools}
                                    onToggle={() => setShowBrokerTools((prev) => !prev)}
                                    summary="Voice reminder"
                                />

                                {showBrokerTools ? (
                                    <>
                                        <View style={styles.brokerActionsRow}>
                                            <Pressable
                                                style={[
                                                    styles.callbackActionButton,
                                                    brokerNudgePendingRequestId === activeMatch.interestRequest.id
                                                        ? styles.sendButtonDisabled
                                                        : null,
                                                ]}
                                                onPress={() => void handleQueueBrokerNudge(activeMatch, 'voice')}
                                                disabled={brokerNudgePendingRequestId === activeMatch.interestRequest.id}
                                            >
                                                <Text style={styles.callbackActionButtonText}>
                                                    {brokerNudgePendingRequestId === activeMatch.interestRequest.id
                                                        ? 'Sending…'
                                                        : 'Send a voice reminder'}
                                                </Text>
                                            </Pressable>
                                        </View>
                                    </>
                                ) : null}
                            </View>
                        ) : null}

                        {activeMatch.interestRequest?.status === 'accepted' &&
                            activeMatch.interestRequest.senderId === activeMatch.otherUserId &&
                            messages.filter((m) => m.senderId === activeMatch.otherUserId).length <= 1 &&
                            activeMatch.interestRequest.firstReplyDueAt ? (
                            <View style={styles.deadlineCardMuted}>
                                <Text style={styles.deadlineTitleMuted}>Waiting for their first reply</Text>
                                <Text style={styles.deadlineBodyMuted}>
                                    {activeMatch.otherUserName} still has {formatCountdownLabel(activeMatch.interestRequest.firstReplyDueAt, currentTime)} to follow up after acceptance.
                                </Text>

                                <BrokerToolsToggle
                                    open={showBrokerTools}
                                    onToggle={() => setShowBrokerTools((prev) => !prev)}
                                    summary="Voice reminder"
                                />

                                {showBrokerTools ? (
                                    <>
                                        <View style={styles.brokerActionsRow}>
                                            <Pressable
                                                style={[
                                                    styles.callbackActionButton,
                                                    brokerNudgePendingRequestId === activeMatch.interestRequest.id
                                                        ? styles.sendButtonDisabled
                                                        : null,
                                                ]}
                                                onPress={() => void handleQueueBrokerNudge(activeMatch, 'voice')}
                                                disabled={brokerNudgePendingRequestId === activeMatch.interestRequest.id}
                                            >
                                                <Text style={styles.callbackActionButtonText}>
                                                    {brokerNudgePendingRequestId === activeMatch.interestRequest.id
                                                        ? 'Sending…'
                                                        : 'Send a voice reminder'}
                                                </Text>
                                            </Pressable>
                                        </View>
                                    </>
                                ) : null}
                            </View>
                        ) : null}

                        {activeMatch.interestRequest?.status === 'ghosted' ? (
                            <View style={styles.deadlineCardMuted}>
                                <Text style={styles.deadlineTitleMuted}>Request expired</Text>
                                <Text style={styles.deadlineBodyMuted}>
                                    This request expired because the sender did not reply after acceptance.
                                </Text>

                                <BrokerToolsToggle
                                    open={showBrokerTools}
                                    onToggle={() => setShowBrokerTools((prev) => !prev)}
                                    summary="Voice reminder"
                                />

                                {showBrokerTools ? (
                                    <>
                                        <View style={styles.brokerActionsRow}>
                                            <Pressable
                                                style={[
                                                    styles.callbackActionButton,
                                                    brokerNudgePendingRequestId === activeMatch.interestRequest.id
                                                        ? styles.sendButtonDisabled
                                                        : null,
                                                ]}
                                                onPress={() => void handleQueueBrokerNudge(activeMatch, 'voice')}
                                                disabled={brokerNudgePendingRequestId === activeMatch.interestRequest.id}
                                            >
                                                <Text style={styles.callbackActionButtonText}>
                                                    {brokerNudgePendingRequestId === activeMatch.interestRequest.id
                                                        ? 'Sending…'
                                                        : 'Send a voice reminder'}
                                                </Text>
                                            </Pressable>
                                        </View>
                                    </>
                                ) : null}
                            </View>
                        ) : null}

                        {activeMatch.interestRequest?.status === 'declined' ? (
                            <View style={styles.deadlineCardMuted}>
                                <Text style={styles.deadlineTitleMuted}>Request declined</Text>
                                <Text style={styles.deadlineBodyMuted}>
                                    This request was declined. You can keep chatting only if a new request flow starts later.
                                </Text>
                            </View>
                        ) : null}

                        {activeMatch.unlockState.canAccept ? (
                            <View style={styles.unlockRequestInlineCard}>
                                <View style={styles.unlockHeaderRow}>
                                    <View style={styles.unlockCopy}>
                                        <Text style={styles.unlockEyebrow}>Contact exchange request</Text>
                                        <Text style={styles.unlockTitle}>Accept contact exchange</Text>
                                    </View>
                                    <Text style={styles.unlockBadge}>Fair split</Text>
                                </View>

                                <Text style={styles.unlockBody}>
                                    {activeMatch.otherUserName} wants to exchange contact details. If you accept, both of you will pay the same one-time amount before direct chat opens.
                                </Text>

                                <View style={styles.unlockActionsRow}>
                                    <Pressable
                                        style={[styles.unlockButton, unlocking ? styles.sendButtonDisabled : null]}
                                        onPress={() => void handleUnlockAction('accept')}
                                        disabled={unlocking}
                                    >
                                        <Text style={styles.unlockButtonText}>
                                            {unlocking ? 'Working...' : 'Accept'}
                                        </Text>
                                    </Pressable>

                                    <Pressable
                                        style={[styles.unlockSecondaryButton, unlocking ? styles.sendButtonDisabled : null]}
                                        onPress={() => void handleUnlockAction('decline')}
                                        disabled={unlocking}
                                    >
                                        <Text style={styles.unlockSecondaryButtonText}>
                                            {unlocking ? 'Working...' : 'Decline'}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        ) : null}

                        {!activeMatch.isUnlocked && activeMatch.unlockState.canPay ? (
                            <View style={styles.unlockRequestInlineCard}>
                                <View style={styles.unlockHeaderRow}>
                                    <View style={styles.unlockCopy}>
                                        <Text style={styles.unlockEyebrow}>Payment pending</Text>
                                        <Text style={styles.unlockTitle}>Pay your share</Text>
                                    </View>
                                    <Text style={styles.unlockBadge}>No subscription</Text>
                                </View>

                                <Text style={styles.unlockBody}>
                                    {activeMatch.unlockState.hasOtherUserPaid
                                        ? `${activeMatch.otherUserName} already paid. Pay your share now to unlock direct chat for both of you.`
                                        : 'Both of you agreed. Each person pays the same one-time amount before contact details become visible.'}
                                </Text>

                                <View style={styles.unlockActionsRow}>
                                    <Pressable
                                        style={[styles.unlockButton, unlocking ? styles.sendButtonDisabled : null]}
                                        onPress={() => void handleUnlock()}
                                        disabled={unlocking}
                                    >
                                        <Text style={styles.unlockButtonText}>
                                            {unlocking ? 'Working...' : activeMatch.unlockState.hasOtherUserPaid ? 'Pay and unlock' : 'Pay your share'}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        ) : null}

                        {!activeMatch.isUnlocked && activeMatch.unlockState.waitingOn === 'other_acceptance' ? (
                            <View style={styles.deadlineCardMuted}>
                                <Text style={styles.deadlineTitleMuted}>Waiting for acceptance</Text>
                                <Text style={styles.deadlineBodyMuted}>
                                    Unlock request sent. {activeMatch.otherUserName} needs to accept before either of you can pay.
                                </Text>
                            </View>
                        ) : null}

                        {!activeMatch.isUnlocked && activeMatch.unlockState.waitingOn === 'other_payment' ? (
                            <View style={styles.deadlineCardMuted}>
                                <Text style={styles.deadlineTitleMuted}>Waiting for their payment</Text>
                                <Text style={styles.deadlineBodyMuted}>
                                    You paid your share. {activeMatch.otherUserName} still needs to pay before contact sharing opens.
                                </Text>
                            </View>
                        ) : null}

                        <View style={styles.messageListArea}>
                            {messagesLoading ? (
                                <View style={styles.centeredState}>
                                    <MessageSkeletonList />
                                    <Text style={styles.stateText}>Loading messages...</Text>
                                </View>
                            ) : (
                                <FlatList
                                    data={invertedMessages}
                                    inverted
                                    keyExtractor={(item) => item.id}
                                    contentContainerStyle={styles.messagesContent}
                                    initialNumToRender={12}
                                    maxToRenderPerBatch={12}
                                    windowSize={9}
                                    removeClippedSubviews
                                    keyboardShouldPersistTaps="handled"
                                    keyboardDismissMode="on-drag"
                                    renderItem={({ item }) => {
                                        const isOwnMessage = item.senderId === currentUserId;
                                        
                                        // Show redacted interactive CTA if system flagged and locked
                                        const isFlaggedAndLocked = item.isFlaggedBySystem && !activeMatch?.isUnlocked;
                                        
                                        const rawContent = isFlaggedAndLocked && !item.content.includes('[Contact Details Hidden]')
                                            ? '[Contact Details Hidden]'
                                            : item.content;

                                        const displayContent = isFlaggedAndLocked
                                            ? rawContent.replace(/\[Contact Details Hidden\]/g, '[Contact Details Hidden] ➔ Tap here to send a Mutual Unlock Request')
                                            : item.content;

                                        const WrapperComponent = isFlaggedAndLocked ? Pressable : View;
                                        
                                        const wrapperProps = isFlaggedAndLocked ? {
                                            onPress: () => {
                                                if (activeMatch?.unlockState?.canAccept) {
                                                    void handleUnlockAction('accept');
                                                } else if (activeMatch?.unlockState?.canPay) {
                                                    void handleUnlock();
                                                } else if (activeMatch?.unlockState?.waitingOn === 'other_acceptance') {
                                                    Alert.alert('Request Pending', `${activeMatch.otherUserName} needs to accept your unlock request before you can pay.`);
                                                } else if (activeMatch?.unlockState?.waitingOn === 'other_payment') {
                                                    Alert.alert('Payment Pending', `You have paid. We are waiting for ${activeMatch.otherUserName} to pay and unlock the chat.`);
                                                } else {
                                                    void handleUnlockAction('request');
                                                }
                                            },
                                            style: ({ pressed }) => [
                                                styles.messageBubble,
                                                isOwnMessage ? styles.messageBubbleOwn : styles.messageBubbleOther,
                                                styles.messageBubbleFlagged,
                                                pressed ? { opacity: 0.7 } : null
                                            ]
                                        } : {
                                            style: [
                                                styles.messageBubble,
                                                isOwnMessage ? styles.messageBubbleOwn : styles.messageBubbleOther,
                                                item.isFlaggedBySystem ? styles.messageBubbleFlagged : null,
                                            ]
                                        };

                                        return (
                                            <WrapperComponent {...wrapperProps}>
                                                <Text
                                                    style={[
                                                        styles.messageText,
                                                        isOwnMessage ? styles.messageTextOwn : styles.messageTextOther,
                                                        isFlaggedAndLocked ? styles.messageTextFlagged : null,
                                                    ]}
                                                >
                                                    {displayContent}
                                                </Text>
                                                <Text
                                                    style={[
                                                        styles.messageMeta,
                                                        isOwnMessage ? styles.messageMetaOwn : styles.messageMetaOther,
                                                    ]}
                                                >
                                                    {formatMessageTime(item.createdAt)}
                                                    {isOwnMessage && item.readAt ? ' • seen' : ''}
                                                    {item.isFlaggedBySystem ? ' • filtered' : ''}
                                                </Text>
                                            </WrapperComponent>
                                        );
                                    }}
                                    ListHeaderComponent={
                                        otherUserTyping ? (
                                            <View style={styles.typingBubbleRow}>
                                                <View style={[styles.messageBubble, styles.messageBubbleOther, styles.typingBubble]}>
                                                    <Text style={styles.typingDots}>●  ●  ●</Text>
                                                </View>
                                            </View>
                                        ) : null
                                    }
                                />
                            )}
                        </View>

                        {promptSuggestions.length > 0 || chemistry ? (
                            <View style={styles.promptsCard}>
                                <View style={styles.promptsHeaderRow}>
                                    <Text style={styles.promptsTitle}>
                                        {promptsLoading ? '✨ Thinking...' : '✨ AI chat copilot'}
                                    </Text>

                                    <View style={styles.promptsActionsRow}>
                                        <Pressable
                                            style={styles.promptsAction}
                                            onPress={() => void handleLoadPromptSuggestions()}
                                            disabled={promptsLoading}
                                        >
                                            <Text style={styles.promptsActionText}>
                                                {promptsLoading ? 'Thinking...' : 'Refresh'}
                                            </Text>
                                        </Pressable>

                                        <Pressable
                                            style={styles.promptsCloseButton}
                                            onPress={() => {
                                                setPromptSuggestions([]);
                                                setChemistry(null);
                                            }}
                                            accessibilityRole="button"
                                            accessibilityLabel="Close AI chat copilot"
                                        >
                                            <Text style={styles.promptsCloseText}>Close</Text>
                                        </Pressable>
                                    </View>
                                </View>

                                {chemistry ? <ChemistryMeter chemistry={chemistry} /> : null}

                                {promptSuggestions.length > 0 ? (
                                    <View style={styles.promptsList}>
                                        {promptSuggestions.map((prompt) => (
                                            <Pressable
                                                key={prompt}
                                                style={styles.promptCard}
                                                onPress={() => {
                                                    setDraft(prompt);
                                                    setPromptSuggestions([]);
                                                    setChemistry(null);
                                                }}
                                            >
                                                <Text style={styles.promptCardText}>{prompt}</Text>
                                            </Pressable>
                                        ))}
                                    </View>
                                ) : null}
                            </View>
                        ) : null}

                        <View style={styles.composerRow}>
                            <TextInput
                                style={styles.composerInput}
                                placeholder="Write a message"
                                placeholderTextColor="#7d8c90"
                                value={draft}
                                onChangeText={handleDraftChange}
                                multiline
                                maxLength={2000}
                            />

                            <Pressable
                                style={[styles.sendButton, sending ? styles.sendButtonDisabled : null]}
                                onPress={() => void handleSend()}
                                disabled={sending || !draft.trim()}
                            >
                                <Text style={styles.sendButtonText}>{sending ? 'Sending...' : 'Send'}</Text>
                            </Pressable>
                        </View>
                    </>
                )}
            </KeyboardAvoidingView>

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

const chatListFilters: { label: string; value: ChatListFilter }[] = [
    { label: 'Received', value: 'received' },
    { label: 'Accepted', value: 'accepted' },
    { label: 'Contacts', value: 'contacts' },
    { label: 'Sent', value: 'sent' },
];

type ChatListFilter = 'received' | 'accepted' | 'contacts' | 'sent';
type MessageVisibilityFilter = 'all' | 'unread' | 'needs_reply';

function MatchFilterChip({
    label,
    count,
    active,
    onPress,
}: {
    label: string;
    count: number;
    active: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable style={[styles.matchFilterChip, active ? styles.matchFilterChipActive : null]} onPress={onPress}>
            <Text style={[styles.matchFilterChipText, active ? styles.matchFilterChipTextActive : null]}>
                {count > 0 ? `${label} (${count})` : label}
            </Text>
        </Pressable>
    );
}

function InboxSkeletonList() {
    return (
        <View style={styles.inboxSkeletonList}>
            <View style={styles.inboxSkeletonCard} />
            <View style={styles.inboxSkeletonCard} />
            <View style={[styles.inboxSkeletonCard, styles.inboxSkeletonCardShort]} />
        </View>
    );
}

function MessageSkeletonList() {
    return (
        <View style={styles.messageSkeletonList}>
            <View style={styles.messageSkeletonBubbleOther} />
            <View style={styles.messageSkeletonBubbleOwn} />
            <View style={styles.messageSkeletonBubbleOther} />
        </View>
    );
}

interface ProfileListItemCardProps {
    item: ChatMatch;
    onPress: () => void;
    currentUserId: string | null;
    matchRequestPending: boolean;
    matchRequestAction: 'accept' | 'decline' | null;
    matchRequestActionMatchId: string | null;
    brokerConsentPendingRequestId: string | null;
    onAcceptRequest: (item: ChatMatch) => void;
    onDeclineRequest: (item: ChatMatch) => void;
    onBrokerConsent: (item: ChatMatch, consent: boolean) => void;
    onContactAction: (item: ChatMatch, action: 'call' | 'whatsapp') => void;
    onOpenChat: (item: ChatMatch) => void;
    onViewProfile?: (profileId: string) => void;
}

function ProfileListItemCard({
    item,
    onPress,
    currentUserId,
    matchRequestPending,
    matchRequestAction,
    matchRequestActionMatchId,
    brokerConsentPendingRequestId,
    onAcceptRequest,
    onDeclineRequest,
    onBrokerConsent,
    onContactAction,
    onOpenChat,
    onViewProfile,
}: ProfileListItemCardProps) {
    const premiumHighlight = getPremiumInboxHighlight(item);

    return (
        <View style={[styles.matchCard, premiumHighlight ? styles.matchCardPremium : null]}>
            <Pressable
                style={styles.matchCardPressableContent}
                onPress={onPress}
            >
                {premiumHighlight ? (
                    <View style={styles.matchPremiumTag}>
                        <Text style={styles.matchPremiumTagText}>Premium highlight</Text>
                        <Text style={styles.matchPremiumReasonText}>{premiumHighlight}</Text>
                    </View>
                ) : null}

                <View style={styles.matchCardTopRow}>
                    <Pressable onPress={() => onViewProfile?.(item.otherUserId)} style={{ borderRadius: 24, overflow: 'hidden' }}>
                        {item.otherUserPhotoUrls[0] ? (
                            <Image source={{ uri: item.otherUserPhotoUrls[0] }} style={styles.matchAvatar} />
                        ) : (
                            <View style={styles.matchAvatarPlaceholder}>
                                <Text style={styles.matchAvatarInitial}>
                                    {getDisplayFirstName(item.otherUserName).slice(0, 1).toUpperCase() || '?'}
                                </Text>
                            </View>
                        )}
                    </Pressable>

                    <View style={styles.matchCardContent}>
                        <View style={styles.matchCardHeader}>
                            <Pressable onPress={() => onViewProfile?.(item.otherUserId)}>
                                <Text style={styles.matchName}>{item.otherUserName}</Text>
                            </Pressable>
                            <View style={styles.matchCardHeaderBadges}>
                                {item.unreadCount > 0 ? (
                                    <Text style={styles.matchUnreadPill}>
                                        {item.unreadCount > 99 ? '99+' : item.unreadCount}
                                    </Text>
                                ) : null}
                                <Text style={styles.matchStatusPill}>{getMatchStatusLabel(item)}</Text>
                            </View>
                        </View>

                        <View style={styles.matchTagRow}>
                            <View style={styles.matchTagPill}>
                                <Text style={styles.matchTagText}>{item.otherUserLocation}</Text>
                            </View>

                            <View style={styles.matchTagPillMuted}>
                                <Text style={styles.matchTagTextMuted}>
                                    {item.otherUserProfileOwner ? `Managed by ${item.otherUserProfileOwner}` : 'Self profile'}
                                </Text>
                            </View>
                        </View>
                    </View>
                </View>

                <View style={styles.matchStateRow}>
                    {getInboxStateChips(item).map((chip) => (
                        <StateChip key={`${item.id}-${chip.label}`} label={chip.label} tone={chip.tone} />
                    ))}
                </View>

                <Text style={styles.matchPreviewStatus}>{getMatchInboxPreview(item)}</Text>

                {shouldShowInboxBrokerCard(item) ? (
                    <View style={styles.brokerInfoCard}>
                        <Text style={styles.brokerInfoText}>{getInboxBrokerPreview(item)}</Text>

                        {item.interestRequest &&
                        item.interestRequest.senderId !== currentUserId &&
                        (item.brokerSummary?.currentUserConsent ?? 'unknown') !== 'granted' ? (
                            <Pressable
                                style={[
                                    styles.brokerConsentInlineButton,
                                    brokerConsentPendingRequestId === item.interestRequest.id
                                        ? styles.sendButtonDisabled
                                        : null,
                                ]}
                                onPress={() => void onBrokerConsent(item, true)}
                                disabled={brokerConsentPendingRequestId === item.interestRequest.id}
                            >
                                <Text style={styles.brokerConsentInlineButtonText}>
                                    {brokerConsentPendingRequestId === item.interestRequest.id
                                        ? 'Saving...'
                                        : 'Allow intro call'}
                                </Text>
                            </Pressable>
                        ) : null}

                        <FollowupJobStatusBlock match={item} />
                    </View>
                ) : null}

                <Text numberOfLines={2} style={styles.matchPreview}>
                    {item.otherUserBio ?? item.otherUserPreferences ?? 'No profile summary yet.'}
                </Text>
            </Pressable>

            {item.matchRequestState === 'received' ? (
                <View style={styles.matchCardActionsRow}>
                    <Pressable
                        style={[
                            styles.matchCardPrimaryAction,
                            matchRequestPending && matchRequestActionMatchId === item.id
                                ? styles.sendButtonDisabled
                                : null,
                        ]}
                        onPress={() => void onAcceptRequest(item)}
                        disabled={matchRequestPending}
                    >
                        <Text style={styles.matchCardPrimaryActionText}>
                            {matchRequestPending && matchRequestAction === 'accept' && matchRequestActionMatchId === item.id
                                ? 'Accepting...'
                                : 'Accept'}
                        </Text>
                    </Pressable>

                    <Pressable
                        style={[
                            styles.matchCardSecondaryAction,
                            matchRequestPending && matchRequestActionMatchId === item.id
                                ? styles.sendButtonDisabled
                                : null,
                        ]}
                        onPress={() => void onDeclineRequest(item)}
                        disabled={matchRequestPending}
                    >
                        <Text style={styles.matchCardSecondaryActionText}>
                            {matchRequestPending && matchRequestAction === 'decline' && matchRequestActionMatchId === item.id
                                ? 'Declining...'
                                : 'Decline'}
                        </Text>
                    </Pressable>
                </View>
            ) : shouldShowAcceptedCardQuickActions(item) ? (
                <View style={styles.matchCardActionsRow}>
                    <Pressable
                        style={styles.matchCardPrimaryAction}
                        onPress={() => onOpenChat(item)}
                    >
                        <Text style={styles.matchCardPrimaryActionText}>Open chat</Text>
                    </Pressable>

                    {item.isUnlocked && item.otherUserWhatsappNumber ? (
                        <Pressable
                            style={styles.matchCardSecondaryAction}
                            onPress={() => void onContactAction(item, 'whatsapp')}
                        >
                            <WhatsAppLogo size={14} color="#25d366" />
                            <Text style={styles.matchCardSecondaryActionText}>WhatsApp</Text>
                        </Pressable>
                    ) : null}

                    {item.isUnlocked && item.otherUserPhoneNumber ? (
                        <Pressable
                            style={styles.matchCardSecondaryAction}
                            onPress={() => void onContactAction(item, 'call')}
                        >
                            <PhoneIcon size={14} color="#35525b" />
                            <Text style={styles.matchCardSecondaryActionText}>Call</Text>
                        </Pressable>
                    ) : null}

                    {!item.isUnlocked ? (
                        <Pressable
                            style={styles.matchCardSecondaryAction}
                            onPress={() => onOpenChat(item)}
                        >
                            <Text style={styles.matchCardSecondaryActionText}>Unlock contacts</Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

function ChatListItemCard({ item, onPress }: { item: ChatMatch; onPress: () => void }) {
    const lastMessage = getMatchInboxPreview(item);

    return (
        <Pressable
            style={({ pressed }) => [styles.chatCard, pressed && styles.chatCardPressed]}
            onPress={onPress}
        >
            <View style={styles.chatCardAvatarContainer}>
                {item.otherUserPhotoUrls[0] ? (
                    <Image source={{ uri: item.otherUserPhotoUrls[0] }} style={styles.chatAvatar} />
                ) : (
                    <View style={styles.chatAvatarPlaceholder}>
                        <Text style={styles.chatAvatarInitial}>
                            {getDisplayFirstName(item.otherUserName).slice(0, 1).toUpperCase() || '?'}
                        </Text>
                    </View>
                )}
            </View>

            <View style={styles.chatCardBody}>
                <View style={styles.chatCardHeader}>
                    <Text style={styles.chatCardName} numberOfLines={1}>
                        {item.otherUserName}
                    </Text>
                    <Text style={styles.chatCardTime}>
                        {formatChatListTime(item.createdAt)}
                    </Text>
                </View>

                <View style={styles.chatCardMessageRow}>
                    <Text style={styles.chatCardMessage} numberOfLines={1}>
                        {lastMessage}
                    </Text>
                    {item.unreadCount > 0 ? (
                        <View style={styles.chatUnreadBadge}>
                            <Text style={styles.chatUnreadText}>
                                {item.unreadCount > 99 ? '99+' : item.unreadCount}
                            </Text>
                        </View>
                    ) : null}
                </View>
            </View>
        </Pressable>
    );
}

function formatChatListTime(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function StateChip({ label, tone }: { label: string; tone: 'primary' | 'accent' | 'muted' }) {
    return (
        <View
            style={[
                styles.stateChip,
                tone === 'primary' ? styles.stateChipPrimary : tone === 'accent' ? styles.stateChipAccent : styles.stateChipMuted,
            ]}
        >
            <Text
                style={[
                    styles.stateChipText,
                    tone === 'primary'
                        ? styles.stateChipTextPrimary
                        : tone === 'accent'
                            ? styles.stateChipTextAccent
                            : styles.stateChipTextMuted,
                ]}
            >
                {label}
            </Text>
        </View>
    );
}

function ChemistryMeter({ chemistry }: { chemistry: ChatChemistry }) {
    const score = Math.max(0, Math.min(100, chemistry.score));
    const fillStyle =
        score >= 67 ? styles.chemistryFillHigh : score >= 34 ? styles.chemistryFillMid : styles.chemistryFillLow;

    return (
        <View style={styles.chemistryCard}>
            <View style={styles.chemistryHeaderRow}>
                <Text style={styles.chemistryTitle}>Chemistry</Text>
                <Text style={styles.chemistryScore}>
                    {score}
                    <Text style={styles.chemistryScoreUnit}> / 100</Text>
                </Text>
            </View>

            <View style={styles.chemistryTrack}>
                <View style={[styles.chemistryFill, fillStyle, { width: `${score}%` }]} />
            </View>

            <View style={styles.chemistryFooterRow}>
                <Text style={styles.chemistryLabel}>{chemistry.label}</Text>
                {chemistry.signals.map((signal) => (
                    <StateChip key={signal} label={signal} tone="muted" />
                ))}
            </View>
        </View>
    );
}

function BrokerToolsToggle({ open, onToggle, summary }: { open: boolean; onToggle: () => void; summary?: string | null }) {
    return (
        <Pressable style={styles.brokerToggleRow} onPress={onToggle} accessibilityRole="button">
            {summary ? (
                <Text style={styles.brokerToggleSummary} numberOfLines={1}>
                    {summary}
                </Text>
            ) : (
                <View style={styles.brokerToggleSpacer} />
            )}
            <Text style={styles.brokerToggleAction}>{open ? 'Hide follow-up tools' : 'Follow-up tools'}</Text>
            <Text style={styles.brokerToggleChevron}>{open ? '\u2303' : '\u2304'}</Text>
        </Pressable>
    );
}

function FollowupJobStatusBlock({ match }: { match: ChatMatch }) {
    const latestJob = match.followupJobSummary?.latestJob;
    if (!latestJob) {
        return null;
    }

    return (
        <View style={styles.followupJobBlock}>
            <Text style={styles.brokerInfoText}>{getFollowupJobPreview(match)}</Text>
        </View>
    );
}

function RecoverySuggestionCard({
    suggestion,
    pending,
    onPress,
}: {
    suggestion: RecoverySuggestion;
    pending: boolean;
    onPress?: () => void;
}) {
    return (
        <View style={styles.recoverySuggestionCard}>
            <Text style={styles.recoverySuggestionTitle}>{suggestion.title}</Text>
            <Text style={styles.recoverySuggestionBody}>{suggestion.body}</Text>

            {suggestion.action && suggestion.actionLabel && onPress ? (
                <Pressable
                    style={[styles.callbackActionButtonSecondary, pending ? styles.sendButtonDisabled : null]}
                    onPress={onPress}
                    disabled={pending}
                >
                    <Text style={styles.callbackActionButtonSecondaryText}>
                        {pending ? 'Working...' : suggestion.actionLabel}
                    </Text>
                </Pressable>
            ) : null}
        </View>
    );
}

function mergeMessages(existing: ChatMessage[], next: ChatMessage[]) {
    const byId = new Map<string, ChatMessage>();

    for (const message of [...existing, ...next]) {
        byId.set(message.id, message);
    }

    return [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function capitalizeProfileOwner(value: string) {
    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatBrokerConsentLabel(status: BrokerCallSummary['currentUserConsent']) {
    if (status === 'granted') {
        return 'granted';
    }

    if (status === 'declined') {
        return 'declined';
    }

    return 'pending';
}

function formatBrokerStatusLabel(status: NonNullable<BrokerCallSummary['latestStatus']>) {
    switch (status) {
        case 'consent_granted':
            return 'consent granted';
        case 'consent_required':
            return 'consent needed';
        case 'in_progress':
            return 'in progress';
        case 'no_answer':
            return 'no answer';
        default:
            return status.replace(/_/g, ' ');
    }
}

function formatBrokerOutcomeLabel(outcome: string) {
    return outcome.replace(/[_-]+/g, ' ').trim();
}

function getBrokerSummaryDetail(summary: BrokerCallSummary | null) {
    const latestSummary = summary?.latestSummary;
    if (!latestSummary) {
        return null;
    }

    const intent = typeof latestSummary.intent === 'string' ? latestSummary.intent.trim() : '';
    const preferredContactMode =
        typeof latestSummary.preferredContactMode === 'string' ? latestSummary.preferredContactMode.trim() : '';

    const details = [];
    if (intent) {
        details.push(`Intent: ${formatBrokerOutcomeLabel(intent)}`);
    }

    if (preferredContactMode) {
        details.push(`Next step: ${formatBrokerOutcomeLabel(preferredContactMode)}`);
    }

    return details.length > 0 ? details.join(' • ') : null;
}

function formatFollowupJobChannelLabel(channel: string) {
    switch (channel) {
        case 'followup_nudge':
            return 'Reminder';
        case 'availability_check':
            return 'Callback check';
        case 'schedule_prompt':
            return 'Schedule prompt';
        case 'broker_notify_counterparty':
            return 'Counterparty update';
        case 'broker_mutual_unlock_prompt':
            return 'Unlock prompt';
        case 'broker_schedule_call':
            return 'Schedule call';
        default:
            return channel.replace(/_/g, ' ');
    }
}

function formatFollowupJobStatusLabel(status: string) {
    switch (status) {
        case 'queued':
            return 'queued';
        case 'completed':
            return 'completed';
        case 'failed':
            return 'failed';
        case 'processing':
        case 'in_progress':
            return 'in progress';
        default:
            return status.replace(/_/g, ' ');
    }
}

function getFollowupJobTone(status: string): 'primary' | 'accent' | 'muted' {
    if (status === 'completed') {
        return 'primary';
    }

    if (status === 'failed' || status === 'cancelled') {
        return 'accent';
    }

    return 'muted';
}

function formatMessageTime(timestamp: string) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
    });
}

function formatCountdownLabel(timestamp: string, currentTime: number) {
    const dueAt = new Date(timestamp).getTime();
    if (Number.isNaN(dueAt)) {
        return '24 hours';
    }

    const remainingMs = dueAt - currentTime;
    if (remainingMs <= 0) {
        return 'the deadline window';
    }

    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / (60 * 1000)));
    if (remainingMinutes < 60) {
        return `${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
    }

    const remainingHours = Math.max(1, Math.ceil(remainingMinutes / 60));
    if (remainingHours < 24) {
        return `${remainingHours} hour${remainingHours === 1 ? '' : 's'}`;
    }

    return new Date(timestamp).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function getMatchStatusLabel(match: ChatMatch) {
    if (match.interestRequest?.status === 'ghosted') {
        return 'Ghosted';
    }

    if (match.interestRequest?.status === 'declined') {
        return 'Declined';
    }

    if (match.interestRequest?.status === 'accepted' && !match.isUnlocked) {
        return 'Accepted';
    }

    if (match.matchRequestState === 'received') {
        return 'New request';
    }

    if (match.matchRequestState === 'sent' || match.status === 'pending') {
        return 'Pending';
    }

    if (match.isUnlocked) {
        return 'Unlocked';
    }

    if (match.unlockState.canAccept) {
        return 'Reply';
    }

    if (match.unlockState.canPay) {
        return 'Pay';
    }

    if (match.unlockState.waitingOn === 'other_acceptance' || match.unlockState.waitingOn === 'other_payment') {
        return 'Waiting';
    }

    if (match.unlockState.status === 'declined') {
        return 'Declined';
    }

    return 'Escrow';
}

function matchesChatListFilter(match: ChatMatch, filter: ChatListFilter) {
    if (filter === 'received') {
        return match.matchRequestState === 'received' || match.unlockState.canAccept;
    }

    if (filter === 'accepted') {
        return (
            match.interestRequest?.status === 'accepted' ||
            match.interestRequest?.status === 'ghosted' ||
            match.status === 'connected'
        );
    }

    if (filter === 'contacts') {
        return match.isUnlocked;
    }

    if (filter === 'sent') {
        return (
            match.matchRequestState === 'sent' ||
            match.interestRequest?.status === 'declined' ||
            match.unlockState.waitingOn === 'other_acceptance' ||
            match.unlockState.waitingOn === 'other_payment'
        );
    }

    return false;
}

function requiresReplySoon(match: ChatMatch, currentUserId: string | null) {
    if (match.unlockState.canAccept || match.unlockState.canPay) {
        return true;
    }

    if (!currentUserId) {
        return false;
    }

    return Boolean(
        match.interestRequest?.status === 'accepted' &&
        match.interestRequest?.senderId === currentUserId &&
        !match.interestRequest?.firstReplyAt,
    );
}

function getMatchInboxPreview(match: ChatMatch) {
    if (match.matchRequestState === 'received') {
        return match.interestRequest?.personalizedReason
            ? `${match.otherUserName} sent a request: "${match.interestRequest.personalizedReason}"`
            : `${match.otherUserName} sent a request. Accept it to start the match and continue chatting here.`;
    }

    if (match.matchRequestState === 'sent') {
        return match.interestRequest?.personalizedReason
            ? `Your request says: "${match.interestRequest.personalizedReason}"`
            : 'Your request has been delivered to Inbox and Chat. Waiting for the other person to accept.';
    }

    if (match.interestRequest?.status === 'accepted' && match.interestRequest.firstReplyDueAt && !match.interestRequest.firstReplyAt) {
        return match.interestRequest.senderId === match.otherUserId
            ? 'You accepted this request. Waiting for the sender to follow up within 24 hours.'
            : 'This request was accepted. Your first real reply is still due within 24 hours.';
    }

    if (match.interestRequest?.status === 'ghosted') {
        return 'This request expired because the sender did not reply after acceptance.';
    }

    if (match.interestRequest?.status === 'declined') {
        return 'This request was declined.';
    }

    if (match.isUnlocked) {
        return 'Direct chat is enabled. Contact sharing is open.';
    }

    if (match.unlockState.canAccept) {
        return 'This match is waiting for your reply to the contact exchange request.';
    }

    if (match.unlockState.canPay) {
        return 'Both sides agreed. Your payment is the next step.';
    }

    if (match.unlockState.waitingOn === 'other_acceptance') {
        return 'You asked to exchange contacts. Waiting for the other person to accept.';
    }

    if (match.unlockState.waitingOn === 'other_payment') {
        return 'Your payment is done. Waiting for the other person to finish theirs.';
    }

    if (match.unlockState.status === 'declined') {
        return 'The previous unlock request was declined. You can restart it later.';
    }

    return 'You can chat in escrow mode and request mutual contact exchange when ready.';
}

function shouldShowInboxBrokerCard(match: ChatMatch) {
    if (!match.interestRequest || (match.interestRequest.status !== 'accepted' && match.interestRequest.status !== 'ghosted')) {
        return false;
    }

    const hasBrokerState = Boolean(
        match.brokerSummary &&
        (match.brokerSummary.latestStatus ||
            match.brokerSummary.currentUserConsent !== 'unknown' ||
            match.brokerSummary.otherUserConsent !== 'unknown'),
    );

    return hasBrokerState || Boolean(match.followupJobSummary?.latestJob);
}

function getInboxBrokerPreview(match: ChatMatch) {
    const summary = match.brokerSummary;
    if (!summary) {
        return match.followupJobSummary?.latestJob
            ? 'Recovery follow-up is already queued for this request.'
            : 'Broker outreach is not configured for this request yet.';
    }

    const brokerDetail = getBrokerSummaryDetail(summary);

    if (summary.latestStatus === 'completed' && summary.latestOutcome) {
        return brokerDetail
            ? `Broker completed. Outcome: ${formatBrokerOutcomeLabel(summary.latestOutcome)}. ${brokerDetail}.`
            : `Broker completed. Outcome: ${formatBrokerOutcomeLabel(summary.latestOutcome)}.`;
    }

    if (summary.latestStatus === 'completed' && brokerDetail) {
        return `Broker completed. ${brokerDetail}.`;
    }

    if (summary.latestStatus === 'queued') {
        return 'Broker outreach is queued for this request.';
    }

    if (summary.latestStatus === 'dialing') {
        return 'Broker outreach is actively trying to reach the participant.';
    }

    if (summary.latestStatus === 'in_progress') {
        return 'Broker outreach is in progress right now.';
    }

    if (summary.latestStatus === 'no_answer' || summary.latestStatus === 'failed' || summary.latestStatus === 'cancelled') {
        return `Latest broker attempt ${formatBrokerStatusLabel(summary.latestStatus).toLowerCase()}.`;
    }

    if (summary.otherUserConsent === 'granted') {
        return 'Broker consent is ready if a countdown nudge is needed.';
    }

    if (summary.otherUserConsent === 'declined') {
        return 'The other participant declined broker outreach for now.';
    }

    if (summary.currentUserConsent === 'granted') {
        return 'You granted broker outreach. Waiting on the other participant.';
    }

    return 'Broker outreach has not been enabled yet.';
}

function getFollowupJobPreview(match: ChatMatch) {
    const latestJob = match.followupJobSummary?.latestJob;
    if (!latestJob) {
        return 'No recovery follow-up is queued yet.';
    }

    switch (latestJob.channel) {
        case 'followup_nudge':
            return latestJob.status === 'completed'
                ? 'A polite reminder has already been sent before expiry.'
                : 'A polite reminder is queued before this request closes.';
        case 'availability_check':
            return latestJob.status === 'completed'
                ? 'The AI callback check finished for this request.'
                : 'An AI callback check is queued for this request.';
        case 'schedule_prompt':
            return latestJob.status === 'completed'
                ? 'The AI recovery callback finished with a scheduling prompt.'
                : 'An AI recovery callback is queued to schedule the next step.';
        case 'broker_notify_counterparty':
            return latestJob.status === 'completed'
                ? 'The other participant has already been notified to continue here.'
                : 'A counterparty update is queued so this match can keep moving.';
        case 'broker_mutual_unlock_prompt':
            return latestJob.status === 'completed'
                ? 'A mutual unlock prompt has already been sent after broker confirmation.'
                : 'A mutual unlock prompt is queued after broker confirmation.';
        case 'broker_schedule_call':
            return latestJob.status === 'completed'
                ? 'A schedule-call follow-up has already been sent.'
                : 'A schedule-call follow-up is queued after broker confirmation.';
        default:
            return `${formatFollowupJobChannelLabel(latestJob.channel)} is ${formatFollowupJobStatusLabel(latestJob.status)}.`;
    }
}

function getRecoverySuggestion(match: ChatMatch): RecoverySuggestion | null {
    const latestJob = match.followupJobSummary?.latestJob;
    if (!latestJob) {
        return null;
    }

    switch (latestJob.channel) {
        case 'broker_mutual_unlock_prompt':
            if (match.isUnlocked) {
                return {
                    title: 'Contacts are already open',
                    body: 'Broker confirmed interest in exchanging contact details. You can continue here or move to direct call or WhatsApp now.',
                    action: null,
                    actionLabel: null,
                };
            }

            if (match.unlockState.canAccept) {
                return {
                    title: 'Mutual unlock is waiting on you',
                    body: 'Broker confirmed interest in exchanging contact details. Accept the equal-pay unlock request to move this forward.',
                    action: 'accept_unlock',
                    actionLabel: 'Accept unlock request',
                };
            }

            if (match.unlockState.canPay) {
                return {
                    title: 'Your payment is the next step',
                    body: 'Both sides agreed to exchange contact details. Pay your share to finish the unlock.',
                    action: 'pay_unlock',
                    actionLabel: 'Pay your share',
                };
            }

            if (match.unlockState.waitingOn === 'other_payment') {
                return {
                    title: 'Waiting for their payment',
                    body: `${match.otherUserName} still needs to pay their share before contact details can open for both of you.`,
                    action: null,
                    actionLabel: null,
                };
            }

            if (match.unlockState.waitingOn === 'other_acceptance') {
                return {
                    title: 'Unlock request delivered',
                    body: `The equal-pay unlock request is out. Waiting for ${match.otherUserName} to accept.`,
                    action: null,
                    actionLabel: null,
                };
            }

            return {
                title: 'Mutual unlock is recommended',
                body: 'Broker captured interest in exchanging contact details. Start the equal-pay unlock flow when you are ready.',
                action: 'request_unlock',
                actionLabel: 'Start mutual unlock',
            };

        case 'broker_schedule_call':
            if (match.isUnlocked && match.otherUserPhoneNumber) {
                return {
                    title: 'A real call is the next step',
                    body: 'Broker captured interest in taking this forward over a real call. Contacts are already open now.',
                    action: 'call',
                    actionLabel: 'Call now',
                };
            }

            if (match.isUnlocked && match.otherUserWhatsappNumber) {
                return {
                    title: 'Move this to WhatsApp',
                    body: 'Broker captured interest in taking this forward outside the app. Contacts are already open now.',
                    action: 'whatsapp',
                    actionLabel: 'Open WhatsApp',
                };
            }

            return {
                title: 'A real call is the likely next step',
                body: 'Broker captured interest in scheduling a call. Keep the conversation active here or unlock contacts when both sides are ready.',
                action: match.isUnlocked ? null : 'request_unlock',
                actionLabel: match.isUnlocked ? null : 'Start mutual unlock',
            };

        case 'broker_notify_counterparty':
            return {
                title: 'Counterparty update queued',
                body: 'Broker captured positive intent and queued a polite nudge so the match can keep moving here.',
                action: null,
                actionLabel: null,
            };

        case 'availability_check':
            return {
                title: latestJob.status === 'completed' ? 'Availability check finished' : 'Availability check in motion',
                body: latestJob.status === 'completed'
                    ? 'The callback check finished. Review the latest recovery status above before choosing the next step.'
                    : 'An AI callback check is queued to confirm whether this match should keep moving.',
                action: null,
                actionLabel: null,
            };

        case 'schedule_prompt':
            return {
                title: latestJob.status === 'completed' ? 'Scheduling recovery finished' : 'Scheduling recovery queued',
                body: latestJob.status === 'completed'
                    ? 'The recovery callback finished with a scheduling prompt. Use the latest recovery status above to decide the next step.'
                    : 'An AI recovery callback is queued to help schedule the next step.',
                action: null,
                actionLabel: null,
            };

        case 'followup_nudge':
            return {
                title: latestJob.status === 'completed' ? 'Reminder delivered' : 'Reminder queued',
                body: latestJob.status === 'completed'
                    ? 'A polite reminder already went out before the request expired.'
                    : 'A polite reminder is queued before this request closes.',
                action: null,
                actionLabel: null,
            };

        default:
            return {
                title: 'Recovery update available',
                body: getFollowupJobPreview(match),
                action: null,
                actionLabel: null,
            };
    }
}

function getInboxStateChips(match: ChatMatch) {
    if (match.interestRequest?.status === 'ghosted') {
        return [
            { label: 'Accepted earlier', tone: 'muted' as const },
            { label: 'Expired', tone: 'accent' as const },
        ];
    }

    if (match.interestRequest?.status === 'declined') {
        return [
            { label: 'Request closed', tone: 'muted' as const },
            { label: 'Declined', tone: 'accent' as const },
        ];
    }

    if (match.interestRequest?.status === 'accepted' && !match.isUnlocked) {
        return [
            { label: 'Request accepted', tone: 'primary' as const },
            { label: 'Reply window', tone: 'accent' as const },
        ];
    }

    if (match.matchRequestState === 'received') {
        return [
            { label: 'Request received', tone: 'primary' as const },
            { label: 'Chat ready', tone: 'accent' as const },
        ];
    }

    if (match.matchRequestState === 'sent') {
        return [
            { label: 'Sent request', tone: 'muted' as const },
            { label: 'Waiting for accept', tone: 'accent' as const },
        ];
    }

    if (match.isUnlocked) {
        return [
            { label: 'Contacts open', tone: 'primary' as const },
            { label: 'Direct chat', tone: 'accent' as const },
        ];
    }

    if (match.unlockState.canAccept) {
        return [
            { label: 'Reply needed', tone: 'primary' as const },
            { label: 'Equal pay', tone: 'accent' as const },
        ];
    }

    if (match.unlockState.canPay) {
        return [
            { label: 'Pay your share', tone: 'primary' as const },
            { label: 'Unlock pending', tone: 'accent' as const },
        ];
    }

    if (match.unlockState.waitingOn === 'other_acceptance') {
        return [
            { label: 'Sent request', tone: 'muted' as const },
            { label: 'Awaiting reply', tone: 'accent' as const },
        ];
    }

    if (match.unlockState.waitingOn === 'other_payment') {
        return [
            { label: 'Paid', tone: 'primary' as const },
            { label: 'Awaiting payment', tone: 'accent' as const },
        ];
    }

    return [
        { label: 'Escrow chat', tone: 'muted' as const },
        { label: 'Match ready', tone: 'accent' as const },
    ];
}

function shouldShowAcceptedCardQuickActions(match: ChatMatch) {
    if (match.matchRequestState === 'received') {
        return false;
    }

    if (match.isUnlocked) {
        return true;
    }

    return match.interestRequest?.status === 'accepted' || match.status === 'connected';
}

function getPremiumInboxHighlight(match: ChatMatch) {
    if (match.unreadCount > 0 && match.interestRequest?.status === 'accepted' && !match.isUnlocked) {
        return 'Accepted and waiting for thoughtful follow-up';
    }

    if (match.isUnlocked && (match.otherUserPhoneNumber || match.otherUserWhatsappNumber)) {
        return 'Unlocked contact-ready profile';
    }

    if (match.otherUserPhotoUrls.length >= 2 && Boolean(match.otherUserBio) && Boolean(match.otherUserPreferences)) {
        return 'Complete profile with strong match context';
    }

    return null;
}

function getEmptyInboxTitle(filter: ChatListFilter) {
    if (filter === 'received') {
        return 'No received requests';
    }

    if (filter === 'accepted') {
        return 'No accepted matches yet';
    }

    if (filter === 'contacts') {
        return 'No unlocked contacts yet';
    }

    return 'No sent requests';
}

function getEmptyInboxBody(filter: ChatListFilter) {
    if (filter === 'received') {
        return 'When someone sends you a match or contact request, it will appear here for review.';
    }

    if (filter === 'accepted') {
        return 'Accepted matches and active chat threads will appear here once both sides have shown interest.';
    }

    if (filter === 'contacts') {
        return 'Unlocked conversations move here after both people accept and both payments are complete.';
    }

    return 'Requests you send to the other person will appear here while you wait for acceptance or payment.';
}

function getUnlockCardCopy(match: ChatMatch, contactShareBlocked = false) {
    if (match.isUnlocked) {
        return {
            eyebrow: 'Mutual unlock',
            title: 'Direct chat enabled',
            body: 'Both payments are complete. Contact sharing is open now.',
            badge: 'Done',
            primaryAction: null as MatchUnlockAction | 'pay' | null,
            primaryLabel: null as string | null,
            secondaryAction: null as MatchUnlockAction | null,
            secondaryLabel: null as string | null,
        };
    }

    if (match.unlockState.canAccept) {
        return {
            eyebrow: contactShareBlocked ? 'Contact details blocked' : 'Mutual unlock',
            title: 'Accept contact exchange',
            body: contactShareBlocked
                ? `We blocked that message because contact sharing is still locked. ${match.otherUserName} wants to exchange contact details. If you accept, both of you will pay the same one-time amount before direct chat opens.`
                : `${match.otherUserName} wants to exchange contact details. If you accept, both of you will pay the same one-time amount before direct chat opens.`,
            badge: 'Equal pay',
            primaryAction: 'accept' as const,
            primaryLabel: 'Accept & continue',
            secondaryAction: 'decline' as const,
            secondaryLabel: 'Not now',
        };
    }

    if (match.unlockState.canPay) {
        return {
            eyebrow: contactShareBlocked ? 'Contact details blocked' : 'Equal payment',
            title: 'Pay your share',
            body: contactShareBlocked
                ? match.unlockState.hasOtherUserPaid
                    ? `We blocked that message because contact sharing is still locked. ${match.otherUserName} already paid. Pay your share now to unlock direct chat for both of you.`
                    : 'We blocked that message because contact sharing is still locked. Both of you agreed. Each person pays the same one-time amount before contact details become visible.'
                : match.unlockState.hasOtherUserPaid
                    ? `${match.otherUserName} already paid. Pay your share now to unlock direct chat for both of you.`
                    : 'Both of you agreed. Each person pays the same one-time amount before contact details become visible.',
            badge: 'No subscription',
            primaryAction: 'pay' as const,
            primaryLabel: match.unlockState.hasOtherUserPaid ? 'Pay and unlock' : 'Pay your share',
            secondaryAction: null,
            secondaryLabel: null,
        };
    }

    if (match.unlockState.waitingOn === 'other_acceptance') {
        return {
            eyebrow: contactShareBlocked ? 'Contact details blocked' : 'Request sent',
            title: 'Waiting for acceptance',
            body: contactShareBlocked
                ? `We blocked that message because direct contact sharing is still locked. ${match.otherUserName} needs to accept before either of you can pay.`
                : `${match.otherUserName} needs to accept before either of you can pay.`,
            badge: 'Pending',
            primaryAction: null,
            primaryLabel: null,
            secondaryAction: null,
            secondaryLabel: null,
        };
    }

    if (match.unlockState.waitingOn === 'other_payment') {
        return {
            eyebrow: contactShareBlocked ? 'Contact details blocked' : 'Payment pending',
            title: 'Waiting for their payment',
            body: contactShareBlocked
                ? `We blocked that message because contact sharing is still locked. You paid your share. ${match.otherUserName} still needs to pay before contact sharing opens.`
                : `You paid your share. ${match.otherUserName} still needs to pay before contact sharing opens.`,
            badge: 'Pending',
            primaryAction: null,
            primaryLabel: null,
            secondaryAction: null,
            secondaryLabel: null,
        };
    }

    if (match.unlockState.status === 'declined') {
        return {
            eyebrow: contactShareBlocked ? 'Contact details blocked' : 'Mutual unlock',
            title: 'Ask again later',
            body: contactShareBlocked
                ? match.unlockState.declinedByUserId === match.otherUserId
                    ? `We blocked that message because contact sharing is still locked. ${match.otherUserName} declined the previous request. You can ask again whenever both of you are ready.`
                    : 'We blocked that message because contact sharing is still locked. You declined the previous request. You can start a new one whenever you want.'
                : match.unlockState.declinedByUserId === match.otherUserId
                    ? `${match.otherUserName} declined the previous request. You can ask again whenever both of you are ready.`
                    : 'You declined the previous request. You can start a new one whenever you want.',
            badge: 'Reset',
            primaryAction: 'request' as const,
            primaryLabel: 'Request again',
            secondaryAction: null,
            secondaryLabel: null,
        };
    }

    return {
        eyebrow: contactShareBlocked ? 'Contact details blocked' : 'Mutual unlock',
        title: 'Request contact exchange',
        body: contactShareBlocked
            ? 'We blocked that message because it looked like contact sharing. Both people must agree and pay the same small amount before phone numbers, email, WhatsApp, Instagram, or other direct contact sharing is allowed.'
            : 'Both people must agree and pay the same small amount before phone numbers, email, and direct contact sharing are allowed.',
        badge: 'Fair split',
        primaryAction: 'request' as const,
        primaryLabel: 'Request unlock',
        secondaryAction: null,
        secondaryLabel: null,
    };
}

const styles = StyleSheet.create({
    safeArea: {
        backgroundColor: '#eef4f2',
        flex: 1,
        minHeight: 0,
    },
    container: {
        alignSelf: 'center',
        flex: 1,
        maxWidth: MAX_CONTENT_WIDTH,
        minHeight: 0,
        paddingBottom: 16,
        paddingHorizontal: 20,
        paddingTop: 16,
        width: '100%',
    },
    headerRow: {
        backgroundColor: '#f7f9fa',
        borderBottomColor: '#e5e7eb',
        borderBottomWidth: 1,
        gap: 6,
        marginBottom: 0,
        marginHorizontal: -20,
        paddingBottom: 14,
        paddingHorizontal: 20,
        paddingTop: 4,
    },
    headerTitleRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
        zIndex: 10,
    },
    headerCopy: {
        flex: 1,
        gap: 4,
        marginHorizontal: 12,
    },
    headerUnlockActions: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
    },
    headerCallButton: {
        alignItems: 'center',
        backgroundColor: '#17323d',
        borderRadius: 14,
        elevation: 3,
        flexDirection: 'row',
        gap: 7,
        paddingHorizontal: 18,
        paddingVertical: 10,
        shadowColor: '#0a1a1f',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
    },
    headerCallIcon: {
        fontSize: 13,
    },
    headerCallText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
    headerWhatsappButton: {
        alignItems: 'center',
        backgroundColor: '#22c55e',
        borderRadius: 14,
        elevation: 3,
        flexDirection: 'row',
        gap: 7,
        paddingHorizontal: 18,
        paddingVertical: 10,
        shadowColor: '#0d6832',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
    },
    headerWhatsappIcon: {
        fontSize: 13,
    },
    headerWhatsappText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
    headerButtonPressed: {
        opacity: 0.85,
        transform: [{ scale: 0.97 }],
    },
    copilotHeaderButton: {
        alignItems: 'center',
        backgroundColor: '#eef4f3',
        borderColor: '#cfe0dd',
        borderRadius: 999,
        borderWidth: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    copilotHeaderButtonText: {
        color: '#0f766e',
        fontSize: 13,
        fontWeight: '700',
    },
    headerButtonCompact: {
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    headerUnlockBadge: {
        fontSize: 16,
    },
    headerUnlockNote: {
        color: '#5d6d71',
        fontSize: 12,
        fontWeight: '600',
    },
    headerUnlockNoteBadge: {
        alignItems: 'center',
        backgroundColor: '#f0f5f3',
        borderColor: '#d4e0db',
        borderRadius: 10,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 5,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    headerUnlockNoteIcon: {
        fontSize: 12,
    },
    headerUnlockNoteText: {
        color: '#3d6b5e',
        fontSize: 12,
        fontWeight: '600',
        letterSpacing: 0.1,
    },
    title: {
        color: '#102a43',
        fontSize: 20,
        fontWeight: '700',
        letterSpacing: -0.3,
    },
    subtitle: {
        color: '#6b7d82',
        fontSize: 13,
        letterSpacing: 0.1,
        lineHeight: 18,
    },
    listArea: {
        flex: 1,
        minHeight: 0,
    },
    centeredState: {
        alignItems: 'center',
        flex: 1,
        gap: 12,
        justifyContent: 'center',
    },
    inboxSkeletonList: {
        width: '100%',
        gap: 10,
    },
    inboxSkeletonCard: {
        height: 108,
        borderRadius: 18,
        backgroundColor: '#e3ecee',
        width: '100%',
    },
    inboxSkeletonCardShort: {
        width: '84%',
    },
    messageSkeletonList: {
        width: '100%',
        gap: 10,
        paddingHorizontal: 6,
    },
    messageSkeletonBubbleOther: {
        alignSelf: 'flex-start',
        backgroundColor: '#e2ebed',
        borderRadius: 14,
        height: 44,
        width: '74%',
    },
    messageSkeletonBubbleOwn: {
        alignSelf: 'flex-end',
        backgroundColor: '#d7e3e5',
        borderRadius: 14,
        height: 44,
        width: '62%',
    },
    stateText: {
        color: '#5d6d71',
        fontSize: 15,
    },
    emptyCard: {
        backgroundColor: '#ffffff',
        borderRadius: 24,
        gap: 12,
        marginTop: 36,
        padding: 24,
    },
    emptyTitle: {
        color: '#14313a',
        fontSize: 24,
        fontWeight: '800',
    },
    emptyBody: {
        color: '#5d6d71',
        fontSize: 15,
        lineHeight: 22,
    },
    refreshButton: {
        alignSelf: 'flex-start',
        backgroundColor: '#d9643d',
        borderRadius: 999,
        paddingHorizontal: 18,
        paddingVertical: 12,
    },
    refreshButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '700',
    },
    inboxToolbarCard: {
        backgroundColor: '#ffffff',
        borderColor: '#d7e1e2',
        borderRadius: 22,
        borderWidth: 1,
        gap: 12,
        marginBottom: 14,
        padding: 14,
    },
    inboxPremiumPromoCard: {
        backgroundColor: '#14313a',
        borderRadius: 16,
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    inboxPremiumPromoCopy: {
        flex: 1,
        gap: 3,
    },
    inboxPremiumPromoEyebrow: {
        color: '#f1c57b',
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.7,
        textTransform: 'uppercase',
    },
    inboxPremiumPromoTitle: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
    inboxPremiumPromoBody: {
        color: '#d4e2e5',
        fontSize: 12,
        lineHeight: 17,
    },
    inboxPremiumPromoButton: {
        alignSelf: 'center',
        backgroundColor: '#2d4950',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    inboxPremiumPromoButtonText: {
        color: '#e2edef',
        fontSize: 11,
        fontWeight: '800',
    },
    inboxSearchInput: {
        backgroundColor: '#f4f8f7',
        borderRadius: 16,
        color: '#14313a',
        fontSize: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    matchFilterList: {
        gap: 10,
        paddingRight: 4,
    },
    messageVisibilityRow: {
        flexDirection: 'row',
        gap: 10,
        paddingRight: 4,
    },
    messageVisibilityScroller: {
        width: '100%',
    },
    matchFilterChip: {
        backgroundColor: '#eef4f2',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    matchFilterChipActive: {
        backgroundColor: '#14313a',
    },
    matchFilterChipText: {
        color: '#47616a',
        fontSize: 13,
        fontWeight: '800',
    },
    matchFilterChipTextActive: {
        color: '#ffffff',
    },
    matchListContent: {
        gap: 14,
        paddingBottom: 24,
    },
    matchCard: {
        backgroundColor: '#fffaf5',
        borderColor: '#ecd9c7',
        borderRadius: 24,
        borderWidth: 1,
        gap: 10,
        padding: 20,
    },
    matchCardPremium: {
        borderColor: '#e6c290',
        borderWidth: 1.4,
        shadowColor: '#8c5b2f',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.14,
        shadowRadius: 16,
    },
    matchCardPressableContent: {
        gap: 10,
    },
    matchPremiumTag: {
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: '#f7ead8',
        borderColor: '#e6c290',
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    matchPremiumTagText: {
        color: '#7e4f24',
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    matchPremiumReasonText: {
        color: '#8f5f35',
        fontSize: 11,
        fontWeight: '700',
    },
    matchCardTopRow: {
        alignItems: 'flex-start',
        flexDirection: 'row',
        gap: 12,
    },
    matchAvatar: {
        borderRadius: 22,
        height: 60,
        width: 60,
    },
    matchAvatarPlaceholder: {
        alignItems: 'center',
        backgroundColor: '#ead9c9',
        borderRadius: 22,
        height: 60,
        justifyContent: 'center',
        width: 60,
    },
    matchAvatarInitial: {
        color: '#7a4a2c',
        fontSize: 24,
        fontWeight: '800',
    },
    matchCardContent: {
        flex: 1,
        gap: 10,
    },
    matchCardHeader: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    matchCardHeaderBadges: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
    },
    matchName: {
        color: '#14313a',
        fontSize: 20,
        fontWeight: '800',
    },
    matchStatusPill: {
        backgroundColor: '#14313a',
        borderRadius: 999,
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '700',
        overflow: 'hidden',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    matchUnreadPill: {
        backgroundColor: '#d9643d',
        borderRadius: 999,
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '800',
        overflow: 'hidden',
        paddingHorizontal: 9,
        paddingVertical: 6,
    },
    matchMeta: {
        color: '#7a685c',
        fontSize: 13,
        fontWeight: '700',
    },
    matchTagRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    matchTagPill: {
        backgroundColor: '#14313a',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    matchTagText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '700',
    },
    matchTagPillMuted: {
        backgroundColor: '#f0e2d2',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    matchTagTextMuted: {
        color: '#744a33',
        fontSize: 12,
        fontWeight: '700',
    },
    matchStateRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    stateChip: {
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 5,
    },
    stateChipPrimary: {
        backgroundColor: '#14313a',
    },
    stateChipAccent: {
        backgroundColor: '#f0e2d2',
    },
    stateChipMuted: {
        backgroundColor: '#edf3f2',
    },
    stateChipText: {
        fontSize: 11,
        fontWeight: '700',
    },
    stateChipTextPrimary: {
        color: '#ffffff',
    },
    stateChipTextAccent: {
        color: '#744a33',
    },
    stateChipTextMuted: {
        color: '#47616a',
    },
    matchPreviewStatus: {
        color: '#7a4a2c',
        fontSize: 13,
        fontWeight: '700',
        lineHeight: 20,
    },
    matchPreview: {
        color: '#31494e',
        fontSize: 15,
        lineHeight: 22,
    },
    matchCardActionsRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 4,
    },
    matchCardPrimaryAction: {
        alignItems: 'center',
        backgroundColor: '#14313a',
        borderRadius: 16,
        flex: 1,
        justifyContent: 'center',
        minHeight: 46,
        paddingHorizontal: 14,
    },
    matchCardPrimaryActionText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
    matchCardSecondaryAction: {
        alignItems: 'center',
        backgroundColor: '#edf3f2',
        borderRadius: 16,
        flex: 1,
        flexDirection: 'row',
        gap: 6,
        justifyContent: 'center',
        minHeight: 46,
        paddingHorizontal: 14,
    },
    matchCardSecondaryActionText: {
        color: '#35525b',
        fontSize: 14,
        fontWeight: '800',
    },
    unlockCard: {
        backgroundColor: '#14313a',
        borderRadius: 20,
        gap: 12,
        padding: 18,
    },
    unlockRequestInlineCard: {
        backgroundColor: '#14313a',
        borderRadius: 20,
        gap: 12,
        marginBottom: 12,
        padding: 18,
    },
    unlockModalBackdrop: {
        alignItems: 'center',
        backgroundColor: 'rgba(10, 26, 31, 0.52)',
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 20,
    },
    unlockModalScrim: {
        bottom: 0,
        left: 0,
        position: 'absolute',
        right: 0,
        top: 0,
    },
    unlockModalSheet: {
        gap: 12,
        maxWidth: 420,
        width: '100%',
    },
    unlockModalTopRow: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 4,
    },
    unlockModalLabel: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '800',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    unlockModalCloseButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.18)',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    unlockModalCloseButtonText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '800',
    },
    unlockHeaderRow: {
        alignItems: 'flex-start',
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'space-between',
    },
    unlockCopy: {
        flex: 1,
        gap: 4,
    },
    unlockEyebrow: {
        color: '#f1c57b',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    unlockTitle: {
        color: '#ffffff',
        fontSize: 20,
        fontWeight: '800',
    },
    unlockBadge: {
        backgroundColor: '#f3dcc3',
        borderRadius: 999,
        color: '#6f4027',
        fontSize: 11,
        fontWeight: '800',
        overflow: 'hidden',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    unlockBody: {
        color: '#d6e3e6',
        fontSize: 14,
        lineHeight: 21,
    },
    unlockButton: {
        alignSelf: 'flex-start',
        backgroundColor: '#d9643d',
        borderRadius: 999,
        paddingHorizontal: 18,
        paddingVertical: 12,
    },
    unlockActionsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    unlockButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
    unlockSecondaryButton: {
        alignSelf: 'flex-start',
        backgroundColor: '#2f4a52',
        borderRadius: 999,
        paddingHorizontal: 18,
        paddingVertical: 12,
    },
    unlockSecondaryButtonText: {
        color: '#d8e5e7',
        fontSize: 14,
        fontWeight: '800',
    },
    noticeCard: {
        backgroundColor: '#f0e2d2',
        borderRadius: 18,
        marginBottom: 12,
        padding: 16,
    },
    noticeText: {
        color: '#7a4a2c',
        fontSize: 14,
        fontWeight: '700',
        lineHeight: 20,
    },
    requestCard: {
        backgroundColor: '#fffaf5',
        borderColor: '#decfbc',
        borderRadius: 18,
        borderWidth: 1,
        gap: 12,
        marginBottom: 12,
        padding: 16,
    },
    requestHeaderRow: {
        alignItems: 'flex-start',
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'space-between',
    },
    requestCopy: {
        flex: 1,
        gap: 4,
    },
    requestEyebrow: {
        color: '#7f5d2d',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    requestTitle: {
        color: '#17353c',
        fontSize: 18,
        fontWeight: '800',
    },
    requestBadge: {
        backgroundColor: '#f3e7d8',
        borderRadius: 999,
        color: '#7b5c31',
        fontSize: 11,
        fontWeight: '700',
        overflow: 'hidden',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    requestBody: {
        color: '#53676d',
        fontSize: 13,
        lineHeight: 20,
    },
    requestReasonCard: {
        backgroundColor: '#f7ede0',
        borderRadius: 14,
        gap: 6,
        padding: 12,
    },
    requestReasonLabel: {
        color: '#7f5d2d',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    requestReasonText: {
        color: '#425a60',
        fontSize: 14,
        lineHeight: 21,
    },
    requestMetaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    requestTrustRow: {
        alignItems: 'center',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    inlineTrustButton: {
        backgroundColor: '#edf3f2',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    inlineTrustButtonText: {
        color: '#35525b',
        fontSize: 12,
        fontWeight: '800',
    },
    requestActionsRow: {
        flexDirection: 'row',
        gap: 10,
    },
    requestPrimaryButton: {
        alignItems: 'center',
        backgroundColor: '#17353c',
        borderRadius: 14,
        justifyContent: 'center',
        minHeight: 46,
        paddingHorizontal: 16,
    },
    requestPrimaryButtonText: {
        color: '#f6f7f2',
        fontSize: 14,
        fontWeight: '800',
    },
    requestSecondaryButton: {
        alignItems: 'center',
        backgroundColor: '#edf3f2',
        borderRadius: 14,
        justifyContent: 'center',
        minHeight: 46,
        paddingHorizontal: 16,
    },
    requestSecondaryButtonText: {
        color: '#35525b',
        fontSize: 14,
        fontWeight: '800',
    },
    deadlineCard: {
        backgroundColor: '#fff4e7',
        borderRadius: 16,
        gap: 6,
        marginBottom: 10,
        padding: 13,
    },
    deadlineTitle: {
        color: '#8a4b22',
        fontSize: 14,
        fontWeight: '800',
    },
    deadlineBody: {
        color: '#7a4a2c',
        fontSize: 13,
        lineHeight: 19,
    },
    deadlineCardMuted: {
        backgroundColor: '#edf3f2',
        borderRadius: 16,
        gap: 6,
        marginBottom: 10,
        padding: 13,
    },
    deadlineTitleMuted: {
        color: '#35525b',
        fontSize: 14,
        fontWeight: '800',
    },
    deadlineBodyMuted: {
        color: '#47616a',
        fontSize: 13,
        lineHeight: 19,
    },
    brokerToggleRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
        marginTop: 2,
    },
    brokerToggleSpacer: {
        flex: 1,
    },
    brokerToggleSummary: {
        color: '#5f7378',
        flex: 1,
        fontSize: 12,
        fontWeight: '700',
    },
    brokerToggleAction: {
        color: '#2f4c54',
        fontSize: 12,
        fontWeight: '800',
    },
    brokerToggleChevron: {
        color: '#2f4c54',
        fontSize: 13,
        fontWeight: '800',
    },
    brokerInfoCard: {
        backgroundColor: '#ffffff',
        borderColor: '#d4dfdf',
        borderRadius: 12,
        borderWidth: 1,
        gap: 6,
        marginTop: 10,
        padding: 10,
    },
    brokerInfoText: {
        color: '#3d5860',
        fontSize: 12,
        lineHeight: 17,
    },
    brokerInfoMeta: {
        color: '#5f7378',
        fontSize: 12,
        fontWeight: '600',
    },
    brokerConsentInlineButton: {
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: '#0f766e',
        borderRadius: 999,
        marginTop: 4,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    brokerConsentInlineButtonText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '700',
    },
    followupJobBlock: {
        gap: 6,
        marginTop: 6,
    },
    recoverySuggestionCard: {
        backgroundColor: '#f4f7f7',
        borderColor: '#d7e1e2',
        borderRadius: 12,
        borderWidth: 1,
        gap: 8,
        marginTop: 10,
        padding: 12,
    },
    recoverySuggestionTitle: {
        color: '#17353c',
        fontSize: 14,
        fontWeight: '800',
    },
    recoverySuggestionBody: {
        color: '#47616a',
        fontSize: 13,
        lineHeight: 19,
    },
    callbackActionButton: {
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: '#17353c',
        borderRadius: 10,
        justifyContent: 'center',
        minHeight: 34,
        paddingHorizontal: 12,
    },
    callbackActionButtonText: {
        color: '#f6f7f2',
        fontSize: 12,
        fontWeight: '800',
    },
    brokerActionsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 8,
    },
    callbackActionButtonSecondary: {
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: '#eef3f3',
        borderColor: '#c4d2d6',
        borderRadius: 10,
        borderWidth: 1,
        justifyContent: 'center',
        minHeight: 34,
        paddingHorizontal: 12,
    },
    callbackActionButtonSecondaryText: {
        color: '#2f4c54',
        fontSize: 12,
        fontWeight: '800',
    },
    contactActionsCard: {
        backgroundColor: '#ffffff',
        borderColor: '#d7e1e2',
        borderRadius: 18,
        borderWidth: 1,
        gap: 12,
        marginBottom: 12,
        padding: 16,
    },
    contactActionsSlimBar: {
        alignItems: 'center',
        backgroundColor: '#f4f7f7',
        borderColor: '#d7e1e2',
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    contactActionsSlimText: {
        color: '#5d6d71',
        fontSize: 13,
        fontWeight: '600',
        flexShrink: 1,
    },
    contactActionsSlimActions: {
        flexDirection: 'row',
        gap: 8,
        marginLeft: 10,
    },
    contactSlimButton: {
        backgroundColor: '#edf3f2',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    contactSlimButtonText: {
        color: '#35525b',
        fontSize: 12,
        fontWeight: '800',
    },
    contactActionsHeader: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    contactActionsTitle: {
        color: '#14313a',
        fontSize: 15,
        fontWeight: '800',
    },
    contactActionsBadge: {
        backgroundColor: '#14313a',
        borderRadius: 999,
        color: '#ffffff',
        fontSize: 11,
        fontWeight: '800',
        overflow: 'hidden',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    contactActionsBody: {
        color: '#5d6d71',
        fontSize: 14,
        lineHeight: 21,
    },
    contactActionsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    contactPrimaryButton: {
        alignItems: 'center',
        backgroundColor: '#d9643d',
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 11,
    },
    contactPrimaryButtonText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '800',
    },
    contactSecondaryButton: {
        alignItems: 'center',
        backgroundColor: '#edf3f2',
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 11,
    },
    contactSecondaryButtonText: {
        color: '#35525b',
        fontSize: 13,
        fontWeight: '800',
    },
    promptsCard: {
        backgroundColor: '#ffffff',
        borderColor: '#d7e1e2',
        borderRadius: 16,
        borderWidth: 1,
        gap: 8,
        marginBottom: 4,
        marginTop: 4,
        padding: 14,
    },
    promptsHeaderRow: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    promptsTitle: {
        color: '#14313a',
        fontSize: 14,
        fontWeight: '800',
    },
    promptsAction: {
        backgroundColor: '#eef4f2',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    promptsActionText: {
        color: '#27444d',
        fontSize: 12,
        fontWeight: '800',
    },
    promptsActionsRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 6,
    },
    promptsCloseButton: {
        backgroundColor: '#f0e2d2',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    promptsCloseText: {
        color: '#8a4b22',
        fontSize: 12,
        fontWeight: '800',
    },
    promptsBody: {
        color: '#5d6d71',
        fontSize: 13,
        lineHeight: 19,
    },
    promptsList: {
        gap: 6,
    },
    promptCard: {
        backgroundColor: '#f4e3d3',
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 9,
        width: '100%',
    },
    promptCardText: {
        color: '#744a33',
        fontSize: 13,
        fontWeight: '700',
        lineHeight: 18,
        flexShrink: 1,
    },
    chemistryCard: {
        backgroundColor: '#f7fafa',
        borderColor: '#e0e9ea',
        borderRadius: 14,
        borderWidth: 1,
        gap: 7,
        padding: 11,
    },
    chemistryHeaderRow: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    chemistryTitle: {
        color: '#14313a',
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.2,
        textTransform: 'uppercase',
    },
    chemistryScore: {
        color: '#14313a',
        fontSize: 16,
        fontWeight: '800',
    },
    chemistryScoreUnit: {
        color: '#7d8c90',
        fontSize: 12,
        fontWeight: '700',
    },
    chemistryTrack: {
        backgroundColor: '#e3ecee',
        borderRadius: 999,
        height: 6,
        overflow: 'hidden',
        width: '100%',
    },
    chemistryFill: {
        borderRadius: 999,
        height: '100%',
    },
    chemistryFillLow: {
        backgroundColor: '#c98a5e',
    },
    chemistryFillMid: {
        backgroundColor: '#d9643d',
    },
    chemistryFillHigh: {
        backgroundColor: '#2f7d5b',
    },
    chemistryLabel: {
        color: '#5d6d71',
        fontSize: 12,
        fontWeight: '700',
        marginRight: 2,
    },
    chemistryFooterRow: {
        alignItems: 'center',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    messageListArea: {
        flex: 1,
        minHeight: 0,
    },
    messagesContent: {
        gap: 10,
        paddingBottom: 20,
    },
    messageBubble: {
        borderRadius: 20,
        maxWidth: '86%',
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    messageBubbleOwn: {
        alignSelf: 'flex-end',
        backgroundColor: '#14313a',
    },
    messageBubbleOther: {
        alignSelf: 'flex-start',
        backgroundColor: '#ffffff',
    },
    messageBubbleFlagged: {
        borderColor: '#d9643d',
        borderWidth: 1,
    },
    messageText: {
        fontSize: 15,
        lineHeight: 22,
    },
    messageTextOwn: {
        color: '#ffffff',
    },
    messageTextOther: {
        color: '#26434b',
    },
    messageTextFlagged: {
        color: '#d9643d',
        fontWeight: '600',
    },
    messageMeta: {
        fontSize: 11,
        marginTop: 6,
    },
    messageMetaOwn: {
        color: '#cad7d8',
    },
    messageMetaOther: {
        color: '#7d8c90',
    },
    composerRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
        marginTop: 12,
    },
    composerInput: {
        backgroundColor: '#ffffff',
        borderColor: '#d7e1e2',
        borderRadius: 24,
        borderWidth: 1,
        color: '#14313a',
        flex: 1,
        fontSize: 15,
        maxHeight: 120,
        minHeight: 48,
        paddingHorizontal: 16,
        paddingVertical: 12,
        textAlignVertical: 'top',
    },
    sendButton: {
        backgroundColor: '#d9643d',
        borderRadius: 24,
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    sendButtonDisabled: {
        opacity: 0.6,
    },
    sendButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
    headerSubtitle: {
        fontSize: 12,
        color: '#7d8c90',
        marginTop: 2,
    },
    headerSubtitleTyping: {
        color: '#1a7a5e',
        fontWeight: '700',
    },
    typingBubbleRow: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        paddingHorizontal: 16,
        paddingVertical: 4,
    },
    typingBubble: {
        paddingVertical: 10,
        paddingHorizontal: 16,
        minWidth: 60,
        alignItems: 'center',
    },
    typingDots: {
        fontSize: 14,
        color: '#7d8c90',
        letterSpacing: 2,
    },
    moreHeaderButton: {
        marginLeft: 8,
        padding: 8,
        borderRadius: 20,
        backgroundColor: '#f1f3f4',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 36,
        height: 36,
    },
    moreHeaderButtonText: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#4a5568',
        lineHeight: 20,
    },
    dropdownBackdrop: {
        position: 'absolute',
        top: -3000,
        left: -3000,
        right: -3000,
        bottom: -3000,
        backgroundColor: 'transparent',
        zIndex: 1,
    },
    headerDropdownMenu: {
        position: 'absolute',
        top: 40,
        right: 0,
        backgroundColor: '#ffffff',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        paddingVertical: 4,
        width: 140,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 6,
        elevation: 5,
        zIndex: 1500,
    },
    headerDropdownItem: {
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    headerDropdownItemText: {
        fontSize: 14,
        color: '#0f172a',
    },
    headerDropdownItemTextDestructive: {
        fontSize: 14,
        color: '#ef4444',
        fontWeight: '500',
    },
    headerDropdownDivider: {
        height: 1,
        backgroundColor: '#f1f5f9',
    },
    contactActionSubBar: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        backgroundColor: '#edf3f2',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#d6e1df',
        gap: 12,
        zIndex: 1,
    },
    subBarCallButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#17323d',
        borderRadius: 12,
        paddingVertical: 8,
        paddingHorizontal: 16,
        shadowColor: '#0a1a1f',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    subBarCallText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '700',
    },
    subBarWhatsappButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#25d366',
        borderRadius: 12,
        paddingVertical: 8,
        paddingHorizontal: 16,
        shadowColor: '#0a1a1f',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    subBarWhatsappText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '700',
    },
    subBarButtonPressed: {
        opacity: 0.85,
    },
    subBarUnlockNoteBadge: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f1f5f9',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
        gap: 6,
    },
    subBarUnlockNoteIcon: {
        fontSize: 14,
    },
    subBarUnlockNoteText: {
        color: '#64748b',
        fontSize: 12,
        fontWeight: '600',
    },
    chatCard: {
        flexDirection: 'row',
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f7',
        alignItems: 'center',
    },
    chatCardPressed: {
        backgroundColor: '#f8fafc',
    },
    chatCardAvatarContainer: {
        marginRight: 14,
    },
    chatAvatar: {
        width: 50,
        height: 50,
        borderRadius: 25,
    },
    chatAvatarPlaceholder: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#e2e8f0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    chatAvatarInitial: {
        color: '#475569',
        fontSize: 18,
        fontWeight: 'bold',
    },
    chatCardBody: {
        flex: 1,
        justifyContent: 'center',
    },
    chatCardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 4,
    },
    chatCardName: {
        fontSize: 16,
        fontWeight: '700',
        color: '#0f172a',
        flex: 1,
        marginRight: 8,
    },
    chatCardTime: {
        fontSize: 12,
        color: '#64748b',
    },
    chatCardMessageRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    chatCardMessage: {
        fontSize: 14,
        color: '#64748b',
        flex: 1,
        marginRight: 8,
    },
    chatUnreadBadge: {
        backgroundColor: '#10b981',
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 6,
    },
    chatUnreadText: {
        color: '#ffffff',
        fontSize: 11,
        fontWeight: 'bold',
    },
    headerProfileContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 8,
    },
    headerAvatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        marginRight: 8,
    },
    headerAvatarPlaceholder: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#e2e8f0',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
    },
    headerAvatarInitial: {
        color: '#475569',
        fontSize: 14,
        fontWeight: 'bold',
    },
});