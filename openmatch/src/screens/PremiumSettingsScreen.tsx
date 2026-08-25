import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { updateUserPresence } from '../lib/chatApi';
import { showFriendlyAlert } from '../lib/errorUtils';

export default function PremiumSettingsScreen({
    onBack,
    onSignedOut,
}: {
    onBack: () => void;
    onSignedOut: () => void;
}) {
    const [notifMessages, setNotifMessages] = useState(true);
    const [notifMatches, setNotifMatches] = useState(true);
    const [signingOut, setSigningOut] = useState(false);

    const handleSignOut = async () => {
        setSigningOut(true);
        try {
            await updateUserPresence('offline').catch(() => {});
            await supabase.auth.signOut();
            onSignedOut();
        } catch (e: any) {
            showFriendlyAlert('Sign Out Error', e, 'Could not complete sign out. Please try again.');
        } finally {
            setSigningOut(false);
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={onBack}>
                    <Text style={styles.backArrow}>‹</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>Account Settings</Text>
                    <Text style={styles.headerSub}>Manage notifications, privacy & subscription</Text>
                </View>
            </View>

            <ScrollView
                style={{ flex: 1, backgroundColor: '#0a0a0c' }}
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                {/* Notifications */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Push Notifications</Text>

                    <View style={styles.row}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle}>New Messages</Text>
                            <Text style={styles.rowSub}>Notify when a match sends a message</Text>
                        </View>
                        <Switch
                            value={notifMessages}
                            onValueChange={setNotifMessages}
                            trackColor={{ false: '#26252f', true: '#d4a853' }}
                            thumbColor={notifMessages ? '#0a0a0c' : '#8e8a9e'}
                        />
                    </View>

                    <View style={styles.row}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle}>New Curated Matches</Text>
                            <Text style={styles.rowSub}>Notify when your RM adds a new pitch</Text>
                        </View>
                        <Switch
                            value={notifMatches}
                            onValueChange={setNotifMatches}
                            trackColor={{ false: '#26252f', true: '#d4a853' }}
                            thumbColor={notifMatches ? '#0a0a0c' : '#8e8a9e'}
                        />
                    </View>
                </View>

                {/* Privacy & Safety */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Privacy & Safety</Text>
                    <Pressable
                        style={styles.itemRow}
                        onPress={() => Alert.alert('Privacy Policy', 'OpenMatch enforces strict end-to-end escrow contact masking until mutual unlock.')}
                    >
                        <Text style={styles.itemTitle}>Privacy Policy & Escrow Terms</Text>
                        <Text style={styles.arrow}>›</Text>
                    </Pressable>
                    <Pressable
                        style={styles.itemRow}
                        onPress={() => Alert.alert('Help & Support', 'Reach out to your dedicated Relationship Manager or email premium-support@openmatch.co.')}
                    >
                        <Text style={styles.itemTitle}>Dedicated RM Support</Text>
                        <Text style={styles.arrow}>›</Text>
                    </Pressable>
                </View>

                {/* Account Actions */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Account Actions</Text>
                    <Pressable style={styles.signOutBtn} onPress={handleSignOut} disabled={signingOut}>
                        {signingOut ? (
                            <ActivityIndicator color="#0a0a0c" size="small" />
                        ) : (
                            <Text style={styles.signOutBtnText}>Sign Out</Text>
                        )}
                    </Pressable>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0a0a0c' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: '#111015',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.08)',
        gap: 12,
    },
    backBtn: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#141318',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    backArrow: { fontSize: 26, color: '#d4a853', lineHeight: 28 },
    headerTitle: { fontSize: 18, fontWeight: '800', color: '#d4a853' },
    headerSub: { fontSize: 12, color: '#8e8a9e', marginTop: 1 },
    content: { padding: 16, gap: 16 },
    section: {
        backgroundColor: '#141318',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        gap: 12,
    },
    sectionTitle: { fontSize: 13, fontWeight: '800', color: '#d4a853', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
    rowTitle: { fontSize: 14, fontWeight: '700', color: '#f0ece4' },
    rowSub: { fontSize: 12, color: '#8e8a9e', marginTop: 2 },
    itemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.06)',
    },
    itemTitle: { fontSize: 14, fontWeight: '600', color: '#f0ece4' },
    arrow: { fontSize: 20, color: '#d4a853' },
    signOutBtn: { backgroundColor: '#d4a853', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
    signOutBtnText: { fontSize: 15, fontWeight: '800', color: '#0a0a0c' },
});
