import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { VoiceIntroRecorder, ApprovedVoiceIntro } from './VoiceIntroRecorder';
import { MatchCandidate } from '../lib/matchmaking';
import { generateRequestReasons, submitInterestRequest } from '../lib/intentEscrowApi';
import { GenerateRequestReasonsResult } from '../lib/intentEscrow';
import { getDisplayFirstName, ProfileRecord } from '../lib/profile';
import { showFriendlyAlert } from '../lib/errorUtils';
import { filterSendableReasons } from '../lib/sendableMessage';
import { BackButton } from './BackButton';

type ConnectComposerSheetProps = {
    visible: boolean;
    candidate: MatchCandidate | null;
    viewerProfile: ProfileRecord | null;
    onClose: () => void;
    onSubmitted: (candidate: MatchCandidate) => void;
};

export function ConnectComposerSheet({
    visible,
    candidate,
    viewerProfile,
    onClose,
    onSubmitted,
}: ConnectComposerSheetProps) {
    const [reasonsResult, setReasonsResult] = useState<GenerateRequestReasonsResult | null>(null);
    const [selectedReasonId, setSelectedReasonId] = useState('');
    const [draftMessage, setDraftMessage] = useState('');
    const [loadingReasons, setLoadingReasons] = useState(false);
    const [submitPending, setSubmitPending] = useState(false);
    const [voiceIntroProof, setVoiceIntroProof] = useState<ApprovedVoiceIntro | null>(null);
    const [voiceRecorderVisible, setVoiceRecorderVisible] = useState(false);

    useEffect(() => {
        let cancelled = false;

        async function loadReasons(activeCandidate: MatchCandidate) {
            setLoadingReasons(true);
            setReasonsResult(null);
            setSelectedReasonId('');
            setDraftMessage('');
            setVoiceIntroProof(null);

            try {
                const nextReasonsResult = await generateRequestReasons(activeCandidate.id, {
                    candidate: activeCandidate,
                    viewerProfile,
                });

                if (cancelled) {
                    return;
                }

                // Never pre-fill the outgoing message with profile coaching,
                // even if the deployed function returns some.
                const safeReasons = filterSendableReasons(nextReasonsResult.reasons);
                setReasonsResult({ ...nextReasonsResult, reasons: safeReasons });
                const firstReason = safeReasons[0];
                if (firstReason) {
                    setSelectedReasonId(firstReason.id);
                    setDraftMessage(firstReason.text);
                }
            } catch (error) {
                if (cancelled) {
                    return;
                }

                const message = error instanceof Error ? error.message : 'Could not load request suggestions.';
                Alert.alert('Suggestions unavailable', message);
            } finally {
                if (!cancelled) {
                    setLoadingReasons(false);
                }
            }
        }

        if (visible && candidate) {
            void loadReasons(candidate);
            return () => {
                cancelled = true;
            };
        }

        setReasonsResult(null);
        setSelectedReasonId('');
        setDraftMessage('');
        setLoadingReasons(false);
        setVoiceIntroProof(null);
        setVoiceRecorderVisible(false);

        return () => {
            cancelled = true;
        };
    }, [candidate, viewerProfile, visible]);

    const selectedReason = useMemo(
        () => reasonsResult?.reasons.find((reason) => reason.id === selectedReasonId) ?? null,
        [reasonsResult, selectedReasonId],
    );

    const limitReached = Boolean(
        reasonsResult && reasonsResult.activeRequestCount >= reasonsResult.activeRequestLimit,
    );

    const requiresVoiceIntro = reasonsResult?.requiresVoiceIntro ?? false;
    const submitDisabled =
        submitPending ||
        loadingReasons ||
        !candidate ||
        !draftMessage.trim() ||
        !selectedReasonId ||
        limitReached ||
        (requiresVoiceIntro && !voiceIntroProof);

    async function handleSubmit() {
        const currentReasonsResult = reasonsResult;

        if (!candidate || !currentReasonsResult || submitDisabled) {
            return;
        }

        setSubmitPending(true);

        try {
            const result = await submitInterestRequest({
                candidateProfileId: candidate.id,
                selectedReasonId,
                personalizedReason: draftMessage.trim(),
                mediaType: voiceIntroProof ? 'voice' : 'none',
                mediaUrl: voiceIntroProof?.mediaUrl ?? null,
                voiceTranscript: voiceIntroProof?.transcript ?? null,
                requestQualityScore: clampNumber(currentReasonsResult.requestQualityScore + (voiceIntroProof?.qualityAdjustment ?? 0), 0, 100),
            });

            Alert.alert('Request sent', result.notice);
            onSubmitted(candidate);
            onClose();
        } catch (error) {
            showFriendlyAlert('Send Failed', error, 'Could not send this connection request. Please try again.');
        } finally {
            setSubmitPending(false);
        }
    }

    function handleSelectReason(reasonId: string) {
        if (!reasonsResult) {
            return;
        }

        const reason = reasonsResult.reasons.find((item) => item.id === reasonId);
        if (!reason) {
            return;
        }

        setSelectedReasonId(reason.id);
        setDraftMessage(reason.text);
    }

    return (
        <Modal animationType="slide" visible={visible} onRequestClose={onClose} presentationStyle="pageSheet">
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.container}>
                    <View style={styles.headerRow}>
                        <BackButton onPress={onClose} />

                        <View style={styles.headerCopy}>
                            <Text style={styles.eyebrow}>Show intent</Text>
                            <Text style={styles.title}>
                                {candidate ? `Connect with ${getDisplayFirstName(candidate.full_name) || candidate.full_name}` : 'Connect'}
                            </Text>
                            <Text style={styles.subtitle}>
                                {candidate
                                    ? `${getDisplayFirstName(candidate.full_name) || candidate.full_name} will see this as your first message, so make it personal.`
                                    : 'This will be seen as your first message, so make it personal.'}
                            </Text>
                        </View>
                    </View>

                    {loadingReasons ? (
                        <View style={styles.loadingState}>
                            <ActivityIndicator size="large" color="#d4a853" />
                            <Text style={styles.loadingText}>Generating request suggestions...</Text>
                        </View>
                    ) : reasonsResult ? (
                        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                            {/* Only the open-request count is shown. Request quality and
                                ghost risk are internal trust signals — telling someone
                                their request scores 30/100 right before they send it is
                                discouraging and exposes anti-abuse scoring. */}
                            <View style={styles.scoreRow}>
                                <StatPill
                                    label={`${reasonsResult.activeRequestCount}/${reasonsResult.activeRequestLimit} open`}
                                    tone={limitReached ? 'warning' : 'accent'}
                                />
                            </View>

                            {limitReached ? (
                                <View style={styles.noticeCard}>
                                    <Text style={styles.noticeTitle}>Outgoing request limit reached</Text>
                                    <Text style={styles.noticeBody}>
                                        Resolve or close an existing outgoing request before sending another one.
                                    </Text>
                                </View>
                            ) : null}

                            {requiresVoiceIntro ? (
                                <View style={styles.noticeCard}>
                                    <Text style={styles.noticeTitle}>Voice intro required</Text>
                                    <Text style={styles.noticeBody}>
                                        This sender state now needs a short voice intro before sending new requests.
                                    </Text>

                                    <View style={styles.voiceIntroActionsRow}>
                                        <Pressable style={styles.voiceIntroButton} onPress={() => setVoiceRecorderVisible(true)}>
                                            <Text style={styles.voiceIntroButtonText}>{voiceIntroProof ? 'Re-record voice intro' : 'Record voice intro'}</Text>
                                        </Pressable>

                                        {voiceIntroProof ? (
                                            <Text style={styles.voiceIntroStatusText}>
                                                Approved • {voiceIntroProof.durationSeconds}s • +{voiceIntroProof.qualityAdjustment} quality
                                            </Text>
                                        ) : null}
                                    </View>
                                </View>
                            ) : null}

                            <View style={styles.sectionCard}>
                                <Text style={styles.sectionTitle}>Why do you want to connect?</Text>
                                <Text style={styles.sectionHint}>
                                    Pick the reason that best describes what caught your attention.
                                </Text>

                                {reasonsResult.reasons.map((reason) => {
                                    const selected = reason.id === selectedReasonId;

                                    return (
                                        <Pressable
                                            key={reason.id}
                                            style={[styles.reasonCard, selected && styles.reasonCardSelected]}
                                            onPress={() => {
                                                setSelectedReasonId(reason.id);
                                                setDraftMessage(reason.text);
                                            }}
                                        >
                                            <View style={styles.reasonHeaderRow}>
                                                <Text style={styles.reasonScore}>✦</Text>
                                                <Text style={styles.reasonCopy}>{reason.text}</Text>
                                            </View>

                                            <View style={styles.tagRow}>
                                                {reason.tags.map((tag) => (
                                                    <View key={tag} style={styles.tagPill}>
                                                        <Text style={styles.tagText}>{tag}</Text>
                                                    </View>
                                                ))}
                                            </View>
                                        </Pressable>
                                    );
                                })}
                            </View>

                            <View style={styles.sectionCard}>
                                <Text style={styles.sectionTitle}>Personalise your note</Text>
                                <TextInput
                                    multiline
                                    style={styles.messageInput}
                                    value={draftMessage}
                                    onChangeText={setDraftMessage}
                                    placeholder="Add a polite personal note..."
                                    placeholderTextColor="#5a5770"
                                    textAlignVertical="top"
                                />
                                <Text style={styles.helperText}>
                                    Keep it friendly and respectful. Matches respond best to genuine shared interests.
                                </Text>
                            </View>

                            <View style={styles.footerRow}>
                                <Pressable style={styles.cancelButton} onPress={onClose} disabled={submitPending}>
                                    <Text style={styles.cancelButtonText}>Cancel</Text>
                                </Pressable>

                                <Pressable
                                    style={[styles.submitButton, submitDisabled && styles.submitButtonDisabled]}
                                    disabled={submitDisabled}
                                    onPress={handleSubmit}
                                >
                                    <Text style={styles.submitButtonText}>
                                        {submitPending ? 'Sending…' : 'Send Request'}
                                    </Text>
                                </Pressable>
                            </View>
                        </ScrollView>
                    ) : null}

                    <VoiceIntroRecorder
                        visible={voiceRecorderVisible}
                        candidateName={candidate ? getDisplayFirstName(candidate.full_name) || candidate.full_name : 'this match'}
                        onClose={() => setVoiceRecorderVisible(false)}
                        onApproved={(value) => {
                            setVoiceIntroProof(value);
                            setVoiceRecorderVisible(false);
                        }}
                    />
                </View>
            </SafeAreaView>
        </Modal>
    );
}

function clampNumber(value: number, minimum: number, maximum: number) {
    return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function StatPill({
    label,
    tone = 'neutral',
}: {
    label: string;
    tone?: 'primary' | 'neutral' | 'accent' | 'warning';
}) {
    return (
        <View
            style={[
                styles.statPill,
                tone === 'primary'
                    ? styles.statPillPrimary
                    : tone === 'accent'
                        ? styles.statPillAccent
                        : tone === 'warning'
                            ? styles.statPillWarning
                            : styles.statPillNeutral,
            ]}
        >
            <Text
                style={[
                    styles.statPillText,
                    tone === 'primary'
                        ? styles.statPillTextPrimary
                        : tone === 'accent'
                            ? styles.statPillTextAccent
                            : tone === 'warning'
                                ? styles.statPillTextWarning
                                : styles.statPillTextNeutral,
                ]}
            >
                {label}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#0a0a0c',
    },
    container: {
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 20,
        gap: 18,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 14,
    },
    headerCopy: {
        flex: 1,
        gap: 4,
    },
    eyebrow: {
        color: '#d4a853',
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    title: {
        color: '#f0ece4',
        fontSize: 24,
        fontWeight: '800',
    },
    subtitle: {
        color: '#8e8a9e',
        fontSize: 14,
        lineHeight: 20,
    },
    loadingState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingHorizontal: 24,
    },
    loadingText: {
        color: '#8e8a9e',
        fontSize: 15,
        textAlign: 'center',
    },
    scrollContent: {
        gap: 16,
        paddingBottom: 8,
    },
    scoreRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    statPill: {
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    statPillPrimary: {
        backgroundColor: '#d4a853',
    },
    statPillNeutral: {
        backgroundColor: '#1e1d26',
    },
    statPillAccent: {
        backgroundColor: 'rgba(212,168,83,0.15)',
    },
    statPillWarning: {
        backgroundColor: 'rgba(239,68,68,0.15)',
    },
    statPillText: {
        fontSize: 13,
        fontWeight: '700',
    },
    statPillTextPrimary: {
        color: '#0a0a0c',
        fontWeight: '800',
    },
    statPillTextNeutral: {
        color: '#8e8a9e',
    },
    statPillTextAccent: {
        color: '#d4a853',
    },
    statPillTextWarning: {
        color: '#ef4444',
    },
    noticeCard: {
        borderRadius: 20,
        backgroundColor: '#141318',
        borderWidth: 1,
        borderColor: 'rgba(212,168,83,0.3)',
        padding: 16,
        gap: 6,
    },
    noticeTitle: {
        color: '#d4a853',
        fontSize: 15,
        fontWeight: '800',
    },
    noticeBody: {
        color: '#8e8a9e',
        fontSize: 14,
        lineHeight: 20,
    },
    voiceIntroActionsRow: {
        gap: 10,
        marginTop: 2,
    },
    voiceIntroButton: {
        alignSelf: 'flex-start',
        backgroundColor: '#d4a853',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 9,
    },
    voiceIntroButtonText: {
        color: '#0a0a0c',
        fontSize: 12,
        fontWeight: '800',
    },
    voiceIntroStatusText: {
        color: '#d4a853',
        fontSize: 13,
        fontWeight: '700',
    },
    sectionCard: {
        borderRadius: 20,
        backgroundColor: '#141318',
        padding: 18,
        gap: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    sectionTitle: {
        color: '#f0ece4',
        fontSize: 17,
        fontWeight: '800',
    },
    sectionHint: {
        color: '#8e8a9e',
        fontSize: 13,
        lineHeight: 19,
        marginTop: -4,
    },
    reasonCard: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        backgroundColor: '#1e1d26',
        padding: 14,
        gap: 10,
    },
    reasonCardSelected: {
        borderColor: '#d4a853',
        backgroundColor: 'rgba(212,168,83,0.1)',
    },
    reasonHeaderRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    reasonScore: {
        minWidth: 24,
        color: '#d4a853',
        fontSize: 16,
        fontWeight: '800',
    },
    reasonCopy: {
        flex: 1,
        color: '#f0ece4',
        fontSize: 14,
        lineHeight: 20,
    },
    tagRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    tagPill: {
        borderRadius: 999,
        backgroundColor: 'rgba(255,255,255,0.06)',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    tagText: {
        color: '#8e8a9e',
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'capitalize',
    },
    messageInput: {
        minHeight: 130,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        backgroundColor: '#1e1d26',
        color: '#f0ece4',
        fontSize: 15,
        lineHeight: 22,
        paddingHorizontal: 14,
        paddingVertical: 14,
    },
    helperText: {
        color: '#5a5770',
        fontSize: 13,
        lineHeight: 18,
    },
    footerRow: {
        flexDirection: 'row',
        gap: 12,
    },
    cancelButton: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        paddingVertical: 15,
    },
    cancelButtonText: {
        color: '#8e8a9e',
        fontSize: 15,
        fontWeight: '700',
    },
    submitButton: {
        flex: 1.4,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 18,
        backgroundColor: '#d4a853',
        paddingVertical: 15,
    },
    submitButtonDisabled: {
        backgroundColor: 'rgba(212,168,83,0.3)',
    },
    submitButtonText: {
        color: '#0a0a0c',
        fontSize: 15,
        fontWeight: '800',
    },
});