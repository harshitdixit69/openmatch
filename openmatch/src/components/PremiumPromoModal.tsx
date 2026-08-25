import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PremiumPromoVariant } from '../lib/premiumTargeting';

type PremiumPromoModalProps = {
    visible: boolean;
    variant: PremiumPromoVariant;
    onCta: () => void;
    onClose: () => void;
};

/**
 * A rare, milestone-triggered premium promo shown as a dismissible modal.
 * Reuses the behavior-targeted variant copy and keeps a fixed non-coercive
 * reassurance line. Dismissible via the close button, the "Not now" button, or
 * by tapping the backdrop.
 */
export function PremiumPromoModal({ visible, variant, onCta, onClose }: PremiumPromoModalProps) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <Pressable
                    style={styles.scrim}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss premium offer"
                />

                <View style={styles.sheet}>
                    <View style={styles.headerRow}>
                        <Text style={styles.eyebrow}>{variant.eyebrow}</Text>
                        <Pressable
                            style={styles.closeButton}
                            onPress={onClose}
                            accessibilityRole="button"
                            accessibilityLabel="Close"
                        >
                            <Text style={styles.closeButtonText}>✕</Text>
                        </Pressable>
                    </View>

                    <Text style={styles.title}>{variant.title}</Text>
                    <Text style={styles.body}>{variant.body}</Text>

                    <View style={styles.actionsRow}>
                        <Pressable style={styles.primaryButton} onPress={onCta} accessibilityRole="button">
                            <Text style={styles.primaryButtonText}>{variant.ctaLabel}</Text>
                        </Pressable>
                        <Pressable style={styles.secondaryButton} onPress={onClose} accessibilityRole="button">
                            <Text style={styles.secondaryButtonText}>Not now</Text>
                        </Pressable>
                    </View>

                    <Text style={styles.footnote}>Free matching and escrow chat always stay open.</Text>
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
        paddingHorizontal: 20,
    },
    scrim: {
        bottom: 0,
        left: 0,
        position: 'absolute',
        right: 0,
        top: 0,
    },
    sheet: {
        backgroundColor: '#141318',
        borderRadius: 20,
        gap: 10,
        maxWidth: 420,
        padding: 20,
        width: '100%',
        borderWidth: 1,
        borderColor: 'rgba(212, 168, 83, 0.3)',
    },
    headerRow: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    eyebrow: {
        color: '#d4a853',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    closeButton: {
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        borderRadius: 999,
        height: 28,
        justifyContent: 'center',
        width: 28,
    },
    closeButtonText: {
        color: '#8e8a9e',
        fontSize: 13,
        fontWeight: '800',
    },
    title: {
        color: '#f0ece4',
        fontSize: 20,
        fontWeight: '800',
    },
    body: {
        color: '#8e8a9e',
        fontSize: 14,
        lineHeight: 21,
    },
    actionsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 4,
    },
    primaryButton: {
        alignItems: 'center',
        backgroundColor: '#d4a853',
        borderRadius: 999,
        paddingHorizontal: 18,
        paddingVertical: 12,
    },
    primaryButtonText: {
        color: '#0a0a0c',
        fontSize: 14,
        fontWeight: '800',
    },
    secondaryButton: {
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        borderRadius: 999,
        paddingHorizontal: 18,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
    },
    secondaryButtonText: {
        color: '#8e8a9e',
        fontSize: 14,
        fontWeight: '800',
    },
    footnote: {
        color: '#5a5770',
        fontSize: 12,
        fontWeight: '600',
        marginTop: 2,
    },
});
