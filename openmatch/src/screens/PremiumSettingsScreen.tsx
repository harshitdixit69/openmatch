import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { updateUserPresence } from '../lib/chatApi';

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
            Alert.alert('Sign Out Error', e.message || 'Could not sign out.');
        } finally {
            setSigningOut(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
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

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {/* Notifications */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Push Notifications</Text>

                    <View style={styles.row}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle}>New Messages</Text>
                            <Text style={styles.rowSub}>Notify when a match sends a message</Text>
                        </View>
                        <Switch value={notifMessages} onValueChange={setNotifMessages} trackColor={{ false: BORDER, true: GOLD }} thumbColor="#fff" />
                    </View>

                    <View style={styles.row}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle}>New Curated Matches</Text>
                            <Text style={styles.rowSub}>Notify when your RM adds a new pitch</Text>
                        </View>
                        <Switch value={notifMatches} onValueChange={setNotifMatches} trackColor={{ false: BORDER, true: GOLD }} thumbColor="#fff" />
                    </View>
                </View>

                {/* Privacy & Safety */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Privacy & Safety</Text>
                    <Pressable style={styles.itemRow} onPress={() => Alert.alert('Privacy Policy', 'OpenMatch enforces strict end-to-end escrow contact masking until mutual unlock.')}>
                        <Text style={styles.itemTitle}>Privacy Policy & Escrow Terms</Text>
                        <Text style={styles.arrow}>›</Text>
                    </Pressable>
                    <Pressable style={styles.itemRow} onPress={() => Alert.alert('Help & Support', 'Reach out to your dedicated Relationship Manager or email premium-support@openmatch.co.')}>
                        <Text style={styles.itemTitle}>Dedicated RM Support</Text>
                        <Text style={styles.arrow}>›</Text>
                    </Pressable>
                </View>

                {/* Account Actions */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Account Actions</Text>
                    <Pressable style={styles.signOutBtn} onPress={handleSignOut} disabled={signingOut}>
                        {signingOut ? (
                            <ActivityIndicator color={DARK_BG} size="small" />
                        ) : (
                            <Text style={styles.signOutBtnText}>Sign Out</Text>
                        )}
                    </Pressable>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const GOLD = '#d4b373';
const DARK_BG = '#0d0c0f';
const CARD_BG = '#1a1828';
const BORDER = '#2a2640';
const TEXT_PRIMARY = '#f0ece8';
const TEXT_SUB = '#8e8aa0';
const TEXT_MUTED = '#6c6880';

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: DARK_BG },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 12 },
    backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_BG, borderRadius: 18, borderWidth: 1, borderColor: BORDER },
    backArrow: { fontSize: 26, color: GOLD, lineHeight: 28 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY },
    headerSub: { fontSize: 12, color: TEXT_MUTED, marginTop: 1 },
    content: { padding: 16, gap: 16 },
    section: { backgroundColor: CARD_BG, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: BORDER, gap: 12 },
    sectionTitle: { fontSize: 15, fontWeight: '800', color: GOLD, marginBottom: 4 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
    rowTitle: { fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY },
    rowSub: { fontSize: 12, color: TEXT_SUB, marginTop: 2 },
    itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#201c33' },
    itemTitle: { fontSize: 14, fontWeight: '600', color: TEXT_PRIMARY },
    arrow: { fontSize: 20, color: GOLD },
    signOutBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
    signOutBtnText: { fontSize: 15, fontWeight: '800', color: DARK_BG },
});
