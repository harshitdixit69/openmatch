// src/screens/DashboardScreen.tsx
// F9 – Dashboard / Activity Stats
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    AppState,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../components/BackButton';
import type { ActivityStats } from '../lib/activityStatsApi';
import { fetchActivityStats } from '../lib/activityStatsApi';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
    label,
    value,
    sublabel,
    accent,
}: {
    label: string;
    value: number | string;
    sublabel?: string;
    accent?: 'good' | 'warn' | 'bad' | 'neutral';
}) {
    const accentColor =
        accent === 'good' ? '#1a7a5e' :
            accent === 'warn' ? '#b07d2e' :
                accent === 'bad' ? '#c0392b' :
                    '#123340';

    return (
        <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: accentColor }]}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
            {sublabel ? <Text style={styles.statSublabel}>{sublabel}</Text> : null}
        </View>
    );
}

function SectionHeader({ title }: { title: string }) {
    return <Text style={styles.sectionHeader}>{title}</Text>;
}

function ScoreBar({
    label,
    score,
    maxScore = 100,
    accentHigh = '#1a7a5e',
    accentLow = '#c0392b',
    highIsGood = true,
}: {
    label: string;
    score: number;
    maxScore?: number;
    accentHigh?: string;
    accentLow?: string;
    highIsGood?: boolean;
}) {
    const pct = Math.min(100, Math.max(0, (score / maxScore) * 100));
    const isGoodValue = highIsGood ? pct >= 50 : pct < 50;
    const barColor = isGoodValue ? accentHigh : accentLow;

    return (
        <View style={styles.scoreBarWrap}>
            <View style={styles.scoreBarHeaderRow}>
                <Text style={styles.scoreBarLabel}>{label}</Text>
                <Text style={[styles.scoreBarValue, { color: barColor }]}>{score}</Text>
            </View>
            <View style={styles.scoreBarTrack}>
                <View style={[styles.scoreBarFill, { width: `${pct}%`, backgroundColor: barColor }]} />
            </View>
        </View>
    );
}

function reliabilityLabel(score: number): string {
    if (score >= 85) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 50) return 'Fair';
    return 'Needs improvement';
}

function ghostRiskLabel(score: number): string {
    if (score < 25) return 'Low risk';
    if (score < 50) return 'Medium risk';
    if (score < 75) return 'High risk';
    return 'Critical — resolve open requests';
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

interface Props {
    onBack: () => void;
}

export function DashboardScreen({ onBack }: Props) {
    const insets = useSafeAreaInsets();
    const [stats, setStats] = useState<ActivityStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);
        try {
            setStats(await fetchActivityStats());
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load stats');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Re-fetch stats when the app returns to foreground so numbers are never stale.
    const appStateRef = useRef(AppState.currentState);
    useEffect(() => {
        const sub = AppState.addEventListener('change', (nextState) => {
            if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
                void load();
            }
            appStateRef.current = nextState;
        });
        return () => sub.remove();
    }, [load]);

    const s = stats;

    return (
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
                <BackButton onPress={onBack} />
                <Text style={styles.headerTitle}>My Dashboard</Text>
                <View style={{ width: 40 }} />
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator color="#123340" size="large" />
                </View>
            ) : error ? (
                <View style={styles.center}>
                    <Text style={styles.errorText}>{error}</Text>
                    <Pressable style={styles.retryBtn} onPress={() => load()}>
                        <Text style={styles.retryBtnText}>Retry</Text>
                    </Pressable>
                </View>
            ) : s ? (
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#123340" />
                    }
                    showsVerticalScrollIndicator={false}
                >
                    {/* ---- Matches ---- */}
                    <SectionHeader title="Matches" />
                    <View style={styles.statGrid}>
                        <StatCard label="Total" value={s.totalMatches} accent="neutral" />
                        <StatCard label="Connected" value={s.connectedMatches} accent="good" />
                        <StatCard label="Unlocked" value={s.unlockedMatches} accent="good" sublabel="Contacts shared" />
                        <StatCard label="Unread msgs" value={s.unreadMessages} accent={s.unreadMessages > 0 ? 'warn' : 'neutral'} />
                    </View>

                    {/* ---- Requests ---- */}
                    <SectionHeader title="Interest Requests" />
                    <View style={styles.statGrid}>
                        <StatCard label="Received" value={s.requestsReceived} accent="neutral" />
                        <StatCard label="Sent" value={s.requestsSent} accent="neutral" />
                        <StatCard
                            label="Accepted"
                            value={s.requestsAccepted}
                            accent={s.requestsAccepted > 0 ? 'good' : 'neutral'}
                            sublabel={s.requestsSent > 0 ? `${Math.round((s.requestsAccepted / s.requestsSent) * 100)}% rate` : undefined}
                        />
                        <StatCard
                            label="Ghosted"
                            value={s.requestsGhosted}
                            accent={s.requestsGhosted > 2 ? 'bad' : s.requestsGhosted > 0 ? 'warn' : 'neutral'}
                        />
                    </View>

                    {/* ---- Messages ---- */}
                    <SectionHeader title="Messages" />
                    <View style={styles.statGrid}>
                        <StatCard label="Sent" value={s.messagesSent} accent="neutral" />
                        <StatCard label="Received" value={s.messagesReceived} accent="neutral" />
                    </View>

                    {/* ---- Profile Visibility ---- */}
                    <SectionHeader title="Profile Visibility" />
                    <View style={styles.statGrid}>
                        <StatCard label="Views (7d)" value={s.profileViews7d} accent={s.profileViews7d > 0 ? 'good' : 'neutral'} sublabel="Unique visitors" />
                        <StatCard label="Req. limit" value={s.activeRequestLimit} accent="neutral" sublabel="Max open outgoing" />
                    </View>

                    {/* ---- Trust Scores ---- */}
                    <SectionHeader title="Trust & Reliability" />
                    <View style={styles.scoreSection}>
                        <ScoreBar
                            label={`Reliability  ·  ${reliabilityLabel(s.reliabilityScore)}`}
                            score={s.reliabilityScore}
                            highIsGood
                        />
                        <ScoreBar
                            label={`Ghost risk  ·  ${ghostRiskLabel(s.ghostRiskScore)}`}
                            score={s.ghostRiskScore}
                            accentHigh="#c0392b"
                            accentLow="#1a7a5e"
                            highIsGood={false}
                        />
                    </View>

                    <View style={styles.tipCard}>
                        <Text style={styles.tipTitle}>How to improve your score</Text>
                        <Text style={styles.tipBody}>
                            Reply within 24 hours after acceptance, write personalised connect reasons, and close old requests you no longer intend to pursue.
                        </Text>
                    </View>
                </ScrollView>
            ) : null}
        </SafeAreaView>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#f5f4f0' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 12,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e8e5df',
    },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#123340' },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    errorText: { fontSize: 14, color: '#c0392b', textAlign: 'center', paddingHorizontal: 24 },
    retryBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#123340', borderRadius: 8 },
    retryBtnText: { color: '#fff', fontWeight: '600' },

    scroll: { flex: 1 },
    scrollContent: {
        paddingHorizontal: 16,
        paddingTop: 16,
        gap: 4,
        maxWidth: MAX_CONTENT_WIDTH,
        alignSelf: 'center',
        width: '100%',
    },

    sectionHeader: {
        fontSize: 13,
        fontWeight: '700',
        color: '#888',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        marginTop: 16,
        marginBottom: 8,
    },

    statGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    statCard: {
        flex: 1,
        minWidth: '44%',
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: '#e8e5df',
        gap: 2,
    },
    statValue: { fontSize: 28, fontWeight: '800', color: '#123340' },
    statLabel: { fontSize: 13, color: '#555', fontWeight: '600' },
    statSublabel: { fontSize: 11, color: '#999' },

    scoreSection: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: '#e8e5df',
        gap: 16,
    },
    scoreBarWrap: { gap: 6 },
    scoreBarHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    scoreBarLabel: { fontSize: 13, color: '#555', fontWeight: '600', flex: 1 },
    scoreBarValue: { fontSize: 16, fontWeight: '800' },
    scoreBarTrack: {
        height: 8,
        backgroundColor: '#eee',
        borderRadius: 4,
        overflow: 'hidden',
    },
    scoreBarFill: {
        height: 8,
        borderRadius: 4,
    },

    tipCard: {
        marginTop: 12,
        backgroundColor: '#eef4f7',
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: '#d0e4ed',
        gap: 6,
    },
    tipTitle: { fontSize: 13, fontWeight: '700', color: '#123340' },
    tipBody: { fontSize: 13, color: '#555', lineHeight: 19 },
});
