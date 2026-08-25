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
                            <ActivityIndicator size="small" color="#121732" />
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
        backgroundColor: 'rgba(8, 24, 30, 0.46)',
        flex: 1,
        justifyContent: 'flex-end',
    },
    scrim: {
        flex: 1,
    },
    sheet: {
        backgroundColor: '#f6f8ff',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        gap: 16,
        maxHeight: '82%',
        paddingBottom: 28,
        paddingHorizontal: 20,
        paddingTop: 14,
    },
    handle: {
        alignSelf: 'center',
        backgroundColor: '#e2e7f5',
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
        color: '#c2643f',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    title: {
        color: '#121732',
        fontSize: 24,
        fontWeight: '800',
    },
    subtitle: {
        color: '#5a6488',
        fontSize: 14,
        lineHeight: 21,
    },
    closeButton: {
        backgroundColor: '#f6f8ff',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    closeButtonText: {
        color: '#232a45',
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
        color: '#5a6488',
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
        borderRadius: 18,
        gap: 4,
        minWidth: '47%',
        paddingHorizontal: 14,
        paddingVertical: 14,
    },
    statCardPrimary: {
        backgroundColor: '#121732',
    },
    statCardAccent: {
        backgroundColor: '#f3e3d1',
    },
    statCardNeutral: {
        backgroundColor: '#f6f8ff',
    },
    statValue: {
        fontSize: 18,
        fontWeight: '800',
    },
    statValuePrimary: {
        color: '#ffffff',
    },
    statValueAccent: {
        color: '#9a3b18',
    },
    statValueNeutral: {
        color: '#121732',
    },
    statLabel: {
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    statLabelPrimary: {
        color: '#d6e3e6',
    },
    statLabelAccent: {
        color: '#8b6a53',
    },
    statLabelNeutral: {
        color: '#5a6488',
    },
    sectionCard: {
        backgroundColor: '#ffffff',
        borderColor: '#e6ddd4',
        borderRadius: 20,
        borderWidth: 1,
        gap: 10,
        padding: 16,
    },
    sectionTitle: {
        color: '#121732',
        fontSize: 16,
        fontWeight: '800',
    },
    sectionBody: {
        color: '#35515c',
        fontSize: 14,
        lineHeight: 21,
    },
    badgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    badgePill: {
        backgroundColor: '#f6f8ff',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    badgeText: {
        color: '#232a45',
        fontSize: 12,
        fontWeight: '700',
    },
});