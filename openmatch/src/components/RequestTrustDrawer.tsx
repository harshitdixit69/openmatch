import {
    ActivityIndicator,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import { ProfileReliabilitySummary } from '../lib/intentEscrow';

type RequestTrustDrawerProps = {
    visible: boolean;
    loading: boolean;
    summary: ProfileReliabilitySummary | null;
    subjectName: string;
    onClose: () => void;
};

export function RequestTrustDrawer({
    visible,
    loading,
    summary,
    subjectName,
    onClose,
}: RequestTrustDrawerProps) {
    return (
        <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <Pressable style={styles.scrim} onPress={onClose} />

                <View style={styles.sheet}>
                    <View style={styles.handle} />

                    <View style={styles.headerRow}>
                        <View style={styles.headerCopy}>
                            <Text style={styles.eyebrow}>Trust summary</Text>
                            <Text style={styles.title}>{subjectName}</Text>
                            <Text style={styles.subtitle}>
                                Response history, ghost-risk signals, and request pacing for this profile.
                            </Text>
                        </View>

                        <Pressable style={styles.closeButton} onPress={onClose}>
                            <Text style={styles.closeButtonText}>Close</Text>
                        </Pressable>
                    </View>

                    {loading ? (
                        <View style={styles.loadingState}>
                            <ActivityIndicator size="small" color="#d4a853" />
                            <Text style={styles.loadingText}>Loading trust summary...</Text>
                        </View>
                    ) : summary ? (
                        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                            <View style={styles.statGrid}>
                                <StatCard label="Reliability" value={`${summary.responseReliabilityScore}/100`} tone="primary" />
                                <StatCard label="Ghost risk" value={`${summary.ghostRiskScore}/100`} tone="accent" />
                                <StatCard label="Open requests" value={`${summary.activeRequestCount}/${summary.activeRequestLimit}`} tone="neutral" />
                                <StatCard label="Managed by" value={formatManagedBy(summary.managedBy)} tone="neutral" />
                            </View>

                            <View style={styles.sectionCard}>
                                <Text style={styles.sectionTitle}>Reply behavior</Text>
                                <Text style={styles.sectionBody}>{formatMedianReplyCopy(summary.medianFirstReplyMinutes)}</Text>
                            </View>

                            <View style={styles.sectionCard}>
                                <Text style={styles.sectionTitle}>Signals</Text>
                                <View style={styles.badgeRow}>
                                    {summary.badges.map((badge) => (
                                        <View key={`${summary.managedBy ?? 'unknown'}-${badge}`} style={styles.badgePill}>
                                            <Text style={styles.badgeText}>{badge}</Text>
                                        </View>
                                    ))}
                                </View>
                            </View>
                        </ScrollView>
                    ) : (
                        <View style={styles.loadingState}>
                            <Text style={styles.loadingText}>No trust summary is available yet.</Text>
                        </View>
                    )}
                </View>
            </View>
        </Modal>
    );
}

function StatCard({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone: 'primary' | 'accent' | 'neutral';
}) {
    return (
        <View
            style={[
                styles.statCard,
                tone === 'primary' ? styles.statCardPrimary : tone === 'accent' ? styles.statCardAccent : styles.statCardNeutral,
            ]}
        >
            <Text
                style={[
                    styles.statValue,
                    tone === 'primary' ? styles.statValuePrimary : tone === 'accent' ? styles.statValueAccent : styles.statValueNeutral,
                ]}
            >
                {value}
            </Text>
            <Text
                style={[
                    styles.statLabel,
                    tone === 'primary' ? styles.statLabelPrimary : tone === 'accent' ? styles.statLabelAccent : styles.statLabelNeutral,
                ]}
            >
                {label}
            </Text>
        </View>
    );
}

function formatManagedBy(value: ProfileReliabilitySummary['managedBy']) {
    if (!value || value === 'self') {
        return 'Self';
    }

    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatMedianReplyCopy(value: number | null) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 'Not enough accepted-request history is available yet, so this trust view is using broader reliability and ghost-risk signals.';
    }

    if (value < 60) {
        return `Median first reply is about ${value} minutes after acceptance.`;
    }

    const hours = Math.round((value / 60) * 10) / 10;
    return `Median first reply is about ${hours} hours after acceptance.`;
}

const styles = StyleSheet.create({
    backdrop: {
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        flex: 1,
        justifyContent: 'flex-end',
    },
    scrim: {
        flex: 1,
    },
    sheet: {
        backgroundColor: '#141318',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderTopWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
        gap: 16,
        maxHeight: '82%',
        paddingBottom: 28,
        paddingHorizontal: 20,
        paddingTop: 14,
    },
    handle: {
        alignSelf: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        borderRadius: 999,
        height: 5,
        width: 54,
    },
    headerRow: {
        alignItems: 'flex-start',
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'space-between',
    },
    headerCopy: {
        flex: 1,
        gap: 4,
    },
    eyebrow: {
        color: '#d4a853',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.8,
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
        lineHeight: 21,
    },
    closeButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
    },
    closeButtonText: {
        color: '#8e8a9e',
        fontSize: 12,
        fontWeight: '800',
    },
    loadingState: {
        alignItems: 'center',
        gap: 12,
        justifyContent: 'center',
        paddingVertical: 32,
    },
    loadingText: {
        color: '#8e8a9e',
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
    },
    scrollContent: {
        gap: 14,
        paddingBottom: 12,
    },
    statGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    statCard: {
        borderRadius: 16,
        gap: 4,
        minWidth: '47%',
        paddingHorizontal: 14,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
    },
    statCardPrimary: {
        backgroundColor: '#1e1d26',
    },
    statCardAccent: {
        backgroundColor: 'rgba(212, 168, 83, 0.12)',
        borderColor: 'rgba(212, 168, 83, 0.3)',
    },
    statCardNeutral: {
        backgroundColor: '#1e1d26',
    },
    statValue: {
        fontSize: 18,
        fontWeight: '800',
    },
    statValuePrimary: {
        color: '#d4a853',
    },
    statValueAccent: {
        color: '#d4a853',
    },
    statValueNeutral: {
        color: '#f0ece4',
    },
    statLabel: {
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    statLabelPrimary: {
        color: '#8e8a9e',
    },
    statLabelAccent: {
        color: '#d4a853',
    },
    statLabelNeutral: {
        color: '#8e8a9e',
    },
    sectionCard: {
        backgroundColor: '#1e1d26',
        borderColor: 'rgba(255, 255, 255, 0.08)',
        borderRadius: 16,
        borderWidth: 1,
        gap: 10,
        padding: 16,
    },
    sectionTitle: {
        color: '#f0ece4',
        fontSize: 16,
        fontWeight: '800',
    },
    sectionBody: {
        color: '#8e8a9e',
        fontSize: 14,
        lineHeight: 21,
    },
    badgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    badgePill: {
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
    },
    badgeText: {
        color: '#d4a853',
        fontSize: 12,
        fontWeight: '700',
    },
});