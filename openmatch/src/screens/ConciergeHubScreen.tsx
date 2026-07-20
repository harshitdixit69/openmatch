import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    Image,
} from 'react-native';
import { ProfileRecord } from '../lib/profile';
import { ConciergeSession, IntakeChatMessage, fetchConciergeSession, sendIntakeMessage, submitRawIntakeTranscript, AssistedShortlistItem, fetchAssistedShortlist, updateShortlistFeedback } from '../lib/conciergeApi';
import { supabase } from '../lib/supabase';

const { width } = Dimensions.get('window');
const isTablet = width > 768;

const MOCK_QUESTIONS = [
    "Welcome to the Assisted tier! First, tell us about your daily lifestyle. Are you a morning person, night owl, or do you have a busy career schedule?",
    "Great! Next, how do you envision family dynamics? (e.g. living in a joint family vs. nuclear family, in-law involvement?)",
    "Perfect. What are your expectations regarding career balance and sharing responsibilities at home?",
    "Lastly, are there any absolute deal-breakers for you beyond the standard filters (e.g., specific habits, communication styles)?"
];

export default function ConciergeHubScreen({
    viewerProfile,
    onViewProfile,
    onSignOut,
    refreshCounter = 0,
}: {
    viewerProfile: ProfileRecord | null;
    onViewProfile: (profileId: string) => void;
    onSignOut: () => void;
    refreshCounter?: number;
}) {
    const firstName = viewerProfile?.full_name?.split(' ')[0] || 'Member';

    const [session, setSession] = useState<ConciergeSession | null>(null);
    const [loadingSession, setLoadingSession] = useState(true);
    const [messages, setMessages] = useState<IntakeChatMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [sending, setSending] = useState(false);
    const [typing, setTyping] = useState(false);
    const [completionSummary, setCompletionSummary] = useState<string | null>(null);
    const [mockStep, setMockStep] = useState(0);
    const [shortlistItems, setShortlistItems] = useState<AssistedShortlistItem[]>([]);
    const [loadingShortlist, setLoadingShortlist] = useState(false);
    const [generatingShortlist, setGeneratingShortlist] = useState(false);

    const scrollViewRef = useRef<ScrollView>(null);
    const typingAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        loadSession();
    }, [refreshCounter]);

    useEffect(() => {
        if (session && session.status === 'AWAITING_SHORTLIST' && !generatingShortlist) {
            triggerShortlistGeneration();
        }
    }, [session]);

    async function triggerShortlistGeneration() {
        try {
            setGeneratingShortlist(true);
            const { data, error } = await supabase.functions.invoke('generate-assisted-shortlist');
            if (error) throw error;
            
            if (data && data.success) {
                const sess = await fetchConciergeSession();
                setSession(sess);
                if (sess && sess.status === 'SHORTLIST_READY') {
                    await loadShortlist(sess.id);
                }
            }
        } catch (error) {
            console.error('Failed to trigger shortlist generation:', error);
        } finally {
            setGeneratingShortlist(false);
        }
    }

    useEffect(() => {
        if (typing) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(typingAnim, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.timing(typingAnim, {
                        toValue: 0,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        } else {
            typingAnim.setValue(0);
        }
    }, [typing]);

    async function loadSession() {
        try {
            setLoadingSession(true);
            const sess = await fetchConciergeSession();
            setSession(sess);

            if (sess && sess.status === 'SHORTLIST_READY') {
                await loadShortlist(sess.id);
            } else if (!sess || sess.status === 'INTAKE_IN_PROGRESS') {
                if (messages.length === 0) {
                    setMessages([
                        {
                            role: 'assistant',
                            content: MOCK_QUESTIONS[0],
                        },
                    ]);
                    setMockStep(1);
                }
            }
        } catch (error) {
            console.error('Failed to load concierge session:', error);
        } finally {
            setLoadingSession(false);
        }
    }

    async function loadShortlist(sessId: string) {
        try {
            setLoadingShortlist(true);
            const items = await fetchAssistedShortlist(sessId);
            setShortlistItems(items);
        } catch (error) {
            console.error('Failed to load shortlist:', error);
        } finally {
            setLoadingShortlist(false);
        }
    }

    const handleFeedback = async (itemId: string, status: 'liked' | 'disliked') => {
        setShortlistItems((prev) =>
            prev.map((item) =>
                item.id === itemId ? { ...item, feedback_status: status } : item
            )
        );
        try {
            await updateShortlistFeedback(itemId, status);
        } catch (error) {
            console.error(`Failed to update feedback status for item ${itemId}:`, error);
            setShortlistItems((prev) =>
                prev.map((item) =>
                    item.id === itemId ? { ...item, feedback_status: 'pending' } : item
                )
            );
        }
    };

    const scrollToBottom = () => {
        setTimeout(() => {
            scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);
    };

    const handleSend = async () => {
        if (!inputText.trim() || sending || typing) return;

        const userText = inputText.trim();
        setInputText('');

        const newUserMessage: IntakeChatMessage = { role: 'user', content: userText };
        const updatedMessages = [...messages, newUserMessage];
        setMessages(updatedMessages);
        scrollToBottom();

        setSending(true);

        // Wait a short bit to feel like AI is typing
        setTyping(true);
        await new Promise(resolve => setTimeout(resolve, 1000));
        setTyping(false);

        if (mockStep < 4) {
            const nextQuestion = MOCK_QUESTIONS[mockStep];
            setMessages((prev) => [...prev, { role: 'assistant', content: nextQuestion }]);
            setMockStep((prev) => prev + 1);
            setSending(false);
            scrollToBottom();
        } else {
            // All 4 questions answered. Compile transcript and call Edge Function!
            try {
                const transcript = updatedMessages
                    .map((m) => `${m.role === 'user' ? 'User' : 'AI RM'}: ${m.content}`)
                    .join('\n');

                const res = await submitRawIntakeTranscript(transcript);
                if (res.success || res.status === 'AWAITING_SHORTLIST') {
                    setSession({
                        id: 'sess-new',
                        user_id: viewerProfile?.id || '',
                        status: 'AWAITING_SHORTLIST',
                        intake_notes: transcript,
                        intake_completed_at: new Date().toISOString(),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    });
                    setCompletionSummary(transcript);
                } else {
                    throw new Error('Failed to submit transcript.');
                }
            } catch (error) {
                console.error('Error submitting transcript:', error);
                setMessages((prev) => [
                    ...prev,
                    {
                        role: 'assistant',
                        content: "I'm sorry, I encountered an issue submitting your interview. Let's try to submit again.",
                    },
                ]);
            } finally {
                setSending(false);
                scrollToBottom();
            }
        }
    };

    const handleContinue = async () => {
        setCompletionSummary(null);
        await loadSession();
    };

    if (loadingSession) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#11313c" />
                <Text style={styles.loadingText}>Initializing Concierge Hub...</Text>
            </SafeAreaView>
        );
    }

    const isIntakeInProgress = !session || session.status === 'INTAKE_IN_PROGRESS';

    if (isIntakeInProgress && !completionSummary) {
        const remainingLimit = 30 - messages.filter((m) => m.role === 'user').length;
        const limitReached = remainingLimit <= 0;

        return (
            <SafeAreaView style={styles.container}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    style={styles.keyboardView}
                >
                    {/* Header */}
                    <View style={styles.header}>
                        <View>
                            <Text style={styles.headerTitle}>AI Relationship Manager</Text>
                            <Text style={styles.headerSubtitle}>Nuanced Soft Preferences Intake</Text>
                        </View>
                        <Pressable onPress={onSignOut} style={styles.signOutBtn}>
                            <Text style={styles.signOutText}>Sign Out</Text>
                        </Pressable>
                    </View>

                    {/* Limit Indicator */}
                    {remainingLimit <= 5 && remainingLimit > 0 && (
                        <View style={styles.warningBanner}>
                            <Text style={styles.warningText}>
                                {remainingLimit} interview messages remaining.
                            </Text>
                        </View>
                    )}

                    {/* Chat Area */}
                    <ScrollView
                        ref={scrollViewRef}
                        contentContainerStyle={styles.chatScroll}
                        onContentSizeChange={scrollToBottom}
                    >
                        <View style={styles.welcomeCard}>
                            <Text style={styles.welcomeEmoji}>🤝</Text>
                            <Text style={styles.welcomeTitle}>Let's build your matchmaking blueprint</Text>
                            <Text style={styles.welcomeDesc}>
                                Matrimonial success goes beyond structured filters. I'll interview you to understand your lifestyle, dynamic expectations, and compatibility priorities.
                            </Text>
                        </View>

                        {messages.map((msg, idx) => (
                            <View
                                key={idx}
                                style={[
                                    styles.bubbleWrapper,
                                    msg.role === 'user' ? styles.userWrapper : styles.assistantWrapper,
                                ]}
                            >
                                <View
                                    style={[
                                        styles.bubble,
                                        msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.bubbleText,
                                            msg.role === 'user' ? styles.userText : styles.assistantText,
                                        ]}
                                    >
                                        {msg.content}
                                    </Text>
                                </View>
                            </View>
                        ))}

                        {typing && (
                            <View style={[styles.bubbleWrapper, styles.assistantWrapper]}>
                                <View style={[styles.bubble, styles.assistantBubble, styles.typingBubble]}>
                                    <Animated.View
                                        style={[
                                            styles.typingDot,
                                            {
                                                opacity: typingAnim.interpolate({
                                                    inputRange: [0, 0.5, 1],
                                                    outputRange: [0.3, 1, 0.3],
                                                }),
                                            },
                                        ]}
                                    />
                                    <Animated.View
                                        style={[
                                            styles.typingDot,
                                            {
                                                opacity: typingAnim.interpolate({
                                                    inputRange: [0, 0.5, 1],
                                                    outputRange: [0.6, 0.3, 1],
                                                }),
                                            },
                                        ]}
                                    />
                                    <Animated.View
                                        style={[
                                            styles.typingDot,
                                            {
                                                opacity: typingAnim.interpolate({
                                                    inputRange: [0, 0.5, 1],
                                                    outputRange: [1, 0.6, 0.3],
                                                }),
                                            },
                                        ]}
                                    />
                                </View>
                            </View>
                        )}
                    </ScrollView>

                    {/* Input Bar */}
                    <View style={styles.inputBar}>
                        <TextInput
                            style={[styles.input, limitReached && styles.inputDisabled]}
                            value={inputText}
                            onChangeText={setInputText}
                            placeholder={limitReached ? 'Interview complete' : 'Type your answer...'}
                            placeholderTextColor="#8a9ca4"
                            editable={!sending && !typing && !limitReached}
                            onSubmitEditing={handleSend}
                        />
                        <Pressable
                            onPress={handleSend}
                            disabled={sending || typing || !inputText.trim() || limitReached}
                            style={({ pressed }) => [
                                styles.sendButton,
                                (sending || typing || !inputText.trim() || limitReached) && styles.sendButtonDisabled,
                                pressed && styles.sendButtonPressed,
                            ]}
                        >
                            <Text style={styles.sendButtonText}>→</Text>
                        </Pressable>
                    </View>
                </KeyboardAvoidingView>
            </SafeAreaView>
        );
    }

function dateToAge(dobString: string): number {
    if (!dobString) return 30;
    const dob = new Date(dobString);
    const diff = Date.now() - dob.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

    if (session?.status === 'SHORTLIST_READY') {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.header}>
                    <View>
                        <Text style={styles.headerTitle}>Curated Shortlist</Text>
                        <Text style={styles.headerSubtitle}>Handselected by your Relationship Manager</Text>
                    </View>
                    <Pressable onPress={onSignOut} style={styles.signOutBtn}>
                        <Text style={styles.signOutText}>Sign Out</Text>
                    </Pressable>
                </View>

                {loadingShortlist ? (
                    <View style={styles.loadingShortlistContainer}>
                        <ActivityIndicator size="large" color="#11313c" />
                        <Text style={styles.loadingShortlistText}>Loading your curated matches...</Text>
                    </View>
                ) : shortlistItems.length === 0 ? (
                    <View style={styles.emptyShortlistContainer}>
                        <Text style={styles.emptyEmoji}>🔍</Text>
                        <Text style={styles.emptyText}>Your Relationship Manager is curating matches for you.</Text>
                    </View>
                ) : (
                    <ScrollView contentContainerStyle={styles.shortlistScroll}>
                        {shortlistItems.map((item) => {
                            const profile = item.candidate_profile;
                            if (!profile) return null;
                            const age = profile.dob ? dateToAge(profile.dob) : '30';

                            return (
                                <View key={item.id} style={styles.matchCard}>
                                    <Pressable onPress={() => onViewProfile(profile.id)}>
                                        {/* Gallery / Image */}
                                        {profile.photo_urls && profile.photo_urls[0] ? (
                                            <Image
                                                source={{ uri: profile.photo_urls[0] }}
                                                style={styles.candidateImage}
                                                resizeMode="cover"
                                            />
                                        ) : (
                                            <View style={styles.imagePlaceholder}>
                                                <Text style={styles.imagePlaceholderText}>
                                                    {profile.full_name?.charAt(0) || 'M'}
                                                </Text>
                                            </View>
                                        )}

                                        {/* Candidate Info */}
                                        <View style={[styles.cardInfo, { paddingBottom: 0 }]}>
                                            <Text style={styles.candidateName}>
                                                {profile.full_name}, {age}
                                            </Text>
                                            <Text style={styles.candidateLoc}>{profile.location}</Text>

                                            <View style={styles.attributeRow}>
                                                {profile.occupation && (
                                                    <Text style={styles.attributeTag}>💼 {profile.occupation}</Text>
                                                )}
                                                {profile.education && (
                                                    <Text style={styles.attributeTag}>🎓 {profile.education}</Text>
                                                )}
                                                {profile.diet && (
                                                    <Text style={styles.attributeTag}>🥦 {profile.diet}</Text>
                                                )}
                                            </View>
                                        </View>
                                    </Pressable>

                                    <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                                        {/* RM Pitch Rationale */}
                                        <View style={styles.pitchBox}>
                                            <Text style={styles.pitchLabel}>💝 Dedicated RM Pitch</Text>
                                            <Text style={styles.pitchText}>{item.match_rationale}</Text>
                                        </View>

                                        {/* Actions */}
                                        {item.feedback_status === 'pending' ? (
                                            <View style={styles.actionRow}>
                                                <Pressable
                                                    onPress={() => handleFeedback(item.id, 'disliked')}
                                                    style={[styles.actionBtn, styles.passBtn]}
                                                >
                                                    <Text style={styles.passBtnText}>✕ Pass</Text>
                                                </Pressable>
                                                <Pressable
                                                    onPress={() => handleFeedback(item.id, 'liked')}
                                                    style={[styles.actionBtn, styles.likeBtn]}
                                                >
                                                    <Text style={styles.likeBtnText}>💖 Like</Text>
                                                </Pressable>
                                            </View>
                                        ) : (
                                            <View style={styles.feedbackBanner}>
                                                <Text style={styles.feedbackBannerText}>
                                                    {item.feedback_status === 'liked' ? 'Liked 💖' : 'Passed ✕'}
                                                </Text>
                                                <Pressable onPress={() => handleFeedback(item.id, 'pending')}>
                                                    <Text style={styles.undoText}>Undo</Text>
                                                </Pressable>
                                            </View>
                                        )}
                                    </View>
                                </View>
                            );
                        })}
                    </ScrollView>
                )}
            </SafeAreaView>
        );
    }

    // Complete / Sourcing View
    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.completeContent}>
                <View style={styles.statusCard}>
                    <Text style={styles.checkmarkIcon}>✓</Text>
                    <Text style={styles.statusTitle}>Intake Completed</Text>
                    <Text style={styles.statusSubtitle}>
                        Your AI Relationship Manager has mapped your soft preferences.
                    </Text>

                    {completionSummary || session?.intake_notes ? (
                        <ScrollView style={styles.summaryScroll} contentContainerStyle={styles.summaryContainer}>
                            <Text style={styles.summaryHeader}>Nuanced Preferences Blueprint:</Text>
                            <Text style={styles.summaryText}>
                                {completionSummary || session?.intake_notes}
                            </Text>
                        </ScrollView>
                    ) : null}

                    <View style={styles.divider} />
                    
                    <Text style={styles.statusBanner}>
                        {session?.status === 'AWAITING_SHORTLIST' ? '🔍 Status: Awaiting Shortlist' : '🔍 Status: Sourcing Match Candidates'}
                    </Text>
                    <Text style={styles.statusDesc}>
                        {session?.status === 'AWAITING_SHORTLIST' ? 'Your dedicated RM is curating your matches...' : 'We are aligning your blueprint with matches. Refreshing your dashboard...'}
                    </Text>

                    {generatingShortlist ? (
                        <View style={{ marginTop: 16, alignItems: 'center' }}>
                            <ActivityIndicator size="small" color="#11313c" />
                            <Text style={[styles.statusDesc, { marginTop: 8, color: '#11313c', fontWeight: '600' }]}>
                                Curating your personalized matches...
                            </Text>
                        </View>
                    ) : (
                        session?.status === 'AWAITING_SHORTLIST' && (
                            <Pressable 
                                style={[styles.continueBtn, { backgroundColor: '#11313c', marginTop: 16 }]} 
                                onPress={triggerShortlistGeneration}
                            >
                                <Text style={styles.continueBtnText}>Curate Matches Now</Text>
                            </Pressable>
                        )
                    )}

                    {completionSummary && !generatingShortlist && (
                        <Pressable style={styles.continueBtn} onPress={handleContinue}>
                            <Text style={styles.continueBtnText}>Continue to Dashboard</Text>
                        </Pressable>
                    )}
                </View>

                <Pressable onPress={onSignOut} style={styles.logoutFooter}>
                    <Text style={styles.logoutFooterText}>Sign Out of OpenMatch</Text>
                </Pressable>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    loadingContainer: {
        flex: 1,
        backgroundColor: '#0d0c0f',
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        marginTop: 12,
        color: '#d4b373',
        fontSize: 16,
        fontWeight: '600',
    },
    container: {
        flex: 1,
        backgroundColor: '#0d0c0f',
    },
    keyboardView: {
        flex: 1,
    },
    header: {
        backgroundColor: '#16151a',
        paddingHorizontal: 20,
        paddingVertical: 18,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#26242e',
    },
    headerTitle: {
        color: '#ffffff',
        fontSize: 18,
        fontWeight: '700',
    },
    headerSubtitle: {
        color: '#d4b373',
        fontSize: 12,
        marginTop: 2,
    },
    signOutBtn: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        backgroundColor: '#2a1f10',
        borderWidth: 1,
        borderColor: '#a1824a',
        borderRadius: 6,
    },
    signOutText: {
        color: '#e5c184',
        fontSize: 12,
        fontWeight: '600',
    },
    warningBanner: {
        backgroundColor: '#2a1e12',
        paddingVertical: 8,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#5c4d32',
    },
    warningText: {
        color: '#e5c184',
        fontSize: 12,
        fontWeight: '600',
        textAlign: 'center',
    },
    chatScroll: {
        padding: 20,
        paddingBottom: 40,
        backgroundColor: '#0d0c0f',
    },
    welcomeCard: {
        backgroundColor: '#16151a',
        borderWidth: 1,
        borderColor: '#26242e',
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
        alignItems: 'center',
    },
    welcomeEmoji: {
        fontSize: 32,
        marginBottom: 10,
    },
    welcomeTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#ffffff',
        textAlign: 'center',
        marginBottom: 8,
    },
    welcomeDesc: {
        fontSize: 13,
        color: '#a19fb0',
        textAlign: 'center',
        lineHeight: 18,
    },
    bubbleWrapper: {
        marginVertical: 6,
        flexDirection: 'row',
        width: '100%',
    },
    userWrapper: {
        justifyContent: 'flex-end',
    },
    assistantWrapper: {
        justifyContent: 'flex-start',
    },
    bubble: {
        maxWidth: isTablet ? '60%' : '80%',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 16,
    },
    userBubble: {
        backgroundColor: '#11313c',
        borderBottomRightRadius: 4,
        borderWidth: 1,
        borderColor: '#1d4857',
    },
    assistantBubble: {
        backgroundColor: '#16151a',
        borderWidth: 1,
        borderColor: '#26242e',
        borderBottomLeftRadius: 4,
    },
    bubbleText: {
        fontSize: 15,
        lineHeight: 20,
    },
    userText: {
        color: '#ffffff',
    },
    assistantText: {
        color: '#ffffff',
    },
    typingBubble: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 20,
    },
    typingDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#e5c184',
        marginHorizontal: 3,
    },
    inputBar: {
        flexDirection: 'row',
        padding: 12,
        backgroundColor: '#16151a',
        borderTopWidth: 1,
        borderTopColor: '#26242e',
        alignItems: 'center',
    },
    input: {
        flex: 1,
        height: 44,
        borderWidth: 1,
        borderColor: '#26242e',
        borderRadius: 22,
        paddingHorizontal: 16,
        fontSize: 15,
        color: '#ffffff',
        backgroundColor: '#26242e',
    },
    inputDisabled: {
        backgroundColor: '#1c1b22',
        borderColor: '#26242e',
    },
    sendButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#d4b373',
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 10,
    },
    sendButtonDisabled: {
        backgroundColor: '#26242e',
        opacity: 0.5,
    },
    sendButtonPressed: {
        opacity: 0.8,
    },
    sendButtonText: {
        color: '#0d0c0f',
        fontSize: 20,
        fontWeight: 'bold',
        marginTop: -2,
    },
    completeContent: {
        flex: 1,
        justifyContent: 'center',
        padding: 24,
    },
    statusCard: {
        backgroundColor: '#16151a',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#26242e',
        padding: 24,
        alignItems: 'center',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
        elevation: 2,
    },
    checkmarkIcon: {
        fontSize: 48,
        color: '#d4b373',
        marginBottom: 16,
    },
    statusTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#ffffff',
        marginBottom: 8,
    },
    statusSubtitle: {
        fontSize: 14,
        color: '#a19fb0',
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 20,
    },
    summaryScroll: {
        maxHeight: 180,
        width: '100%',
        backgroundColor: '#26242e',
        borderWidth: 1,
        borderColor: '#3a3848',
        borderRadius: 8,
        marginVertical: 12,
    },
    summaryContainer: {
        padding: 12,
    },
    summaryHeader: {
        fontSize: 12,
        fontWeight: '700',
        color: '#d4b373',
        textTransform: 'uppercase',
        marginBottom: 6,
    },
    summaryText: {
        fontSize: 13,
        color: '#cfccd6',
        lineHeight: 18,
    },
    divider: {
        height: 1,
        backgroundColor: '#26242e',
        width: '100%',
        marginVertical: 20,
    },
    statusBanner: {
        fontSize: 15,
        fontWeight: '700',
        color: '#d4b373',
        marginBottom: 6,
    },
    statusDesc: {
        fontSize: 13,
        color: '#a19fb0',
        textAlign: 'center',
        lineHeight: 18,
    },
    continueBtn: {
        marginTop: 20,
        backgroundColor: '#d4b373',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 22,
        width: '100%',
        alignItems: 'center',
    },
    continueBtnText: {
        color: '#0d0c0f',
        fontSize: 15,
        fontWeight: '600',
    },
    logoutFooter: {
        marginTop: 24,
        alignSelf: 'center',
    },
    logoutFooterText: {
        color: '#a19fb0',
        fontSize: 14,
        fontWeight: '500',
        textDecorationLine: 'underline',
    },
    loadingShortlistContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0d0c0f',
        padding: 20,
    },
    loadingShortlistText: {
        marginTop: 12,
        color: '#d4b373',
        fontSize: 16,
        fontWeight: '600',
    },
    emptyShortlistContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
        backgroundColor: '#0d0c0f',
    },
    emptyEmoji: {
        fontSize: 48,
        marginBottom: 16,
    },
    emptyText: {
        fontSize: 16,
        color: '#a19fb0',
        textAlign: 'center',
        lineHeight: 22,
    },
    shortlistScroll: {
        padding: 16,
        paddingBottom: 40,
        backgroundColor: '#0d0c0f',
    },
    matchCard: {
        backgroundColor: '#16151a',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#26242e',
        overflow: 'hidden',
        marginBottom: 20,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 3,
    },
    candidateImage: {
        width: '100%',
        height: 260,
    },
    imagePlaceholder: {
        width: '100%',
        height: 260,
        backgroundColor: '#26242e',
        justifyContent: 'center',
        alignItems: 'center',
    },
    imagePlaceholderText: {
        fontSize: 64,
        fontWeight: '700',
        color: '#d4b373',
    },
    cardInfo: {
        padding: 20,
    },
    candidateName: {
        fontSize: 22,
        fontWeight: '700',
        color: '#ffffff',
    },
    candidateLoc: {
        fontSize: 14,
        color: '#a19fb0',
        marginTop: 4,
        marginBottom: 12,
    },
    attributeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 16,
    },
    attributeTag: {
        backgroundColor: '#26242e',
        color: '#e5c184',
        fontSize: 12,
        fontWeight: '600',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 12,
        marginRight: 8,
        marginBottom: 8,
    },
    pitchBox: {
        backgroundColor: '#1a1714',
        borderLeftWidth: 3,
        borderLeftColor: '#d4b373',
        padding: 14,
        borderRadius: 8,
        marginBottom: 16,
    },
    pitchLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#e5c184',
        textTransform: 'uppercase',
        marginBottom: 6,
    },
    pitchText: {
        fontSize: 14,
        color: '#dfdbdb',
        lineHeight: 20,
        fontStyle: 'italic',
    },
    actionRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    actionBtn: {
        flex: 1,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    passBtn: {
        backgroundColor: '#26242e',
        marginRight: 12,
    },
    passBtnText: {
        color: '#a19fb0',
        fontWeight: '700',
        fontSize: 14,
    },
    likeBtn: {
        backgroundColor: '#d4b373',
    },
    likeBtnText: {
        color: '#0d0c0f',
        fontWeight: '700',
        fontSize: 14,
    },
    feedbackBanner: {
        backgroundColor: '#1b2a1a',
        borderLeftWidth: 3,
        borderLeftColor: '#4caf50',
        padding: 12,
        borderRadius: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    feedbackBannerText: {
        color: '#81c784',
        fontWeight: '700',
        fontSize: 14,
    },
    undoText: {
        color: '#81c784',
        fontWeight: '700',
        fontSize: 13,
        textDecorationLine: 'underline',
    },
});
