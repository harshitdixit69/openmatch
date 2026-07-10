import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
    AudioModule,
    RecordingPresets,
    setAudioModeAsync,
    useAudioRecorder,
    useAudioRecorderState,
} from 'expo-audio';
import { SafeAreaView } from 'react-native-safe-area-context';

import { reviewRequestVoiceIntro } from '../lib/intentEscrowApi';
import { uploadCurrentUserVoiceIntro, VoiceIntroClip } from '../lib/voiceIntroApi';

export type ApprovedVoiceIntro = {
    mediaUrl: string;
    transcript: string | null;
    qualityAdjustment: number;
    durationSeconds: number;
};

type VoiceIntroRecorderProps = {
    visible: boolean;
    candidateName: string;
    onClose: () => void;
    onApproved: (value: ApprovedVoiceIntro) => void;
};

export function VoiceIntroRecorder({
    visible,
    candidateName,
    onClose,
    onApproved,
}: VoiceIntroRecorderProps) {
    const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
    const recorderState = useAudioRecorderState(audioRecorder, 500);
    const [recordedClip, setRecordedClip] = useState<VoiceIntroClip | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const isRecording = recorderState.isRecording;
    const recordingSeconds = Math.max(0, Math.round((recorderState.durationMillis ?? 0) / 1000));

    useEffect(() => {
        if (!visible) {
            setRecordedClip(null);
        }
    }, [visible]);

    useEffect(() => {
        return () => {
            if (audioRecorder.isRecording) {
                void audioRecorder.stop().catch(() => null);
            }
        };
    }, [audioRecorder]);

    const canSubmit = Boolean(recordedClip && !submitting);

    const recordingHint = useMemo(() => {
        if (isRecording) {
            return `Recording... ${formatSeconds(recordingSeconds)}`;
        }

        if (recordedClip) {
            return `Recorded ${formatSeconds(recordedClip.durationSeconds)}. Submit for review.`;
        }

        return 'Record a 15-30 second voice intro explaining why you are reaching out.';
    }, [recordedClip, isRecording, recordingSeconds]);

    async function handleStartRecording() {
        try {
            const permission = await AudioModule.requestRecordingPermissionsAsync();
            if (!permission.granted) {
                Alert.alert('Microphone needed', 'Please allow microphone access to record a voice intro.');
                return;
            }

            await setAudioModeAsync({
                allowsRecording: true,
                playsInSilentMode: true,
            });

            await audioRecorder.prepareToRecordAsync();
            audioRecorder.record();

            setRecordedClip(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not start recording.';
            Alert.alert('Recording failed', message);
        }
    }

    async function handleStopRecording() {
        if (!audioRecorder.isRecording) {
            return;
        }

        try {
            const durationSeconds = recordingSeconds;
            await audioRecorder.stop();
            const uri = audioRecorder.uri;
            await setAudioModeAsync({
                allowsRecording: false,
            });

            if (!uri) {
                throw new Error('Recording file was not created.');
            }

            setRecordedClip({
                uri,
                durationSeconds,
                mimeType: 'audio/m4a',
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not finish recording.';
            Alert.alert('Recording failed', message);
        }
    }

    async function handleSubmitVoiceIntro() {
        if (!recordedClip || submitting) {
            return;
        }

        setSubmitting(true);

        try {
            const mediaUrl = await uploadCurrentUserVoiceIntro(recordedClip);
            const reviewed = await reviewRequestVoiceIntro({
                requestId: null,
                mediaUrl,
                durationSeconds: recordedClip.durationSeconds,
            });

            if (!reviewed.approved) {
                throw new Error(reviewed.rejectionReason ?? 'Voice intro was not approved.');
            }

            onApproved({
                mediaUrl,
                transcript: reviewed.transcript,
                qualityAdjustment: reviewed.qualityAdjustment,
                durationSeconds: recordedClip.durationSeconds,
            });
            onClose();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not submit this voice intro.';
            Alert.alert('Voice intro failed', message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={onClose}>
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.container}>
                    <View style={styles.headerRow}>
                        <View style={styles.headerCopy}>
                            <Text style={styles.eyebrow}>Voice intro</Text>
                            <Text style={styles.title}>Show intent for {candidateName}</Text>
                            <Text style={styles.subtitle}>{recordingHint}</Text>
                        </View>
                    </View>

                    <View style={styles.card}>
                        <Text style={styles.cardLabel}>Expected length</Text>
                        <Text style={styles.cardValue}>15-30 seconds</Text>

                        {isRecording ? (
                            <Text style={styles.recordingText}>Live: {formatSeconds(recordingSeconds)}</Text>
                        ) : null}

                        <View style={styles.actionsRow}>
                            {isRecording ? (
                                <Pressable style={styles.stopButton} onPress={() => void handleStopRecording()}>
                                    <Text style={styles.stopButtonText}>Stop recording</Text>
                                </Pressable>
                            ) : (
                                <Pressable style={styles.recordButton} onPress={() => void handleStartRecording()} disabled={submitting}>
                                    <Text style={styles.recordButtonText}>{recordedClip ? 'Re-record' : 'Start recording'}</Text>
                                </Pressable>
                            )}
                        </View>
                    </View>

                    <View style={styles.footerRow}>
                        <Pressable style={styles.cancelButton} onPress={onClose} disabled={submitting || isRecording}>
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                        </Pressable>

                        <Pressable
                            style={[styles.submitButton, !canSubmit ? styles.submitButtonDisabled : null]}
                            onPress={() => void handleSubmitVoiceIntro()}
                            disabled={!canSubmit}
                        >
                            {submitting ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.submitButtonText}>Submit intro</Text>}
                        </Pressable>
                    </View>
                </View>
            </SafeAreaView>
        </Modal>
    );
}

function formatSeconds(value: number) {
    const total = Math.max(0, Math.round(value));
    const minutes = Math.floor(total / 60)
        .toString()
        .padStart(2, '0');
    const seconds = (total % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

const styles = StyleSheet.create({
    safeArea: {
        backgroundColor: '#f4efe5',
        flex: 1,
    },
    container: {
        flex: 1,
        gap: 16,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 20,
    },
    headerRow: {
        gap: 8,
    },
    headerCopy: {
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
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 22,
        gap: 12,
        padding: 18,
    },
    cardLabel: {
        color: '#63757b',
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    cardValue: {
        color: '#123340',
        fontSize: 20,
        fontWeight: '800',
    },
    recordingText: {
        color: '#8e3b22',
        fontSize: 14,
        fontWeight: '700',
    },
    actionsRow: {
        flexDirection: 'row',
        gap: 10,
    },
    recordButton: {
        alignItems: 'center',
        backgroundColor: '#123340',
        borderRadius: 14,
        justifyContent: 'center',
        minHeight: 46,
        paddingHorizontal: 16,
    },
    recordButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
    stopButton: {
        alignItems: 'center',
        backgroundColor: '#d36a46',
        borderRadius: 14,
        justifyContent: 'center',
        minHeight: 46,
        paddingHorizontal: 16,
    },
    stopButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
    footerRow: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 'auto',
    },
    cancelButton: {
        alignItems: 'center',
        backgroundColor: '#e1e8ea',
        borderRadius: 18,
        flex: 1,
        justifyContent: 'center',
        paddingVertical: 15,
    },
    cancelButtonText: {
        color: '#35545d',
        fontSize: 15,
        fontWeight: '700',
    },
    submitButton: {
        alignItems: 'center',
        backgroundColor: '#123340',
        borderRadius: 18,
        flex: 1.4,
        justifyContent: 'center',
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