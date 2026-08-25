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
        backgroundColor: 'rgba(15, 27, 31, 0.5)',
        flex: 1,
        justifyContent: 'center',
        padding: 24,
    },
    card: {
        backgroundColor: '#f6f8ff',
        borderRadius: 28,
        gap: 10,
        maxWidth: 380,
        padding: 24,
        width: '100%',
    },
    badge: { fontSize: 34 },
    title: { color: '#121732', fontSize: 22, fontWeight: '800' },
    body: { color: '#41585e', fontSize: 15, lineHeight: 22 },
    reassuranceBox: {
        backgroundColor: '#f6f8ff',
        borderRadius: 14,
        marginTop: 4,
        padding: 12,
    },
    reassuranceText: { color: '#5a6488', fontSize: 13, lineHeight: 19 },
    primaryButton: {
        alignItems: 'center',
        backgroundColor: '#ff6a3d',
        borderRadius: 16,
        marginTop: 6,
        paddingVertical: 14,
    },
    primaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
    secondaryButton: { alignItems: 'center', paddingVertical: 10 },
    secondaryButtonText: { color: '#6b7f84', fontSize: 14, fontWeight: '700' },
    pressed: { opacity: 0.85 },
});
