import React from 'react';
import {
    ActivityIndicator,
    Image,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';

export type OutreachCallStatus =
    | 'pending'
    | 'calling'
    | 'voicemail'
    | 'completed_accepted'
    | 'completed_declined'
    | 'failed';

export interface OutreachLogRecord {
    id: string;
    retellCallId?: string;
    candidateName: string;
    candidatePhotoUrl?: string;
    callStatus: OutreachCallStatus;
    callSummary: string[];
    candidateSentiment?: string;
    updatedAt: string;
}

function formatTime(iso: string): string {
    if (!iso) return 'Just now';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function getStatusBadge(status: OutreachCallStatus) {
    switch (status) {
        case 'calling':
            return {
                label: 'AI Calling...',
                bgColor: 'rgba(212,179,115,0.15)',
                borderColor: '#d4b373',
                textColor: '#d4b373',
                showSpinner: true,
            };
        case 'completed_accepted':
            return {
                label: 'Pitch Accepted 🟢',
                bgColor: 'rgba(17,209,130,0.15)',
                borderColor: '#11d182',
                textColor: '#11d182',
                showSpinner: false,
            };
        case 'completed_declined':
            return {
                label: 'Pitch Declined ⚪',
                bgColor: 'rgba(142,138,160,0.15)',
                borderColor: '#8e8aa0',
                textColor: '#8e8aa0',
                showSpinner: false,
            };
        case 'voicemail':
            return {
                label: 'Voicemail Reached 🔴',
                bgColor: 'rgba(239,68,68,0.15)',
                borderColor: '#ef4444',
                textColor: '#ef4444',
                showSpinner: false,
            };
        case 'failed':
            return {
                label: 'Call Failed ⚠️',
                bgColor: 'rgba(239,68,68,0.15)',
                borderColor: '#ef4444',
                textColor: '#ef4444',
                showSpinner: false,
            };
        case 'pending':
        default:
            return {
                label: 'Call Scheduled ⏳',
                bgColor: 'rgba(212,179,115,0.1)',
                borderColor: 'rgba(212,179,115,0.4)',
                textColor: '#d4b373',
                showSpinner: false,
            };
    }
}

function getSentimentBadge(sentiment?: string) {
    if (!sentiment) return null;
    const lower = sentiment.toLowerCase();
    if (lower.includes('pos') || lower.includes('enthus')) return { label: `😊 ${sentiment}`, color: '#11d182' };
    if (lower.includes('neg') || lower.includes('declin')) return { label: `🙁 ${sentiment}`, color: '#ef4444' };
    return { label: `😐 ${sentiment}`, color: '#d4b373' };
}

export default function OutreachTrackerCard({
    log,
    onPress,
}: {
    log: OutreachLogRecord;
    onPress?: () => void;
}) {
    const badge = getStatusBadge(log.callStatus);
    const sentiment = getSentimentBadge(log.candidateSentiment);
    const bullets = (log.callSummary || []).slice(0, 3);

    return (
        <Pressable style={styles.card} onPress={onPress}>
            {/* Header: Candidate Info & Live Status Badge */}
            <View style={styles.cardHeader}>
                <View style={styles.candidateRow}>
                    {log.candidatePhotoUrl ? (
                        <Image source={{ uri: log.candidatePhotoUrl }} style={styles.avatar} />
                    ) : (
                        <View style={styles.avatarPlaceholder}>
                            <Text style={styles.avatarInitial}>
                                {log.candidateName?.charAt(0) ?? '?'}
                            </Text>
                        </View>
                    )}
                    <View style={{ flex: 1 }}>
                        <Text style={styles.candidateName}>{log.candidateName}</Text>
                        <Text style={styles.timeText}>Updated {formatTime(log.updatedAt)}</Text>
                    </View>
                </View>

                {/* Status Badge */}
                <View
                    style={[
                        styles.statusBadge,
                        { backgroundColor: badge.bgColor, borderColor: badge.borderColor },
                    ]}
                >
                    {badge.showSpinner ? (
                        <ActivityIndicator size="small" color={badge.textColor} style={{ marginRight: 4 }} />
                    ) : null}
                    <Text style={[styles.statusBadgeText, { color: badge.textColor }]}>
                        {badge.label}
                    </Text>
                </View>
            </View>

            {/* AI Summary Bullets */}
            {bullets.length > 0 ? (
                <View style={styles.summaryBox}>
                    <Text style={styles.summaryHeader}>🤖 AI Broker Summary</Text>
                    {bullets.map((bullet, idx) => (
                        <View key={idx} style={styles.bulletRow}>
                            <Text style={styles.bulletDot}>•</Text>
                            <Text style={styles.bulletText}>{bullet}</Text>
                        </View>
                    ))}
                </View>
            ) : log.callStatus === 'calling' ? (
                <View style={styles.callingBox}>
                    <Text style={styles.callingText}>
                        📞 Relationship Manager AI is actively pitching your profile to {log.candidateName}...
                    </Text>
                </View>
            ) : null}

            {/* Candidate Sentiment Footer */}
            {sentiment ? (
                <View style={styles.footerRow}>
                    <Text style={styles.sentimentLabel}>Candidate Sentiment:</Text>
                    <Text style={[styles.sentimentValue, { color: sentiment.color }]}>
                        {sentiment.label}
                    </Text>
                </View>
            ) : null}
        </Pressable>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles: Dark Gold Luxury Aesthetic
// ─────────────────────────────────────────────────────────────────────────────

const GOLD = '#d4b373';
const CARD_BG = '#1a1828';
const BORDER = '#2a2640';
const TEXT_PRIMARY = '#f0ece8';
const TEXT_SUB = '#8e8aa0';

const styles = StyleSheet.create({
    card: {
        backgroundColor: CARD_BG,
        borderRadius: 18,
        padding: 16,
        borderWidth: 1,
        borderColor: BORDER,
        gap: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 4,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    candidateRow: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    avatar: {
        width: 42,
        height: 42,
        borderRadius: 21,
        borderWidth: 1.5,
        borderColor: GOLD,
    },
    avatarPlaceholder: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: '#262238',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: GOLD,
    },
    avatarInitial: {
        fontSize: 16,
        fontWeight: '700',
        color: GOLD,
    },
    candidateName: {
        fontSize: 15,
        fontWeight: '800',
        color: TEXT_PRIMARY,
    },
    timeText: {
        fontSize: 11,
        color: TEXT_SUB,
        marginTop: 1,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderWidth: 1,
    },
    statusBadgeText: {
        fontSize: 11,
        fontWeight: '800',
    },
    summaryBox: {
        backgroundColor: 'rgba(20,18,30,0.8)',
        borderRadius: 14,
        padding: 12,
        borderWidth: 1,
        borderColor: 'rgba(212,179,115,0.2)',
        gap: 6,
    },
    summaryHeader: {
        fontSize: 11,
        fontWeight: '800',
        color: GOLD,
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    bulletRow: {
        flexDirection: 'row',
        gap: 6,
    },
    bulletDot: {
        fontSize: 12,
        color: GOLD,
        fontWeight: '900',
    },
    bulletText: {
        flex: 1,
        fontSize: 12,
        color: TEXT_PRIMARY,
        lineHeight: 17,
    },
    callingBox: {
        backgroundColor: 'rgba(212,179,115,0.08)',
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: 'rgba(212,179,115,0.3)',
    },
    callingText: {
        fontSize: 12,
        color: GOLD,
        fontStyle: 'italic',
        lineHeight: 17,
    },
    footerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 4,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.05)',
    },
    sentimentLabel: {
        fontSize: 11,
        color: TEXT_SUB,
    },
    sentimentValue: {
        fontSize: 12,
        fontWeight: '800',
    },
});
