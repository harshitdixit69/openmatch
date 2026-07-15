import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton } from '../components/BackButton';
import { fetchReports, updateReportStatus, blockUser } from '../lib/chatApi';

type ReportRow = {
    id: string;
    reason: string;
    details: string;
    status: 'pending' | 'reviewed' | 'dismissed';
    created_at: string;
    reporter_id: string;
    reported_id: string;
};

type Props = {
    onClose: () => void;
};

export function ModerationQueueScreen({ onClose }: Props) {
    const [reports, setReports] = useState<ReportRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [actioningId, setActioningId] = useState<string | null>(null);

    async function loadReports() {
        setLoading(true);
        try {
            const nextReports = await fetchReports();
            setReports(nextReports.filter((r) => r.status === 'pending'));
        } catch (error) {
            console.error('Failed to load reports:', error);
            Alert.alert('Error', 'Could not load reports.');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadReports();
    }, []);

    async function handleDismiss(reportId: string) {
        setActioningId(reportId);
        try {
            await updateReportStatus(reportId, 'dismissed');
            setReports((current) => current.filter((r) => r.id !== reportId));
            Alert.alert('Success', 'Report dismissed.');
        } catch (error) {
            console.error('Failed to dismiss report:', error);
            Alert.alert('Error', 'Could not dismiss report.');
        } finally {
            setActioningId(null);
        }
    }

    async function handleBlockAndResolve(reportId: string, reportedUserId: string) {
        setActioningId(reportId);
        try {
            // Block the reported user on behalf of system/admin
            await blockUser(reportedUserId);
            // Mark report as reviewed
            await updateReportStatus(reportId, 'reviewed');
            setReports((current) => current.filter((r) => r.id !== reportId));
            Alert.alert('Success', 'User has been blocked and report resolved.');
        } catch (error) {
            console.error('Failed to block/resolve report:', error);
            Alert.alert('Error', 'Could not resolve report.');
        } finally {
            setActioningId(null);
        }
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
                <View style={styles.headerRow}>
                    <BackButton onPress={onClose} />
                    <View style={styles.headerCopy}>
                        <Text style={styles.eyebrow}>Admin Dashboard</Text>
                        <Text style={styles.title}>Moderation Queue</Text>
                        <Text style={styles.subtitle}>Review user-reported complaints and take action.</Text>
                    </View>
                </View>

                {loading ? (
                    <View style={styles.centeredState}>
                        <ActivityIndicator size="large" color="#d9643d" />
                        <Text style={styles.stateText}>Loading complaints...</Text>
                    </View>
                ) : reports.length === 0 ? (
                    <View style={styles.centeredState}>
                        <Text style={styles.stateIcon}>🛡️</Text>
                        <Text style={styles.stateTitle}>All Clear</Text>
                        <Text style={styles.stateText}>No pending complaints to moderate.</Text>
                    </View>
                ) : (
                    <FlatList
                        data={reports}
                        keyExtractor={(item) => item.id}
                        contentContainerStyle={styles.listContent}
                        renderItem={({ item }) => (
                            <View style={styles.reportCard}>
                                <View style={styles.cardHeader}>
                                    <Text style={styles.reasonBadge}>{item.reason}</Text>
                                    <Text style={styles.dateText}>
                                        {new Date(item.created_at).toLocaleDateString()}
                                    </Text>
                                </View>
                                
                                <Text style={styles.detailsText}>
                                    {item.details || 'No additional details provided.'}
                                </Text>
                                
                                <Text style={styles.idsText}>
                                    Reported User ID: {item.reported_id}
                                </Text>

                                <View style={styles.actionsRow}>
                                    <Pressable
                                        style={[styles.dismissButton, actioningId === item.id && styles.buttonDisabled]}
                                        disabled={actioningId === item.id}
                                        onPress={() => void handleDismiss(item.id)}
                                    >
                                        <Text style={styles.dismissButtonText}>Dismiss</Text>
                                    </Pressable>

                                    <Pressable
                                        style={[styles.actionButton, actioningId === item.id && styles.buttonDisabled]}
                                        disabled={actioningId === item.id}
                                        onPress={() => void handleBlockAndResolve(item.id, item.reported_id)}
                                    >
                                        <Text style={styles.actionButtonText}>Block User</Text>
                                    </Pressable>
                                </View>
                            </View>
                        )}
                    />
                )}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#f7fafc',
    },
    container: {
        flex: 1,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e2e8f0',
    },
    headerCopy: {
        flex: 1,
        marginLeft: 12,
    },
    eyebrow: {
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 1.5,
        color: '#d9643d',
    },
    title: {
        fontSize: 20,
        fontWeight: '800',
        color: '#123340',
        marginTop: 2,
    },
    subtitle: {
        fontSize: 12,
        color: '#7d8c90',
        marginTop: 4,
    },
    centeredState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
    stateIcon: {
        fontSize: 48,
    },
    stateTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#123340',
        marginTop: 16,
    },
    stateText: {
        fontSize: 14,
        color: '#7d8c90',
        marginTop: 8,
        textAlign: 'center',
    },
    listContent: {
        padding: 20,
        gap: 16,
    },
    reportCard: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        elevation: 1,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    reasonBadge: {
        backgroundColor: '#fed7d7',
        color: '#c53030',
        fontSize: 12,
        fontWeight: '700',
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 8,
    },
    dateText: {
        fontSize: 12,
        color: '#a0aec0',
    },
    detailsText: {
        fontSize: 14,
        color: '#4a5568',
        lineHeight: 20,
        marginBottom: 12,
    },
    idsText: {
        fontSize: 11,
        fontFamily: 'monospace',
        color: '#718096',
        backgroundColor: '#f7fafc',
        padding: 6,
        borderRadius: 6,
        marginBottom: 16,
    },
    actionsRow: {
        flexDirection: 'row',
        gap: 12,
    },
    dismissButton: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        backgroundColor: '#edf2f7',
        borderRadius: 10,
    },
    dismissButtonText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#4a5568',
    },
    actionButton: {
        flex: 1.25,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        backgroundColor: '#e53e3e',
        borderRadius: 10,
    },
    actionButtonText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#ffffff',
    },
    buttonDisabled: {
        opacity: 0.5,
    },
});
