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
} from 'react-native';
import { ProfileRecord } from '../lib/profile';
import { ConciergeSession, IntakeChatMessage, fetchConciergeSession, sendIntakeMessage } from '../lib/conciergeApi';

const { width } = Dimensions.get('window');
const isTablet = width > 768;

export default function ConciergeHubScreen({
    viewerProfile,
    onViewProfile,
    onSignOut,
}: {
    viewerProfile: ProfileRecord | null;
    onViewProfile: (profileId: string) => void;
    onSignOut: () => void;
}) {
    const firstName = viewerProfile?.full_name?.split(' ')[0] || 'Member';

    const [session, setSession] = useState<ConciergeSession | null>(null);
    const [loadingSession, setLoadingSession] = useState(true);
    const [messages, setMessages] = useState<IntakeChatMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [sending, setSending] = useState(false);
    const [typing, setTyping] = useState(false);
    const [completionSummary, setCompletionSummary] = useState<string | null>(null);

    const scrollViewRef = useRef<ScrollView>(null);
    const typingAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        loadSession();
    }, []);

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

            if (!sess || sess.status === 'INTAKE_IN_PROGRESS') {
                // If there are no messages, trigger the initial message
                if (messages.length === 0) {
                    await triggerFirstMessage();
                }
            }
        } catch (error) {
            console.error('Failed to load concierge session:', error);
        } finally {
            setLoadingSession(false);
        }
    }

    async function triggerFirstMessage() {
        setTyping(true);
        try {
            const res = await sendIntakeMessage([]);
            setMessages([
                {
                    role: 'assistant',
                    content: res.message,
                },
            ]);
        } catch (error) {
            console.error('Failed to trigger first intake message:', error);
            setMessages([
                {
                    role: 'assistant',
                    content: `Hello ${firstName}, I am your AI Relationship Manager. I'm here to help you define and capture your soft partner preferences. Shall we begin?`,
                },
            ]);
        } finally {
            setTyping(false);
            scrollToBottom();
        }
    }

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
        setTyping(true);

        try {
            const res = await sendIntakeMessage(updatedMessages);
            if (res.status === 'COMPLETE') {
                setCompletionSummary(res.summary || res.message);
            } else {
                setMessages((prev) => [...prev, { role: 'assistant', content: res.message }]);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            setMessages((prev) => [
                ...prev,
                {
                    role: 'assistant',
                    content: "I'm sorry, I encountered an issue saving your preferences. Let's try that again.",
                },
            ]);
        } finally {
            setSending(false);
            setTyping(false);
            scrollToBottom();
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
                        🔍 Status: Sourcing Match Candidates
                    </Text>
                    <Text style={styles.statusDesc}>
                        We are aligning your blueprint with matches. Refreshing your dashboard...
                    </Text>

                    {completionSummary && (
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
        backgroundColor: '#eff6f8',
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        marginTop: 12,
        color: '#11313c',
        fontSize: 16,
        fontWeight: '600',
    },
    container: {
        flex: 1,
        backgroundColor: '#eff6f8',
    },
    keyboardView: {
        flex: 1,
    },
    header: {
        backgroundColor: '#11313c',
        paddingHorizontal: 20,
        paddingVertical: 18,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#1d4857',
    },
    headerTitle: {
        color: '#ffffff',
        fontSize: 18,
        fontWeight: '700',
    },
    headerSubtitle: {
        color: '#8a9ca4',
        fontSize: 12,
        marginTop: 2,
    },
    signOutBtn: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        backgroundColor: '#1d4857',
        borderRadius: 6,
    },
    signOutText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '600',
    },
    warningBanner: {
        backgroundColor: '#fff3cd',
        paddingVertical: 8,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#ffeeba',
    },
    warningText: {
        color: '#856404',
        fontSize: 12,
        fontWeight: '600',
        textAlign: 'center',
    },
    chatScroll: {
        padding: 20,
        paddingBottom: 40,
    },
    welcomeCard: {
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e0e8ec',
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
        color: '#11313c',
        textAlign: 'center',
        marginBottom: 8,
    },
    welcomeDesc: {
        fontSize: 13,
        color: '#5a6e75',
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
    },
    assistantBubble: {
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e0e8ec',
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
        color: '#11313c',
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
        backgroundColor: '#11313c',
        marginHorizontal: 3,
    },
    inputBar: {
        flexDirection: 'row',
        padding: 12,
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e0e8ec',
        alignItems: 'center',
    },
    input: {
        flex: 1,
        height: 44,
        borderWidth: 1,
        borderColor: '#ced8dc',
        borderRadius: 22,
        paddingHorizontal: 16,
        fontSize: 15,
        color: '#11313c',
        backgroundColor: '#f8fafb',
    },
    inputDisabled: {
        backgroundColor: '#eceff1',
        borderColor: '#cfd8dc',
    },
    sendButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#11313c',
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 10,
    },
    sendButtonDisabled: {
        backgroundColor: '#b0bec5',
    },
    sendButtonPressed: {
        opacity: 0.8,
    },
    sendButtonText: {
        color: '#ffffff',
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
        backgroundColor: '#ffffff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e0e8ec',
        padding: 24,
        alignItems: 'center',
        shadowColor: '#11313c',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 2,
    },
    checkmarkIcon: {
        fontSize: 48,
        color: '#2b8a6e',
        marginBottom: 16,
    },
    statusTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#11313c',
        marginBottom: 8,
    },
    statusSubtitle: {
        fontSize: 14,
        color: '#5a6e75',
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 20,
    },
    summaryScroll: {
        maxHeight: 180,
        width: '100%',
        backgroundColor: '#f8fafb',
        borderWidth: 1,
        borderColor: '#e0e8ec',
        borderRadius: 8,
        marginVertical: 12,
    },
    summaryContainer: {
        padding: 12,
    },
    summaryHeader: {
        fontSize: 12,
        fontWeight: '700',
        color: '#78909c',
        textTransform: 'uppercase',
        marginBottom: 6,
    },
    summaryText: {
        fontSize: 13,
        color: '#11313c',
        lineHeight: 18,
    },
    divider: {
        height: 1,
        backgroundColor: '#eceff1',
        width: '100%',
        marginVertical: 20,
    },
    statusBanner: {
        fontSize: 15,
        fontWeight: '700',
        color: '#2b8a6e',
        marginBottom: 6,
    },
    statusDesc: {
        fontSize: 13,
        color: '#78909c',
        textAlign: 'center',
        lineHeight: 18,
    },
    continueBtn: {
        marginTop: 20,
        backgroundColor: '#11313c',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 22,
        width: '100%',
        alignItems: 'center',
    },
    continueBtnText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '600',
    },
    logoutFooter: {
        marginTop: 24,
        alignSelf: 'center',
    },
    logoutFooterText: {
        color: '#5a6e75',
        fontSize: 14,
        fontWeight: '500',
        textDecorationLine: 'underline',
    },
});
