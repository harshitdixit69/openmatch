// src/components/VerificationPromptModal.tsx
//
// Shown right after a user sends their first interest request — the moment they
// most want to be believed by the person receiving it.
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
    visible: boolean;
    /** True when a previous attempt was rejected, which changes the framing. */
    previouslyRejected?: boolean;
    onVerify: () => void;
    onDismiss: () => void;
};

export function VerificationPromptModal({
    visible,
    previouslyRejected = false,
    onVerify,
    onDismiss,
}: Props) {
    const title = previouslyRejected ? 'Try verifying again' : 'Get accepted more often';

    const body = previouslyRejected
        ? 'Your last verification could not be confirmed — usually a blurry document or poor lighting. A clearer photo normally passes on the second try.'
        : 'Your request is on its way. Profiles with a verified badge get accepted more often, because the other person knows you are real.';

    return (
        <Modal transparent animationType="fade" visible={visible} onRequestClose={onDismiss}>
            <View style={styles.backdrop}>
                <View style={styles.card}>
                    <Text style={styles.badge}>✅</Text>
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.body}>{body}</Text>

                    <View style={styles.reassuranceBox}>
                        <Text style={styles.reassuranceText}>
                            Takes about a minute. Your ID is used only to confirm your identity and is never shown on your profile.
                        </Text>
                    </View>

                    <Pressable
                        style={({ pressed }) => [styles.primaryButton, pressed ? styles.pressed : null]}
                        onPress={onVerify}
                        accessibilityRole="button"
                        accessibilityLabel="Verify my identity now"
                    >
                        <Text style={styles.primaryButtonText}>Verify my identity</Text>
                    </Pressable>

                    <Pressable
                        style={({ pressed }) => [styles.secondaryButton, pressed ? styles.pressed : null]}
                        onPress={onDismiss}
                        accessibilityRole="button"
                        accessibilityLabel="Not now"
                    >
                        <Text style={styles.secondaryButtonText}>Not now</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        flex: 1,
        justifyContent: 'center',
        padding: 24,
    },
    card: {
        backgroundColor: '#141318',
        borderRadius: 24,
        gap: 10,
        maxWidth: 380,
        padding: 24,
        width: '100%',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
    },
    badge: { fontSize: 34 },
    title: { color: '#d4a853', fontSize: 22, fontWeight: '800' },
    body: { color: '#f0ece4', fontSize: 15, lineHeight: 22 },
    reassuranceBox: {
        backgroundColor: '#1e1d26',
        borderRadius: 14,
        marginTop: 4,
        padding: 12,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.06)',
    },
    reassuranceText: { color: '#8e8a9e', fontSize: 13, lineHeight: 19 },
    primaryButton: {
        alignItems: 'center',
        backgroundColor: '#d4a853',
        borderRadius: 16,
        marginTop: 6,
        paddingVertical: 14,
    },
    primaryButtonText: { color: '#0a0a0c', fontSize: 15, fontWeight: '800' },
    secondaryButton: { alignItems: 'center', paddingVertical: 10 },
    secondaryButtonText: { color: '#8e8a9e', fontSize: 14, fontWeight: '700' },
    pressed: { opacity: 0.85 },
});
