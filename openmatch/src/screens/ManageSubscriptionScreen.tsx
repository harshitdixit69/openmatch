// src/screens/ManageSubscriptionScreen.tsx
//
// Real "Manage subscription" screen (replaces the placeholder Alert). Shows the member's
// current plan, expiry and remaining credits, and — when on the free/expired plan — an
// upgrade CTA. Also renders the full payment history inline so the user has one place for
// everything billing-related.
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '../components/BackButton';
import { getFriendlyErrorMessage } from '../lib/errorUtils';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';
import {
    formatAmount,
    getPaymentHistory,
    getSubscriptionSummary,
    PaymentRecord,
    SubscriptionSummary,
    tierLabel,
} from '../lib/paymentsApi';

interface Props {
    onBack: () => void;
    /** Optional: navigate the user to the upgrade/premium flow. */
    onUpgrade?: () => void;
}

function formatDate(iso: string | null) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ManageSubscriptionScreen({ onBack, onUpgrade }: Props) {
    const insets = useSafeAreaInsets();
    const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
    const [history, setHistory] = useState<PaymentRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setErrorMessage(null);
        try {
            // The subscription summary is the critical part of this screen — if it loads,
            // we show the screen. Payment history is best-effort: a failure there (e.g. a
            // permissions/RLS hiccup) must never hide the user's active plan.
            const sub = await getSubscriptionSummary();
            setSummary(sub);
            try {
                setHistory(await getPaymentHistory());
            } catch (histError) {
                console.warn('Failed to load payment history:', histError);
                setHistory([]);
            }
        } catch (error) {
            setErrorMessage(getFriendlyErrorMessage(error, 'Could not load your subscription details.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const active = summary?.isActive ?? false;

    return (
        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <BackButton onPress={onBack} />
                <Text style={styles.headerTitle}>Manage subscription</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
                <View style={styles.inner}>
                    {loading ? (
                        <View style={styles.centerBox}>
                            <ActivityIndicator size="large" color="#d1354c" />
                        </View>
                    ) : errorMessage ? (
                        <View style={styles.centerBox}>
                            <Text style={styles.errorText}>{errorMessage}</Text>
                            <Pressable style={styles.retryButton} onPress={() => void load()}>
                                <Text style={styles.retryText}>Try again</Text>
                            </Pressable>
                        </View>
                    ) : (
                        <>
                            {/* Current plan card */}
                            <View style={[styles.planCard, active ? styles.planCardActive : styles.planCardFree]}>
                                <Text style={styles.planLabel}>CURRENT PLAN</Text>
                                <Text style={styles.planName}>
                                    {active ? summary?.tierLabel : 'Free'}
                                </Text>
                                {active ? (
                                    <Text style={styles.planMeta}>
                                        Renews / expires on {formatDate(summary?.expiresAt ?? null)}
                                    </Text>
                                ) : summary?.isExpired ? (
                                    <Text style={styles.planMeta}>
                                        Your {summary?.tierLabel} plan expired on {formatDate(summary?.expiresAt ?? null)}
                                    </Text>
                                ) : (
                                    <Text style={styles.planMeta}>
                                        You’re on the free plan. Upgrade to unlock more matches and premium features.
                                    </Text>
                                )}

                                {onUpgrade ? (
                                    <Pressable style={styles.upgradeButton} onPress={onUpgrade}>
                                        <Text style={styles.upgradeText}>
                                            {active ? 'Change or extend plan' : 'Upgrade now'}
                                        </Text>
                                    </Pressable>
                                ) : null}
                            </View>

                            {/* Credits */}
                            {active ? (
                                <View style={styles.creditsRow}>
                                    <CreditPill label="Unlocks" value={summary?.credits.unlocks ?? 0} />
                                    <CreditPill label="Super interests" value={summary?.credits.superInterests ?? 0} />
                                    <CreditPill label="Spotlights" value={summary?.credits.spotlights ?? 0} />
                                    {(summary?.credits.aiCalls ?? 0) > 0 ? (
                                        <CreditPill label="AI calls" value={summary?.credits.aiCalls ?? 0} />
                                    ) : null}
                                </View>
                            ) : null}

                            {/* Payment history */}
                            <Text style={styles.sectionHeading}>Payment history</Text>
                            {history.length === 0 ? (
                                <Text style={styles.emptyText}>
                                    No payments yet. Your invoices and completed payments will appear here.
                                </Text>
                            ) : (
                                <View style={styles.historyCard}>
                                    {history.map((record, index) => (
                                        <View key={record.id}>
                                            {index > 0 ? <View style={styles.divider} /> : null}
                                            <View style={styles.historyRow}>
                                                <View style={styles.historyLeft}>
                                                    <Text style={styles.historyDesc}>
                                                        {record.description || tierLabel(record.tier)}
                                                    </Text>
                                                    <Text style={styles.historyMeta}>
                                                        {formatDate(record.createdAt)}
                                                        {record.status !== 'succeeded' ? ` · ${record.status}` : ''}
                                                    </Text>
                                                </View>
                                                <Text style={styles.historyAmount}>
                                                    {formatAmount(record.amountMinor, record.currency)}
                                                </Text>
                                            </View>
                                        </View>
                                    ))}
                                </View>
                            )}

                            <Text style={styles.footnote}>
                                Payments are processed securely by Stripe. For refunds or billing questions,
                                contact support@openmatch.app.
                            </Text>
                        </>
                    )}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

function CreditPill({ label, value }: { label: string; value: number }) {
    return (
        <View style={styles.creditPill}>
            <Text style={styles.creditValue}>{value}</Text>
            <Text style={styles.creditLabel}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0a0a0c' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: '#111015',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    headerTitle: { fontSize: 17, fontWeight: '800', color: '#d4a853' },
    content: { paddingVertical: 16, alignItems: 'center' },
    inner: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, paddingHorizontal: 16 },
    centerBox: { paddingVertical: 64, alignItems: 'center', gap: 16 },
    errorText: { color: '#8e8a9e', textAlign: 'center', fontSize: 15 },
    retryButton: { backgroundColor: '#d4a853', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24 },
    retryText: { color: '#0a0a0c', fontWeight: '800' },

    planCard: { borderRadius: 16, padding: 20, borderWidth: 1.5 },
    planCardActive: { backgroundColor: '#141318', borderColor: '#d4a853' },
    planCardFree: { backgroundColor: '#141318', borderColor: 'rgba(255,255,255,0.08)' },
    planLabel: { fontSize: 12, fontWeight: '800', color: '#d4a853', letterSpacing: 1 },
    planName: { fontSize: 28, fontWeight: '900', color: '#f0ece4', marginTop: 4 },
    planMeta: { fontSize: 14, color: '#8e8a9e', marginTop: 6, lineHeight: 20 },
    upgradeButton: {
        marginTop: 16,
        backgroundColor: '#d4a853',
        borderRadius: 10,
        paddingVertical: 13,
        alignItems: 'center',
    },
    upgradeText: { color: '#0a0a0c', fontWeight: '800', fontSize: 15 },

    creditsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
    creditPill: {
        backgroundColor: '#141318',
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        alignItems: 'center',
        minWidth: 84,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    creditValue: { fontSize: 20, fontWeight: '900', color: '#d4a853' },
    creditLabel: { fontSize: 12, color: '#8e8a9e', marginTop: 2 },

    sectionHeading: { fontSize: 16, fontWeight: '800', color: '#d4a853', marginTop: 28, marginBottom: 10 },
    emptyText: { color: '#8e8a9e', fontSize: 14, lineHeight: 20 },
    historyCard: {
        backgroundColor: '#141318',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
    },
    historyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        paddingHorizontal: 16,
    },
    historyLeft: { flex: 1, paddingRight: 12 },
    historyDesc: { fontSize: 15, fontWeight: '700', color: '#f0ece4' },
    historyMeta: { fontSize: 12.5, color: '#8e8a9e', marginTop: 3 },
    historyAmount: { fontSize: 15, fontWeight: '800', color: '#d4a853' },
    divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginLeft: 16 },

    footnote: { fontSize: 12.5, color: '#8e8a9e', marginTop: 24, lineHeight: 18 },
});
