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

                setReasonsResult(nextReasonsResult);
                const firstReason = nextReasonsResult.reasons[0];
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
            const message = error instanceof Error ? error.message : 'Could not send this request.';
            Alert.alert('Send failed', message);
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
                                Start with a profile-specific reason instead of a generic request. This message will appear in chat if sent.
                            </Text>
                        </View>
                    </View>

                    {loadingReasons ? (
                        <View style={styles.loadingState}>
                            <ActivityIndicator size="large" color="#123340" />
                            <Text style={styles.loadingText}>Generating request reasons...</Text>
                        </View>
                    ) : reasonsResult ? (
                        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                            <View style={styles.scoreRow}>
                                <StatPill label={`Quality ${reasonsResult.requestQualityScore}/100`} tone="primary" />
                                <StatPill label={`Ghost risk ${reasonsResult.ghostRiskScore}/100`} tone="neutral" />
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
                                <Text style={styles.sectionTitle}>Suggested reasons</Text>
                                {reasonsResult.reasons.map((reason) => {
                                    const selected = reason.id === selectedReasonId;

                                    return (
                                        <Pressable
                                            key={reason.id}
                                            style={[styles.reasonCard, selected ? styles.reasonCardSelected : null]}
                                            onPress={() => handleSelectReason(reason.id)}
                                        >
                                            <View style={styles.reasonHeaderRow}>
                                                <Text style={styles.reasonScore}>{reason.score}</Text>
                                                <Text style={styles.reasonCopy}>{reason.text}</Text>
                                            </View>

                                            {reason.tags.length > 0 ? (
                                                <View style={styles.tagRow}>
                                                    {reason.tags.map((tag) => (
                                                        <View key={`${reason.id}-${tag}`} style={styles.tagPill}>
                                                            <Text style={styles.tagText}>{tag}</Text>
                                                        </View>
                                                    ))}
                                                </View>
                                            ) : null}
                                        </Pressable>
                                    );
                                })}
                            </View>

                            <View style={styles.sectionCard}>
                                <Text style={styles.sectionTitle}>Message that will be sent</Text>
                                <TextInput
                                    multiline
                                    style={styles.messageInput}
                                    placeholder="Write a short personalized reason"
                                    placeholderTextColor="#7a8f96"
                                    value={draftMessage}
                                    onChangeText={setDraftMessage}
                                    textAlignVertical="top"
                                    maxLength={280}
                                />

                                <Text style={styles.helperText}>
                                    {selectedReason ? 'You can edit the selected suggestion before sending.' : 'Pick a reason above, then edit it if needed.'}
                                </Text>
                            </View>
                        </ScrollView>
                    ) : (
                        <View style={styles.loadingState}>
                            <Text style={styles.loadingText}>No request suggestions are available yet.</Text>
                        </View>
                    )}

                    <View style={styles.footerRow}>
                        <Pressable style={styles.cancelButton} onPress={onClose} disabled={submitPending}>
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                        </Pressable>

                        <Pressable
                            style={[styles.submitButton, submitDisabled ? styles.submitButtonDisabled : null]}
                            onPress={() => void handleSubmit()}
                            disabled={submitDisabled}
                        >
                            <Text style={styles.submitButtonText}>{submitPending ? 'Sending...' : 'Send request'}</Text>
                        </Pressable>
                    </View>

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

function StatPill({ label, tone }: { label: string; tone: 'primary' | 'neutral' | 'accent' | 'warning' }) {
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
        backgroundColor: '#f4efe5',
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
        color: '#8a6b39',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    title: {
        color: '#123340',
        fontSize: 24,
        fontWeight: '800',
    },
    subtitle: {
        color: '#4d6268',
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
        color: '#4d6268',
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
        backgroundColor: '#123340',
    },
    statPillNeutral: {
        backgroundColor: '#dbe6e8',
    },
    statPillAccent: {
        backgroundColor: '#f4dcc1',
    },
    statPillWarning: {
        backgroundColor: '#f7d7ca',
    },
    statPillText: {
        fontSize: 13,
        fontWeight: '700',
    },
    statPillTextPrimary: {
        color: '#ffffff',
    },
    statPillTextNeutral: {
        color: '#31515b',
    },
    statPillTextAccent: {
        color: '#7a5622',
    },
    statPillTextWarning: {
        color: '#8e3b22',
    },
    noticeCard: {
        borderRadius: 20,
        backgroundColor: '#fff7f0',
        borderWidth: 1,
        borderColor: '#edd3b2',
        padding: 16,
        gap: 6,
    },
    noticeTitle: {
        color: '#123340',
        fontSize: 15,
        fontWeight: '800',
    },
    noticeBody: {
        color: '#5b696d',
        fontSize: 14,
        lineHeight: 20,
    },
    voiceIntroActionsRow: {
        gap: 10,
        marginTop: 2,
    },
    voiceIntroButton: {
        alignSelf: 'flex-start',
        backgroundColor: '#123340',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 9,
    },
    voiceIntroButtonText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '800',
    },
    voiceIntroStatusText: {
        color: '#31515b',
        fontSize: 13,
        fontWeight: '700',
    },
    sectionCard: {
        borderRadius: 24,
        backgroundColor: '#ffffff',
        padding: 18,
        gap: 14,
    },
    sectionTitle: {
        color: '#123340',
        fontSize: 17,
        fontWeight: '800',
    },
    reasonCard: {
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#dbe4e6',
        backgroundColor: '#f9fbfb',
        padding: 14,
        gap: 10,
    },
    reasonCardSelected: {
        borderColor: '#123340',
        backgroundColor: '#eef4f5',
    },
    reasonHeaderRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    reasonScore: {
        minWidth: 36,
        color: '#8a6b39',
        fontSize: 16,
        fontWeight: '800',
    },
    reasonCopy: {
        flex: 1,
        color: '#23434d',
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
        backgroundColor: '#e8eeef',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    tagText: {
        color: '#4b646b',
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'capitalize',
    },
    messageInput: {
        minHeight: 130,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#d6e0e2',
        backgroundColor: '#fbfdfd',
        color: '#123340',
        fontSize: 15,
        lineHeight: 22,
        paddingHorizontal: 14,
        paddingVertical: 14,
    },
    helperText: {
        color: '#66797f',
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
        backgroundColor: '#e1e8ea',
        paddingVertical: 15,
    },
    cancelButtonText: {
        color: '#35545d',
        fontSize: 15,
        fontWeight: '700',
    },
    submitButton: {
        flex: 1.4,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 18,
        backgroundColor: '#123340',
        paddingVertical: 15,
    },
    submitButtonDisabled: {
        backgroundColor: '#90a4ab',
    },
    submitButtonText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '800',
    },
});