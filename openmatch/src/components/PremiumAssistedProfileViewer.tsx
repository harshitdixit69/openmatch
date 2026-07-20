import React, { useState, useEffect, useRef } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Image,
    Modal,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { ProfileRecord } from '../lib/profile';
import { updateShortlistFeedback } from '../lib/conciergeApi';

const { width, height } = Dimensions.get('window');

type PremiumAssistedProfileViewerProps = {
    profileId: string;
    onClose: () => void;
};

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
};

export default function PremiumAssistedProfileViewer({
    profileId,
    onClose,
}: PremiumAssistedProfileViewerProps) {
    const [candidate, setCandidate] = useState<ProfileRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
    const [actionLoading, setActionLoading] = useState(false);

    // Shortlist item state loaded dynamically
    const [itemId, setItemId] = useState<string | null>(null);
    const [matchRationale, setMatchRationale] = useState<string>('');
    const [feedbackStatus, setFeedbackStatus] = useState<'pending' | 'liked' | 'disliked'>('pending');

    // Compatibility Chat State
    const [chatVisible, setChatVisible] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInputText, setChatInputText] = useState('');
    const [chatSending, setChatSending] = useState(false);

    const chatScrollViewRef = useRef<ScrollView>(null);

    useEffect(() => {
        async function loadProfile() {
            try {
                setLoading(true);
                
                // 1. Get current authenticated user
                const { data: { user }, error: authErr } = await supabase.auth.getUser();
                if (authErr || !user) throw new Error('Not authenticated.');

                // 2. Fetch candidate profile
                const { data: pData, error: pErr } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', profileId)
                    .single();

                if (pErr) throw pErr;
                setCandidate(pData);

                // Initialize chat welcome message
                setChatMessages([
                    {
                        role: 'assistant',
                        content: `Hello! I curated ${pData.full_name} for you. I'd be happy to discuss their compatibility or answer any questions you have about their lifestyle, career balance, or values. What would you like to know?`,
                    },
                ]);

                // 3. Fetch shortlist item for this user & candidate
                const { data: items, error: itemsErr } = await supabase
                    .from('assisted_shortlist_items')
                    .select(`
                        id,
                        match_rationale,
                        feedback_status,
                        assisted_shortlists (
                            user_id
                        )
                    `)
                    .eq('candidate_id', profileId);

                if (itemsErr) throw itemsErr;

                // Find the item belonging to this user's active shortlist
                const userItem = (items || []).find((item: any) => 
                    item.assisted_shortlists && item.assisted_shortlists.user_id === user.id
                );

                if (userItem) {
                    setItemId(userItem.id);
                    setMatchRationale(userItem.match_rationale);
                    setFeedbackStatus(userItem.feedback_status as 'pending' | 'liked' | 'disliked');
                }
            } catch (err) {
                console.error('Failed to load premium profile:', err);
                Alert.alert('Error', 'This profile details could not be loaded.');
                onClose();
            } finally {
                setLoading(false);
            }
        }
        loadProfile();
    }, [profileId]);

    const handleFeedbackAction = async (status: 'liked' | 'disliked' | 'pending') => {
        if (!itemId) return;
        try {
            setActionLoading(true);
            if (status === 'liked') {
                // 1. Consume VIP Outreach Credit atomically
                const { data: creditSuccess, error: creditErr } = await supabase.rpc('consume_vip_outreach_credit');
                if (creditErr || !creditSuccess) {
                    Alert.alert(
                        'Outreach Limit Reached',
                        'You do not have enough VIP Outreach credits remaining. Please contact your Relationship Manager to top up your credits.'
                    );
                    return;
                }

                // 2. Submit Interest Request
                const { data: requestData, error: requestErr } = await supabase.functions.invoke('submit-interest-request', {
                    body: {
                        candidateProfileId: profileId,
                        selectedReasonId: 'custom',
                        personalizedReason: matchRationale || 'Pitched by your Relationship Manager.',
                    }
                });

                if (requestErr || !requestData) {
                    console.error('Failed to submit interest request:', requestErr);
                    Alert.alert('Error', 'Unable to initiate outreach request. Please try again.');
                    return;
                }

                const { data: { user } } = await supabase.auth.getUser();
                if (!user) {
                    Alert.alert('Error', 'Session expired. Please log in again.');
                    return;
                }

                console.log('--- SUBMIT INTEREST RESPONSE ---', JSON.stringify(requestData));
                let requestId = requestData.requestId || requestData.id;

                if (!requestId) {
                    // Fallback: Query for existing interest request between Seeker and Candidate
                    const { data: existingReq } = await supabase
                        .from('interest_requests')
                        .select('id')
                        .eq('sender_id', user.id)
                        .eq('receiver_id', profileId)
                        .maybeSingle();
                    
                    if (existingReq?.id) {
                        requestId = existingReq.id;
                    }
                }

                if (!requestId) {
                    Alert.alert('Error', 'Could not locate matchmaking interest request.');
                    return;
                }

                // 3. Update Shortlist Item feedback status
                await updateShortlistFeedback(itemId, 'liked');
                setFeedbackStatus('liked');

                // 4. Update session status to 'OUTREACH_IN_PROGRESS'
                await supabase
                    .from('assisted_concierge_sessions')
                    .update({ status: 'OUTREACH_IN_PROGRESS', updated_at: new Date().toISOString() })
                    .eq('user_id', user.id);

                // 5. Trigger outbound Retell AI broker call
                const { error: callErr } = await supabase.functions.invoke('trigger-outbound-broker-call', {
                    body: {
                        requestId,
                        targetProfileId: profileId,
                        mode: 'manual',
                        channel: 'voice',
                        provider: 'retell',
                    }
                });

                if (callErr) {
                    console.error('Failed to trigger outbound broker call:', callErr);
                    Alert.alert('Outreach Error', 'Outreach call request failed to dispatch.');
                } else {
                    onClose();
                }
            } else {
                await updateShortlistFeedback(itemId, status === 'pending' ? 'pending' : status);
                setFeedbackStatus(status === 'pending' ? 'pending' : status);
            }
        } catch (error) {
            console.error('Failed to update feedback:', error);
            Alert.alert('Error', 'Unable to submit your feedback.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleSendChatMessage = async () => {
        if (!chatInputText.trim() || chatSending) return;

        const userMsgText = chatInputText.trim();
        const userMsg: ChatMessage = { role: 'user', content: userMsgText };
        
        setChatMessages(prev => [...prev, userMsg]);
        setChatInputText('');
        setChatSending(true);

        setTimeout(() => {
            chatScrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);

        try {
            const { data, error } = await supabase.functions.invoke('discuss-candidate-chat', {
                body: {
                    candidate_id: profileId,
                    messages: [...chatMessages, userMsg],
                },
            });

            if (error) throw error;

            if (data && data.reply) {
                setChatMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
            } else {
                throw new Error('Invalid chat completion response.');
            }
        } catch (err) {
            console.error('Failed to get compatibility chat response:', err);
            setChatMessages(prev => [
                ...prev,
                {
                    role: 'assistant',
                    content: "I'm sorry, I encountered an issue discussing compatibility. Let's try sending that question again.",
                },
            ]);
        } finally {
            setChatSending(false);
            setTimeout(() => {
                chatScrollViewRef.current?.scrollToEnd({ animated: true });
            }, 100);
        }
    };

    if (loading || !candidate) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#d4b373" />
                <Text style={styles.loadingText}>Verifying Concierge Match details...</Text>
            </SafeAreaView>
        );
    }

    const age = candidate.dob
        ? Math.floor((Date.now() - new Date(candidate.dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
        : 30;

    const photos = candidate.photo_urls && candidate.photo_urls.length > 0
        ? candidate.photo_urls
        : [];

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable onPress={onClose} style={styles.backBtn}>
                    <Text style={styles.backBtnText}>✕ Close</Text>
                </Pressable>
                <View style={styles.badgeContainer}>
                    <Text style={styles.badgeText}>★ CONCIERGE VERIFIED</Text>
                </View>
                <View style={{ width: 60 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Photo Gallery */}
                <View style={styles.photoContainer}>
                    {photos.length > 0 ? (
                        <>
                            <Image
                                source={{ uri: photos[currentPhotoIndex] }}
                                style={styles.heroImage}
                                resizeMode="cover"
                            />
                            {photos.length > 1 && (
                                <View style={styles.photoPagination}>
                                    {photos.map((_, index) => (
                                        <Pressable
                                            key={index}
                                            onPress={() => setCurrentPhotoIndex(index)}
                                            style={[
                                                styles.paginationDot,
                                                index === currentPhotoIndex && styles.paginationDotActive,
                                            ]}
                                        />
                                    ))}
                                </View>
                            )}
                        </>
                    ) : (
                        <View style={styles.photoPlaceholder}>
                            <Text style={styles.photoPlaceholderText}>
                                {candidate.full_name?.charAt(0) || 'M'}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Profile Header */}
                <View style={styles.profileMeta}>
                    <Text style={styles.candidateName}>
                        {candidate.full_name}, {age}
                    </Text>
                    <Text style={styles.candidateLoc}>📍 {candidate.location}</Text>
                </View>

                {/* RM Premium Curation Banner */}
                {matchRationale ? (
                    <View style={styles.curationCard}>
                        <View style={styles.curationHeader}>
                            <Text style={styles.curationEmoji}>💝</Text>
                            <Text style={styles.curationTitle}>RM Curation Pitch</Text>
                        </View>
                        <Text style={styles.curationText}>{matchRationale}</Text>
                    </View>
                ) : null}

                {/* Bio & Details Section */}
                <View style={styles.infoSection}>
                    <Text style={styles.sectionHeader}>About Me</Text>
                    <Text style={styles.bioText}>{candidate.bio || 'Not specified'}</Text>
                </View>

                {/* Structured Attributes Grid */}
                <View style={styles.infoSection}>
                    <Text style={styles.sectionHeader}>Lifestyle & Background</Text>
                    <View style={styles.attributesGrid}>
                        <View style={styles.gridItem}>
                            <Text style={styles.gridLabel}>Profession</Text>
                            <Text style={styles.gridValue} numberOfLines={1}>{candidate.occupation || 'Not specified'}</Text>
                        </View>
                        <View style={styles.gridItem}>
                            <Text style={styles.gridLabel}>Education</Text>
                            <Text style={styles.gridValue} numberOfLines={1}>{candidate.education || 'Not specified'}</Text>
                        </View>
                        <View style={styles.gridItem}>
                            <Text style={styles.gridLabel}>Diet</Text>
                            <Text style={styles.gridValue}>{candidate.diet || 'Not specified'}</Text>
                        </View>
                        <View style={styles.gridItem}>
                            <Text style={styles.gridLabel}>Smoking</Text>
                            <Text style={styles.gridValue}>
                                {candidate.smokes !== null ? (candidate.smokes ? 'Yes' : 'No') : 'Not specified'}
                            </Text>
                        </View>
                        <View style={styles.gridItem}>
                            <Text style={styles.gridLabel}>Drinking</Text>
                            <Text style={styles.gridValue}>
                                {candidate.drinks_alcohol !== null ? (candidate.drinks_alcohol ? 'Yes' : 'No') : 'Not specified'}
                            </Text>
                        </View>
                        <View style={styles.gridItem}>
                            <Text style={styles.gridLabel}>Height</Text>
                            <Text style={styles.gridValue}>
                                {candidate.height_cm ? `${candidate.height_cm} cm` : 'Not specified'}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Partner Preferences Section */}
                <View style={styles.infoSection}>
                    <Text style={styles.sectionHeader}>Looking For</Text>
                    <Text style={styles.bioText}>{candidate.preferences || 'Not specified'}</Text>
                </View>

                {/* RM Chat Consultation CTA */}
                <Pressable onPress={() => setChatVisible(true)} style={styles.consultBtn}>
                    <Text style={styles.consultBtnText}>💬 Discuss candidate with your RM</Text>
                </Pressable>
            </ScrollView>

            {/* Bottom Actions */}
            <View style={styles.footerActions}>
                {feedbackStatus === 'pending' ? (
                    <>
                        <Pressable
                            disabled={actionLoading}
                            onPress={() => handleFeedbackAction('disliked')}
                            style={[styles.footerBtn, styles.passFooterBtn]}
                        >
                            <Text style={styles.passFooterBtnText}>✕ Pass</Text>
                        </Pressable>
                        <Pressable
                            disabled={actionLoading}
                            onPress={() => handleFeedbackAction('liked')}
                            style={[styles.footerBtn, styles.likeFooterBtn]}
                        >
                            <Text style={styles.likeFooterBtnText}>💖 Approve & Pitch</Text>
                        </Pressable>
                    </>
                ) : (
                    <View style={styles.feedbackBannerContainer}>
                        <Text style={styles.feedbackBannerText}>
                            {feedbackStatus === 'liked' ? 'Outreach Initiated 💖' : 'Curation Passed ✕'}
                        </Text>
                        <Pressable onPress={() => handleFeedbackAction('pending')} style={styles.undoBtn}>
                            <Text style={styles.undoText}>Undo Choice</Text>
                        </Pressable>
                    </View>
                )}
            </View>

            {/* AI RM Compatibility Chat Modal */}
            <Modal
                visible={chatVisible}
                animationType="slide"
                onRequestClose={() => setChatVisible(false)}
            >
                <SafeAreaView style={styles.chatContainer}>
                    {/* Chat Header */}
                    <View style={styles.chatHeader}>
                        <Pressable onPress={() => setChatVisible(false)} style={styles.chatCloseBtn}>
                            <Text style={styles.chatCloseBtnText}>✕ Back</Text>
                        </Pressable>
                        <View style={{ alignItems: 'center' }}>
                            <Text style={styles.chatTitle}>AI RM Consultant</Text>
                            <Text style={styles.chatSubtitle}>Discussing {candidate.full_name}</Text>
                        </View>
                        <View style={{ width: 60 }} />
                    </View>

                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                        style={{ flex: 1 }}
                    >
                        {/* Messages Thread */}
                        <ScrollView
                            ref={chatScrollViewRef}
                            style={styles.chatScroll}
                            contentContainerStyle={styles.chatScrollContent}
                        >
                            {chatMessages.map((msg, index) => (
                                <View
                                    key={index}
                                    style={[
                                        styles.chatBubbleContainer,
                                        msg.role === 'user' ? styles.userBubbleContainer : styles.rmBubbleContainer,
                                    ]}
                                >
                                    <View
                                        style={[
                                            styles.chatBubble,
                                            msg.role === 'user' ? styles.userBubble : styles.rmBubble,
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.chatBubbleText,
                                                msg.role === 'user' ? styles.userBubbleText : styles.rmBubbleText,
                                            ]}
                                        >
                                            {msg.content}
                                        </Text>
                                    </View>
                                </View>
                            ))}
                            {chatSending && (
                                <View style={[styles.chatBubbleContainer, styles.rmBubbleContainer]}>
                                    <View style={[styles.chatBubble, styles.rmBubble, styles.typingBubble]}>
                                        <ActivityIndicator size="small" color="#e5c184" />
                                    </View>
                                </View>
                            )}
                        </ScrollView>

                        {/* Input Bar */}
                        <View style={styles.chatInputBar}>
                            <TextInput
                                style={styles.chatInput}
                                value={chatInputText}
                                onChangeText={chatInputText => setChatInputText(chatInputText)}
                                placeholder={`Ask about ${candidate.full_name}...`}
                                placeholderTextColor="#767485"
                                onSubmitEditing={handleSendChatMessage}
                                editable={!chatSending}
                            />
                            <Pressable
                                onPress={handleSendChatMessage}
                                disabled={!chatInputText.trim() || chatSending}
                                style={({ pressed }) => [
                                    styles.chatSendBtn,
                                    (!chatInputText.trim() || chatSending) && styles.chatSendBtnDisabled,
                                    pressed && styles.chatSendBtnPressed,
                                ]}
                            >
                                <Text style={styles.chatSendBtnText}>→</Text>
                            </Pressable>
                        </View>
                    </KeyboardAvoidingView>
                </SafeAreaView>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    loadingContainer: {
        flex: 1,
        backgroundColor: '#0d0c0f',
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 16,
        color: '#d4b373',
        fontSize: 16,
        fontWeight: '600',
    },
    container: {
        flex: 1,
        backgroundColor: '#0d0c0f',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#1f1d24',
    },
    backBtn: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        backgroundColor: '#1c1b22',
        borderRadius: 8,
    },
    backBtnText: {
        color: '#a19fb0',
        fontSize: 13,
        fontWeight: '600',
    },
    badgeContainer: {
        backgroundColor: '#2a1f10',
        borderWidth: 1,
        borderColor: '#a1824a',
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 4,
    },
    badgeText: {
        color: '#e5c184',
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1,
    },
    scrollContent: {
        paddingBottom: 40,
    },
    photoContainer: {
        width: width,
        height: height * 0.45,
        backgroundColor: '#16151a',
        position: 'relative',
    },
    heroImage: {
        width: '100%',
        height: '100%',
    },
    photoPagination: {
        position: 'absolute',
        bottom: 16,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    paginationDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.4)',
        marginHorizontal: 4,
    },
    paginationDotActive: {
        backgroundColor: '#d4b373',
        width: 12,
    },
    photoPlaceholder: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#1c1b22',
    },
    photoPlaceholderText: {
        fontSize: 96,
        fontWeight: '700',
        color: '#3e3d4c',
    },
    profileMeta: {
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 10,
    },
    candidateName: {
        color: '#ffffff',
        fontSize: 28,
        fontWeight: '800',
    },
    candidateLoc: {
        color: '#a19fb0',
        fontSize: 15,
        marginTop: 6,
    },
    curationCard: {
        backgroundColor: '#1a1714',
        borderWidth: 1,
        borderColor: '#a1824a',
        borderRadius: 12,
        marginHorizontal: 20,
        marginVertical: 12,
        padding: 16,
    },
    curationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    curationEmoji: {
        fontSize: 18,
        marginRight: 6,
    },
    curationTitle: {
        color: '#e5c184',
        fontSize: 13,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    curationText: {
        color: '#dfdbdb',
        fontSize: 14,
        lineHeight: 20,
        fontStyle: 'italic',
    },
    infoSection: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#1c1b22',
    },
    sectionHeader: {
        color: '#e5c184',
        fontSize: 15,
        fontWeight: '700',
        marginBottom: 10,
        letterSpacing: 0.5,
    },
    bioText: {
        color: '#cfccd6',
        fontSize: 15,
        lineHeight: 22,
    },
    attributesGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
    },
    gridItem: {
        width: '48%',
        backgroundColor: '#16151a',
        borderWidth: 1,
        borderColor: '#26242e',
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
    },
    gridLabel: {
        color: '#767485',
        fontSize: 11,
        fontWeight: '600',
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    gridValue: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '600',
    },
    consultBtn: {
        marginHorizontal: 20,
        marginVertical: 20,
        borderWidth: 1,
        borderColor: '#d4b373',
        paddingVertical: 14,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#2a1f10',
    },
    consultBtnText: {
        color: '#e5c184',
        fontWeight: '700',
        fontSize: 14,
    },
    footerActions: {
        padding: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderTopWidth: 1,
        borderTopColor: '#1c1b22',
        backgroundColor: '#0d0c0f',
    },
    footerBtn: {
        flex: 1,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    passFooterBtn: {
        backgroundColor: '#1c1b22',
        marginRight: 12,
    },
    passFooterBtnText: {
        color: '#a19fb0',
        fontSize: 15,
        fontWeight: '700',
    },
    likeFooterBtn: {
        backgroundColor: '#d4b373',
    },
    likeFooterBtnText: {
        color: '#0d0c0f',
        fontSize: 15,
        fontWeight: '700',
    },
    feedbackBannerContainer: {
        flex: 1,
        height: 48,
        backgroundColor: '#1b2a1a',
        borderWidth: 1,
        borderColor: '#274b25',
        borderRadius: 24,
        paddingHorizontal: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    feedbackBannerText: {
        color: '#76d671',
        fontSize: 14,
        fontWeight: '700',
    },
    undoBtn: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        backgroundColor: '#263d25',
        borderRadius: 14,
    },
    undoText: {
        color: '#76d671',
        fontSize: 12,
        fontWeight: '700',
    },
    // Compatibility Chat Styles
    chatContainer: {
        flex: 1,
        backgroundColor: '#0d0c0f',
    },
    chatHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#1f1d24',
    },
    chatCloseBtn: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        backgroundColor: '#1c1b22',
        borderRadius: 8,
    },
    chatCloseBtnText: {
        color: '#a19fb0',
        fontSize: 13,
        fontWeight: '600',
    },
    chatTitle: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '800',
    },
    chatSubtitle: {
        color: '#d4b373',
        fontSize: 11,
        fontWeight: '600',
        marginTop: 2,
    },
    chatScroll: {
        flex: 1,
        backgroundColor: '#09080b',
        paddingHorizontal: 16,
    },
    chatScrollContent: {
        paddingVertical: 20,
    },
    chatBubbleContainer: {
        width: '100%',
        marginVertical: 6,
        flexDirection: 'row',
    },
    userBubbleContainer: {
        justifyContent: 'flex-end',
    },
    rmBubbleContainer: {
        justifyContent: 'flex-start',
    },
    chatBubble: {
        maxWidth: '80%',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    userBubble: {
        backgroundColor: '#11313c',
        borderBottomRightRadius: 4,
        borderWidth: 1,
        borderColor: '#1d4857',
    },
    rmBubble: {
        backgroundColor: '#1c1813',
        borderBottomLeftRadius: 4,
        borderWidth: 1,
        borderColor: '#5c4d32',
    },
    typingBubble: {
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 8,
        width: 60,
    },
    chatBubbleText: {
        fontSize: 14,
        lineHeight: 20,
    },
    userBubbleText: {
        color: '#ffffff',
    },
    rmBubbleText: {
        color: '#e5c184',
    },
    chatInputBar: {
        flexDirection: 'row',
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: '#1f1d24',
        backgroundColor: '#0d0c0f',
        alignItems: 'center',
    },
    chatInput: {
        flex: 1,
        height: 44,
        backgroundColor: '#1c1b22',
        borderWidth: 1,
        borderColor: '#26242e',
        borderRadius: 22,
        paddingHorizontal: 16,
        color: '#ffffff',
        fontSize: 14,
    },
    chatSendBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#d4b373',
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 12,
    },
    chatSendBtnDisabled: {
        backgroundColor: '#1c1b22',
        opacity: 0.5,
    },
    chatSendBtnPressed: {
        opacity: 0.8,
    },
    chatSendBtnText: {
        color: '#0d0c0f',
        fontSize: 20,
        fontWeight: '700',
    },
});
