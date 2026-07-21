import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { RealtimeChannel } from '@supabase/supabase-js';
import { ChatMatch, ChatMessage, MatchUnlockAction } from '../lib/chat';
import {
    consumeUnlockCredit,
    fetchChatMatches,
    fetchChatMessages,
    markMatchMessagesRead,
    sendEscrowMessage,
    subscribeToMatchMessages,
    subscribeToMatches,
    subscribeToInterestRequests,
    unsubscribeFromChannel,
    updateMatchUnlock,
} from '../lib/chatApi';
import { ProfileRecord } from '../lib/profile';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
    viewerProfile: ProfileRecord | null;
    onBack: () => void;
    onViewProfile?: (profileId: string) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function PremiumChatScreen({ viewerProfile, onBack, onViewProfile }: Props) {
    const [matches, setMatches] = useState<ChatMatch[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeMatch, setActiveMatch] = useState<ChatMatch | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [msgLoading, setMsgLoading] = useState(false);
    const [inputText, setInputText] = useState('');
    const [sending, setSending] = useState(false);
    const [unlocking, setUnlocking] = useState(false);
    const [search, setSearch] = useState('');

    const scrollRef = useRef<ScrollView>(null);
    const msgChannelRef = useRef<RealtimeChannel | null>(null);

    // ── Load match list ──────────────────────────────────────────────────────
    const loadMatches = useCallback(async () => {
        try {
            const all = await fetchChatMatches();
            const connected = all.filter(
                (m) => m.status === 'connected' || m.interestRequest?.status === 'accepted',
            );
            setMatches(connected);
        } catch (e) {
            console.error('PremiumChatScreen loadMatches error:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadMatches();
    }, [loadMatches]);

    // ── Realtime: refresh list when new match/request arrives ────────────────
    useEffect(() => {
        let mounted = true;
        const c1 = subscribeToMatches(() => { if (mounted) void loadMatches(); });
        const c2 = subscribeToInterestRequests(() => { if (mounted) void loadMatches(); });
        return () => {
            mounted = false;
            void unsubscribeFromChannel(c1 as RealtimeChannel);
            void unsubscribeFromChannel(c2 as RealtimeChannel);
        };
    }, [loadMatches]);

    // ── Open conversation ────────────────────────────────────────────────────
    const openConversation = useCallback(async (match: ChatMatch) => {
        setActiveMatch(match);
        setMsgLoading(true);
        setMessages([]);

        // Unsubscribe previous message channel
        if (msgChannelRef.current) {
            await unsubscribeFromChannel(msgChannelRef.current);
            msgChannelRef.current = null;
        }

        try {
            const msgs = await fetchChatMessages(match.id);
            setMessages(msgs);
            await markMatchMessagesRead(match.id);
        } catch (e) {
            console.error('PremiumChatScreen openConversation error:', e);
        } finally {
            setMsgLoading(false);
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
        }

        // Subscribe to live messages
        const ch = subscribeToMatchMessages(match.id, (newMsg) => {
            setMessages((prev) => {
                if (prev.some((m) => m.id === newMsg.id)) return prev;
                return [...prev, newMsg];
            });
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
            void markMatchMessagesRead(match.id);
        });
        msgChannelRef.current = ch as RealtimeChannel;
    }, []);

    // ── Send message ─────────────────────────────────────────────────────────
    const handleSend = useCallback(async () => {
        const text = inputText.trim();
        if (!text || !activeMatch || sending) return;
        setInputText('');
        setSending(true);
        try {
            // Don't add to state here — the realtime subscription fires from the DB
            // INSERT and adds it automatically. Adding it here too causes duplicates.
            await sendEscrowMessage(activeMatch.id, text);
        } catch (e) {
            console.error('PremiumChatScreen handleSend error:', e);
            // Restore the input if send failed
            setInputText(text);
        } finally {
            setSending(false);
        }
    }, [inputText, activeMatch, sending]);

    // ── Unlock / Share Contact Handlers ─────────────────────────────────────
    const refreshActiveMatch = useCallback(async (matchId: string) => {
        const all = await fetchChatMatches();
        const updated = all.find((m) => m.id === matchId);
        if (updated) {
            setActiveMatch(updated);
        }
    }, []);

    const handleUnlockAction = useCallback(async (action: MatchUnlockAction) => {
        if (!activeMatch || unlocking) return;
        setUnlocking(true);
        try {
            const res = await updateMatchUnlock(activeMatch.id, action);
            await refreshActiveMatch(activeMatch.id);
            Alert.alert(
                'Contact Share',
                res.message ??
                (action === 'request'
                    ? 'Contact exchange request sent.'
                    : action === 'accept'
                    ? 'Contact exchange accepted!'
                    : 'Contact exchange declined.'),
            );
        } catch (e: any) {
            Alert.alert('Error', e.message || 'Could not update contact share request.');
        } finally {
            setUnlocking(false);
        }
    }, [activeMatch, unlocking, refreshActiveMatch]);

    const handleUnlock = useCallback(async () => {
        if (!activeMatch || unlocking) return;
        setUnlocking(true);
        try {
            const credits = viewerProfile?.unlock_credits_remaining ?? 0;
            if (credits > 0) {
                const res = await consumeUnlockCredit(activeMatch.id);
                if (res.success) {
                    await refreshActiveMatch(activeMatch.id);
                    Alert.alert('Contact Unlocked! 🎉', 'Direct contact details unlocked! Phone numbers and emails are now unmasked.');
                }
            } else {
                await handleUnlockAction('request');
            }
        } catch (e: any) {
            Alert.alert('Unlock Failed', e.message || 'Could not unlock contact details.');
        } finally {
            setUnlocking(false);
        }
    }, [activeMatch, unlocking, viewerProfile, refreshActiveMatch, handleUnlockAction]);


    // ── Cleanup on unmount ───────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            if (msgChannelRef.current) {
                void unsubscribeFromChannel(msgChannelRef.current);
            }
        };
    }, []);

    // ── Filtered matches for search ──────────────────────────────────────────
    const filteredMatches = search.trim()
        ? matches.filter((m) =>
            m.otherUserName.toLowerCase().includes(search.toLowerCase()) ||
            m.otherUserLocation?.toLowerCase().includes(search.toLowerCase()),
          )
        : matches;

    // ─────────────────────────────────────────────────────────────────────────
    // Render: conversation view
    // ─────────────────────────────────────────────────────────────────────────
    if (activeMatch) {
        const viewerId = viewerProfile?.id;
        return (
            <SafeAreaView style={styles.container}>
                {/* Conversation Header */}
                <View style={styles.convHeader}>
                    <Pressable style={styles.backBtn} onPress={() => setActiveMatch(null)}>
                        <Text style={styles.backArrow}>‹</Text>
                    </Pressable>
                    <Pressable
                        style={styles.convHeaderProfile}
                        onPress={() => onViewProfile?.(activeMatch.otherUserId)}
                    >
                        {activeMatch.otherUserPhotoUrls?.[0] ? (
                            <Image
                                source={{ uri: activeMatch.otherUserPhotoUrls[0] }}
                                style={styles.convAvatar}
                            />
                        ) : (
                            <View style={styles.convAvatarPlaceholder}>
                                <Text style={styles.convAvatarInitial}>
                                    {activeMatch.otherUserName?.charAt(0) ?? '?'}
                                </Text>
                            </View>
                        )}
                        <View>
                            <Text style={styles.convName}>{activeMatch.otherUserName}</Text>
                            <Text style={styles.convSub}>
                                {activeMatch.status === 'connected' ? '✦ Connected via RM' : activeMatch.otherUserLocation}
                            </Text>
                        </View>
                    </Pressable>
                    <View style={styles.convHeaderRight}>
                        {!activeMatch.isUnlocked && (
                            <Pressable
                                style={[styles.shareContactBtn, unlocking && styles.btnDisabled]}
                                disabled={unlocking}
                                onPress={() => {
                                    if (activeMatch.unlockState?.canAccept) {
                                        void handleUnlockAction('accept');
                                    } else if (activeMatch.unlockState?.canPay) {
                                        void handleUnlock();
                                    } else if (activeMatch.unlockState?.waitingOn === 'other_acceptance') {
                                        Alert.alert('Request Sent ⏳', `Waiting for ${activeMatch.otherUserName} to accept your contact exchange request.`);
                                    } else if (activeMatch.unlockState?.waitingOn === 'other_payment') {
                                        Alert.alert('Waiting on Payment ⏳', `You've paid. Waiting for ${activeMatch.otherUserName} to complete payment.`);
                                    } else {
                                        void handleUnlockAction('request');
                                    }
                                }}
                            >
                                <Text style={styles.shareContactBtnText}>
                                    {unlocking
                                        ? '⏳ Working...'
                                        : activeMatch.unlockState?.canAccept
                                        ? '🔑 Accept Share'
                                        : activeMatch.unlockState?.canPay
                                        ? ((viewerProfile?.unlock_credits_remaining ?? 0) > 0 ? '🔑 Use Credit' : '🔑 Unlock Contact')
                                        : activeMatch.unlockState?.waitingOn === 'other_acceptance'
                                        ? '⏳ Pending'
                                        : activeMatch.unlockState?.waitingOn === 'other_payment'
                                        ? '⏳ They Pay'
                                        : '🔑 Share Contact'}
                                </Text>
                            </Pressable>
                        )}
                        <View style={styles.goldBadge}>
                            <Text style={styles.goldBadgeText}>👑</Text>
                        </View>
                    </View>
                </View>

                {/* Unlocked Contact Info Bar */}
                {activeMatch.isUnlocked ? (
                    <View style={styles.unlockedContactBar}>
                        <Text style={styles.unlockedContactTitle}>🔓 Contact Details Unlocked</Text>
                        <View style={styles.unlockedContactRow}>
                            {activeMatch.otherUserPhoneNumber ? (
                                <Text style={styles.unlockedContactText}>📱 Phone: {activeMatch.otherUserPhoneNumber}</Text>
                            ) : null}
                            {activeMatch.otherUserWhatsappNumber ? (
                                <Text style={styles.unlockedContactText}>💬 WA: {activeMatch.otherUserWhatsappNumber}</Text>
                            ) : null}
                        </View>
                    </View>
                ) : null}

                {/* RM Pitch Banner */}
                {activeMatch.interestRequest?.personalizedReason ? (
                    <View style={styles.rmBanner}>
                        <Text style={styles.rmBannerLabel}>💝 RM Introduction</Text>
                        <Text style={styles.rmBannerText} numberOfLines={2}>
                            {activeMatch.interestRequest.personalizedReason}
                        </Text>
                    </View>
                ) : null}

                {/* Messages */}
                <KeyboardAvoidingView
                    style={{ flex: 1 }}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    keyboardVerticalOffset={90}
                >
                    {msgLoading ? (
                        <View style={styles.msgLoading}>
                            <ActivityIndicator color="#d4b373" size="small" />
                        </View>
                    ) : (
                        <ScrollView
                            ref={scrollRef}
                            style={styles.messagesScroll}
                            contentContainerStyle={styles.messagesContent}
                        >
                            {messages.length === 0 ? (
                                <View style={styles.emptyConvWrap}>
                                    <Text style={styles.emptyConvEmoji}>💬</Text>
                                    <Text style={styles.emptyConvText}>
                                        Your RM has connected you. Send your first message!
                                    </Text>
                                </View>
                            ) : (
                                messages.map((msg) => {
                                    const isMe = msg.senderId === viewerId;
                                    const isRedacted = msg.content.includes('[Contact Details Hidden]') && !activeMatch.isUnlocked;

                                    return (
                                        <View
                                            key={msg.id}
                                            style={[
                                                styles.msgRow,
                                                isMe ? styles.msgRowMe : styles.msgRowThem,
                                            ]}
                                        >
                                            {!isMe && (
                                                <View style={styles.msgAvatar}>
                                                    {activeMatch.otherUserPhotoUrls?.[0] ? (
                                                        <Image
                                                            source={{ uri: activeMatch.otherUserPhotoUrls[0] }}
                                                            style={styles.msgAvatarImg}
                                                        />
                                                    ) : (
                                                        <Text style={styles.msgAvatarInitial}>
                                                            {activeMatch.otherUserName?.charAt(0) ?? '?'}
                                                        </Text>
                                                    )}
                                                </View>
                                            )}

                                            {isRedacted ? (
                                                <Pressable
                                                    style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, styles.redactedBubble]}
                                                    onPress={() => {
                                                        if (activeMatch.unlockState?.canAccept) {
                                                            void handleUnlockAction('accept');
                                                        } else if (activeMatch.unlockState?.canPay) {
                                                            void handleUnlock();
                                                        } else {
                                                            void handleUnlockAction('request');
                                                        }
                                                    }}
                                                >
                                                    <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe, styles.redactedText]}>
                                                        🔒 [Contact Details Hidden] ➔ Tap to send Mutual Unlock Request
                                                    </Text>
                                                    <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
                                                        {formatTime(msg.createdAt)}
                                                    </Text>
                                                </Pressable>
                                            ) : (
                                                <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                                                    <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>
                                                        {msg.content}
                                                    </Text>
                                                    <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
                                                        {formatTime(msg.createdAt)}
                                                    </Text>
                                                </View>
                                            )}
                                        </View>
                                    );
                                })
                            )}
                        </ScrollView>
                    )}

                    {/* Input bar */}
                    <View style={styles.inputBar}>
                        <TextInput
                            style={styles.input}
                            placeholder="Type a message..."
                            placeholderTextColor="#5a5570"
                            value={inputText}
                            onChangeText={setInputText}
                            multiline
                            returnKeyType="send"
                            onSubmitEditing={handleSend}
                        />
                        <Pressable
                            style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
                            onPress={handleSend}
                            disabled={!inputText.trim() || sending}
                        >
                            {sending ? (
                                <ActivityIndicator size="small" color="#0d0c0f" />
                            ) : (
                                <Text style={styles.sendBtnText}>↑</Text>
                            )}
                        </Pressable>
                    </View>
                </KeyboardAvoidingView>
            </SafeAreaView>
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Render: match list
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={onBack}>
                    <Text style={styles.backArrow}>‹</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>Your Connections</Text>
                    <Text style={styles.headerSub}>Matched by your Relationship Manager</Text>
                </View>
                <View style={styles.crownBadge}>
                    <Text style={styles.crownText}>👑</Text>
                </View>
            </View>

            {/* Search */}
            <View style={styles.searchWrap}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                    style={styles.searchInput}
                    placeholder="Search by name or city..."
                    placeholderTextColor="#5a5570"
                    value={search}
                    onChangeText={setSearch}
                />
                {search.length > 0 && (
                    <Pressable onPress={() => setSearch('')}>
                        <Text style={styles.searchClear}>✕</Text>
                    </Pressable>
                )}
            </View>

            {/* Divider */}
            <View style={styles.divider} />

            {/* Match list */}
            {loading ? (
                <View style={styles.loadingWrap}>
                    <ActivityIndicator color="#d4b373" size="large" />
                    <Text style={styles.loadingText}>Loading your connections...</Text>
                </View>
            ) : filteredMatches.length === 0 ? (
                <View style={styles.emptyWrap}>
                    <Text style={styles.emptyEmoji}>{search ? '🔍' : '💝'}</Text>
                    <Text style={styles.emptyTitle}>
                        {search ? 'No results found' : 'No connections yet'}
                    </Text>
                    <Text style={styles.emptyDesc}>
                        {search
                            ? 'Try a different name or city.'
                            : 'Once your RM makes a successful pitch, your matched connections will appear here.'}
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={filteredMatches}
                    keyExtractor={(m) => m.id}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    renderItem={({ item: match }) => {
                        const hasUnread = match.unreadCount > 0;
                        const lastMsg = match.interestRequest?.personalizedReason ?? 'Start a conversation';
                        return (
                            <Pressable
                                style={styles.matchCard}
                                onPress={() => openConversation(match)}
                            >
                                {/* Avatar */}
                                <View style={styles.avatarWrap}>
                                    {match.otherUserPhotoUrls?.[0] ? (
                                        <Image
                                            source={{ uri: match.otherUserPhotoUrls[0] }}
                                            style={styles.avatar}
                                        />
                                    ) : (
                                        <View style={styles.avatarPlaceholder}>
                                            <Text style={styles.avatarInitial}>
                                                {match.otherUserName?.charAt(0) ?? '?'}
                                            </Text>
                                        </View>
                                    )}
                                    {/* Online dot */}
                                    <View style={styles.onlineDot} />
                                </View>

                                {/* Info */}
                                <View style={styles.cardInfo}>
                                    <View style={styles.cardRow}>
                                        <Text style={styles.cardName} numberOfLines={1}>
                                            {match.otherUserName}
                                        </Text>
                                        <View style={styles.cardMeta}>
                                            {hasUnread && (
                                                <View style={styles.unreadBadge}>
                                                    <Text style={styles.unreadCount}>{match.unreadCount}</Text>
                                                </View>
                                            )}
                                            <Text style={styles.cardTime}>
                                                {match.createdAt ? timeAgo(match.createdAt) : ''}
                                            </Text>
                                        </View>
                                    </View>
                                    <Text style={styles.cardLocation} numberOfLines={1}>
                                        📍 {match.otherUserLocation}
                                    </Text>
                                    <Text
                                        style={[styles.cardPreview, hasUnread && styles.cardPreviewBold]}
                                        numberOfLines={1}
                                    >
                                        {lastMsg}
                                    </Text>

                                    {/* RM tag */}
                                    <View style={styles.rmTag}>
                                        <Text style={styles.rmTagText}>✦ RM Matched</Text>
                                    </View>
                                </View>
                            </Pressable>
                        );
                    }}
                />
            )}
        </SafeAreaView>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const GOLD = '#d4b373';
const DARK_BG = '#0d0c0f';
const CARD_BG = '#1a1828';
const BORDER = '#2a2640';
const TEXT_PRIMARY = '#f0ece8';
const TEXT_MUTED = '#6c6880';
const TEXT_SUB = '#8e8aa0';
const ACCENT = '#11313c';

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: DARK_BG,
    },

    // ── Header ─────────────────────────────────────────────────────────────
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
        gap: 10,
    },
    backBtn: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1a1828',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: BORDER,
    },
    backArrow: {
        fontSize: 26,
        color: GOLD,
        lineHeight: 28,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: TEXT_PRIMARY,
    },
    headerSub: {
        fontSize: 12,
        color: TEXT_MUTED,
        marginTop: 1,
    },
    crownBadge: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(212,179,115,0.12)',
        borderWidth: 1,
        borderColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
    },
    crownText: {
        fontSize: 16,
    },

    // ── Search ──────────────────────────────────────────────────────────────
    searchWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginVertical: 12,
        backgroundColor: '#1a1828',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 8,
    },
    searchIcon: { fontSize: 14 },
    searchInput: {
        flex: 1,
        fontSize: 14,
        color: TEXT_PRIMARY,
    },
    searchClear: {
        fontSize: 12,
        color: TEXT_MUTED,
        paddingHorizontal: 4,
    },
    divider: {
        height: 1,
        backgroundColor: BORDER,
        marginHorizontal: 16,
        marginBottom: 4,
    },

    // ── List ────────────────────────────────────────────────────────────────
    listContent: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 24,
        gap: 10,
    },

    matchCard: {
        flexDirection: 'row',
        backgroundColor: CARD_BG,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: BORDER,
        padding: 14,
        gap: 12,
        alignItems: 'flex-start',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    avatarWrap: {
        position: 'relative',
    },
    avatar: {
        width: 58,
        height: 58,
        borderRadius: 29,
        borderWidth: 2,
        borderColor: GOLD,
    },
    avatarPlaceholder: {
        width: 58,
        height: 58,
        borderRadius: 29,
        backgroundColor: '#2a2640',
        borderWidth: 2,
        borderColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarInitial: {
        fontSize: 22,
        fontWeight: '700',
        color: GOLD,
    },
    onlineDot: {
        position: 'absolute',
        bottom: 2,
        right: 2,
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#11d182',
        borderWidth: 2,
        borderColor: CARD_BG,
    },

    cardInfo: {
        flex: 1,
        gap: 3,
    },
    cardRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    cardName: {
        fontSize: 15,
        fontWeight: '700',
        color: TEXT_PRIMARY,
        flex: 1,
    },
    cardMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    unreadBadge: {
        backgroundColor: GOLD,
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 5,
    },
    unreadCount: {
        fontSize: 11,
        fontWeight: '700',
        color: DARK_BG,
    },
    cardTime: {
        fontSize: 11,
        color: TEXT_MUTED,
    },
    cardLocation: {
        fontSize: 12,
        color: TEXT_SUB,
    },
    cardPreview: {
        fontSize: 13,
        color: TEXT_MUTED,
        lineHeight: 18,
    },
    cardPreviewBold: {
        color: TEXT_PRIMARY,
        fontWeight: '600',
    },
    rmTag: {
        alignSelf: 'flex-start',
        marginTop: 4,
        backgroundColor: 'rgba(212,179,115,0.12)',
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderWidth: 1,
        borderColor: 'rgba(212,179,115,0.3)',
    },
    rmTagText: {
        fontSize: 10,
        fontWeight: '600',
        color: GOLD,
        letterSpacing: 0.5,
    },

    // ── Empty / Loading ─────────────────────────────────────────────────────
    loadingWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
    },
    loadingText: {
        fontSize: 14,
        color: TEXT_MUTED,
    },
    emptyWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
        gap: 10,
    },
    emptyEmoji: {
        fontSize: 48,
        marginBottom: 6,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: TEXT_PRIMARY,
        textAlign: 'center',
    },
    emptyDesc: {
        fontSize: 13,
        color: TEXT_MUTED,
        textAlign: 'center',
        lineHeight: 20,
    },

    // ── Conversation header ─────────────────────────────────────────────────
    convHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
        gap: 10,
    },
    convHeaderProfile: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    convAvatar: {
        width: 42,
        height: 42,
        borderRadius: 21,
        borderWidth: 2,
        borderColor: GOLD,
    },
    convAvatarPlaceholder: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: '#2a2640',
        borderWidth: 2,
        borderColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
    },
    convAvatarInitial: {
        fontSize: 18,
        fontWeight: '700',
        color: GOLD,
    },
    convName: {
        fontSize: 15,
        fontWeight: '700',
        color: TEXT_PRIMARY,
    },
    convSub: {
        fontSize: 11,
        color: GOLD,
        fontStyle: 'italic',
    },
    convHeaderRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    shareContactBtn: {
        backgroundColor: GOLD,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 7,
        shadowColor: GOLD,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 3,
    },
    shareContactBtnText: {
        fontSize: 12,
        fontWeight: '800',
        color: DARK_BG,
    },
    btnDisabled: {
        opacity: 0.6,
    },
    goldBadge: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(212,179,115,0.12)',
        borderWidth: 1,
        borderColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
    },
    goldBadgeText: { fontSize: 14 },

    // ── Unlocked Contact Info Bar ───────────────────────────────────────────
    unlockedContactBar: {
        marginHorizontal: 14,
        marginTop: 8,
        backgroundColor: 'rgba(17,209,130,0.1)',
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: '#11d182',
    },
    unlockedContactTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#11d182',
        marginBottom: 4,
    },
    unlockedContactRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    unlockedContactText: {
        fontSize: 13,
        fontWeight: '700',
        color: TEXT_PRIMARY,
    },

    // ── RM banner ───────────────────────────────────────────────────────────
    rmBanner: {
        marginHorizontal: 14,
        marginVertical: 8,
        backgroundColor: 'rgba(212,179,115,0.08)',
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: 'rgba(212,179,115,0.2)',
    },
    rmBannerLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: GOLD,
        letterSpacing: 0.5,
        marginBottom: 4,
    },
    rmBannerText: {
        fontSize: 12,
        color: TEXT_SUB,
        lineHeight: 17,
        fontStyle: 'italic',
    },


    // ── Messages ────────────────────────────────────────────────────────────
    msgLoading: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    messagesScroll: {
        flex: 1,
    },
    messagesContent: {
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 10,
    },
    emptyConvWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
        paddingTop: 60,
        gap: 10,
    },
    emptyConvEmoji: {
        fontSize: 40,
        marginBottom: 6,
    },
    emptyConvText: {
        fontSize: 13,
        color: TEXT_MUTED,
        textAlign: 'center',
        lineHeight: 20,
    },

    // ── Message bubbles ─────────────────────────────────────────────────────
    msgRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
        marginBottom: 4,
    },
    msgRowMe: {
        justifyContent: 'flex-end',
    },
    msgRowThem: {
        justifyContent: 'flex-start',
    },
    msgAvatar: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#2a2640',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: GOLD,
    },
    msgAvatarImg: {
        width: 28,
        height: 28,
        borderRadius: 14,
    },
    msgAvatarInitial: {
        fontSize: 12,
        fontWeight: '700',
        color: GOLD,
    },
    bubble: {
        maxWidth: '72%',
        borderRadius: 18,
        padding: 12,
        gap: 4,
    },
    bubbleMe: {
        backgroundColor: GOLD,
        borderBottomRightRadius: 4,
    },
    bubbleThem: {
        backgroundColor: CARD_BG,
        borderBottomLeftRadius: 4,
        borderWidth: 1,
        borderColor: BORDER,
    },
    bubbleText: {
        fontSize: 14,
        color: TEXT_MUTED,
        lineHeight: 20,
    },
    bubbleTextMe: {
        color: DARK_BG,
        fontWeight: '500',
    },
    bubbleTime: {
        fontSize: 10,
        color: TEXT_MUTED,
        alignSelf: 'flex-end',
    },
    bubbleTimeMe: {
        color: 'rgba(13,12,15,0.5)',
    },
    redactedBubble: {
        borderColor: GOLD,
        borderWidth: 1.5,
        backgroundColor: 'rgba(212,179,115,0.12)',
    },
    redactedText: {
        color: GOLD,
        fontWeight: '700',
        lineHeight: 20,
    },

    // ── Input bar ───────────────────────────────────────────────────────────
    inputBar: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: BORDER,
        backgroundColor: '#12101a',
        gap: 10,
    },
    input: {
        flex: 1,
        backgroundColor: CARD_BG,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 16,
        paddingVertical: 10,
        fontSize: 14,
        color: TEXT_PRIMARY,
        maxHeight: 100,
    },
    sendBtn: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: GOLD,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.4,
        shadowRadius: 6,
        elevation: 4,
    },
    sendBtnDisabled: {
        backgroundColor: '#2a2640',
        shadowOpacity: 0,
        elevation: 0,
    },
    sendBtnText: {
        fontSize: 20,
        fontWeight: '700',
        color: DARK_BG,
        lineHeight: 22,
    },
});
