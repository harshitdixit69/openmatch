// src/screens/SettingsScreen.tsx
import React, { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    ActivityIndicator,
    Alert,
    Linking,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../components/BackButton';
import { supabase } from '../lib/supabase';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';
import { updateUserPresence } from '../lib/chatApi';
import { pickProfilePhotoFromLibrary } from '../lib/profilePhotoApi';
import { fetchCurrentProfile, submitVerification } from '../lib/profileApi';
import { IdentityVerificationScreen } from './IdentityVerificationScreen';

interface Props {
    onBack: () => void;
    /** Called after successful sign-out so App.tsx can clear session state */
    onSignedOut: () => void;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NotificationPrefs = {
    new_matches: boolean;
    new_messages: boolean;
    request_accepted: boolean;
    ghosting_reminders: boolean;
    broker_calls: boolean;
};

const DEFAULT_NOTIF_PREFS: NotificationPrefs = {
    new_matches: true,
    new_messages: true,
    request_accepted: true,
    ghosting_reminders: true,
    broker_calls: false,
};

const NOTIF_LABELS: Record<keyof NotificationPrefs, string> = {
    new_matches: 'New match suggestions',
    new_messages: 'New messages',
    request_accepted: 'Request accepted',
    ghosting_reminders: 'Follow-up reminders',
    broker_calls: 'AI broker call alerts',
};

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function SettingsSection({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <View style={styles.sectionBody}>{children}</View>
        </View>
    );
}

function SettingsRow({
    label,
    subtitle,
    onPress,
    destructive,
    right,
}: {
    label: string;
    subtitle?: string;
    onPress?: () => void;
    destructive?: boolean;
    right?: React.ReactNode;
}) {
    const inner = (
        <View style={styles.row}>
            <View style={styles.rowLeft}>
                <Text style={[styles.rowLabel, destructive && styles.rowLabelDestructive]}>
                    {label}
                </Text>
                {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
            </View>
            {right ?? (onPress ? <Text style={styles.rowChevron}>›</Text> : null)}
        </View>
    );

    if (!onPress) return inner;
    return (
        <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.rowPressed}>
            {inner}
        </Pressable>
    );
}

function Divider() {
    return <View style={styles.divider} />;
}

// ---------------------------------------------------------------------------
// Change Password sub-flow (inline, no extra screen)
// ---------------------------------------------------------------------------

function ChangePasswordRow() {
    const [expanded, setExpanded] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);

    async function submit() {
        if (newPassword.length < 8) {
            Alert.alert('Too short', 'Password must be at least 8 characters.');
            return;
        }
        if (newPassword !== confirm) {
            Alert.alert('Mismatch', 'Passwords do not match.');
            return;
        }
        setSaving(true);
        try {
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) throw error;
            Alert.alert('Password updated', 'Your password has been changed.');
            setNewPassword('');
            setConfirm('');
            setExpanded(false);
        } catch (e: any) {
            Alert.alert('Error', e?.message ?? 'Failed to update password.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            <SettingsRow
                label="Change password"
                onPress={() => setExpanded((v) => !v)}
                right={<Text style={styles.rowChevron}>{expanded ? '∧' : '›'}</Text>}
            />
            {expanded && (
                <View style={styles.inlineForm}>
                    <TextInput
                        style={styles.inlineInput}
                        placeholder="New password"
                        placeholderTextColor="#bbb"
                        secureTextEntry
                        value={newPassword}
                        onChangeText={setNewPassword}
                        autoCapitalize="none"
                    />
                    <TextInput
                        style={styles.inlineInput}
                        placeholder="Confirm password"
                        placeholderTextColor="#bbb"
                        secureTextEntry
                        value={confirm}
                        onChangeText={setConfirm}
                        autoCapitalize="none"
                    />
                    <Pressable
                        style={[styles.inlineButton, saving && styles.inlineButtonDisabled]}
                        onPress={submit}
                        disabled={saving}
                    >
                        {saving ? (
                            <ActivityIndicator color="#fff" size="small" />
                        ) : (
                            <Text style={styles.inlineButtonText}>Update password</Text>
                        )}
                    </Pressable>
                </View>
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export function SettingsScreen({ onBack, onSignedOut }: Props) {
    const insets = useSafeAreaInsets();
    const [userEmail, setUserEmail] = useState('');
    const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIF_PREFS);
    const [signingOut, setSigningOut] = useState(false);
    const [verificationStatus, setVerificationStatus] = useState<'unverified' | 'pending' | 'verified' | 'rejected'>('unverified');
    const [showVerifyScreen, setShowVerifyScreen] = useState(false);
    const [busyMode, setBusyMode] = useState(false);

    useEffect(() => {
        let mounted = true;

        async function init() {
            const { data } = await supabase.auth.getUser();
            if (!mounted) return;
            if (data.user?.email) setUserEmail(data.user.email);
            if (data.user?.id) {
                try {
                    const saved = await AsyncStorage.getItem(`openmatch:notifPrefs:${data.user.id}`);
                    if (saved && mounted) {
                        setNotifPrefs(JSON.parse(saved));
                    }
                } catch (e) {
                    console.warn('Failed to load notification preferences:', e);
                }
            }
        }
        void init();

        async function fetchStatus() {
            try {
                const profile = await fetchCurrentProfile();
                if (profile && mounted) {
                    if (profile.verification_status) {
                        setVerificationStatus(profile.verification_status);
                    }
                    setBusyMode(Boolean(profile.busy_mode));
                }
            } catch (err) {
                console.warn('Failed to load status:', err);
            }
        }
        void fetchStatus();

        return () => {
            mounted = false;
        };
    }, []);

    const toggleBusyMode = async () => {
        const next = !busyMode;
        setBusyMode(next);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { error } = await supabase
                    .from('profiles')
                    .update({
                        busy_mode: next,
                        busy_mode_changed_at: new Date().toISOString()
                    })
                    .eq('id', user.id);
                if (error) throw error;
            }
        } catch (err) {
            console.error('Failed to update busy mode:', err);
            Alert.alert('Error', 'Could not update Busy mode. Please try again.');
            setBusyMode(!next);
        }
    };

    const toggleNotif = useCallback(async (key: keyof NotificationPrefs) => {
        const next = { ...notifPrefs, [key]: !notifPrefs[key] };
        setNotifPrefs(next);
        try {
            const { data } = await supabase.auth.getUser();
            if (data.user?.id) {
                await AsyncStorage.setItem(`openmatch:notifPrefs:${data.user.id}`, JSON.stringify(next));
            }
        } catch (e) {
            console.warn('Failed to save notification preferences:', e);
        }
    }, [notifPrefs]);

    function handleVerifyIdentity() {
        setShowVerifyScreen(true);
    }

    const handleSignOut = useCallback(() => {
        if (Platform.OS === 'web') {
            const confirm = window.confirm('Are you sure you want to sign out?');
            if (confirm) {
                void (async () => {
                    setSigningOut(true);
                    try {
                        try {
                            await updateUserPresence('offline');
                        } catch (presenceErr) {
                            console.warn('Failed to set status to offline before sign out:', presenceErr);
                        }
                        await supabase.auth.signOut();
                        onSignedOut();
                    } catch (e: any) {
                        alert(e?.message ?? 'Sign out failed.');
                        setSigningOut(false);
                    }
                })();
            }
            return;
        }

        Alert.alert('Sign out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Sign out',
                style: 'destructive',
                onPress: async () => {
                    setSigningOut(true);
                    try {
                        try {
                            await updateUserPresence('offline');
                        } catch (presenceErr) {
                            console.warn('Failed to set status to offline before sign out:', presenceErr);
                        }
                        await supabase.auth.signOut();
                        onSignedOut();
                    } catch (e: any) {
                        Alert.alert('Error', e?.message ?? 'Sign out failed.');
                        setSigningOut(false);
                    }
                },
            },
        ]);
    }, [onSignedOut]);

    const handleDeleteAccount = useCallback(() => {
        if (Platform.OS === 'web') {
            const confirm = window.confirm(
                'Delete account\nThis permanently deletes your profile, matches, and all chat history. This cannot be undone. Do you want to continue?'
            );
            if (confirm) {
                void Linking.openURL('mailto:support@openmatch.app?subject=Account%20Deletion%20Request');
            }
            return;
        }

        Alert.alert(
            'Delete account',
            'This permanently deletes your profile, matches, and all chat history. This cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete my account',
                    style: 'destructive',
                    onPress: () => {
                        // Route to support email for irreversible action — never
                        // allow client-side self-delete without server-side verification.
                        Linking.openURL('mailto:support@openmatch.app?subject=Account%20Deletion%20Request');
                    },
                },
            ],
        );
    }, []);

    if (showVerifyScreen) {
        return (
            <IdentityVerificationScreen
                onBack={() => setShowVerifyScreen(false)}
                onCompleted={(status) => {
                    setVerificationStatus(status);
                    setShowVerifyScreen(false);
                }}
            />
        );
    }

    return (
        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
            {/* Header */}
            <View style={styles.header}>
                <BackButton onPress={onBack} />
                <Text style={styles.headerTitle}>Settings</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView
                contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.inner}>

                    {/* ── Account ── */}
                    <SettingsSection title="Account">
                        <SettingsRow
                            label="Email"
                            subtitle={userEmail || 'Loading…'}
                        />
                        <Divider />
                        <ChangePasswordRow />
                    </SettingsSection>

                    {/* ── Availability ── */}
                    <SettingsSection title="Availability">
                        <SettingsRow
                            label="Busy Mode"
                            subtitle="Temporarily pause reply deadline countdowns"
                            right={
                                <Switch
                                    value={busyMode}
                                    onValueChange={toggleBusyMode}
                                    trackColor={{ false: '#d0d0d0', true: '#123340' }}
                                    thumbColor="#fff"
                                />
                            }
                        />

                    {/* ── Notifications ── */}
                    <SettingsSection title="Notifications">
                        {(Object.keys(notifPrefs) as (keyof NotificationPrefs)[]).map((key, i, arr) => (
                            <React.Fragment key={key}>
                                <SettingsRow
                                    label={NOTIF_LABELS[key]}
                                    right={
                                        <Switch
                                            value={notifPrefs[key]}
                                            onValueChange={() => toggleNotif(key)}
                                            trackColor={{ false: '#d0d0d0', true: '#123340' }}
                                            thumbColor="#fff"
                                        />
                                    }
                                />
                                {i < arr.length - 1 && <Divider />}
                            </React.Fragment>
                        ))}
                    </SettingsSection>

                    {/* ── Privacy ── */}
                    <SettingsSection title="Privacy">
                        <SettingsRow
                            label="Privacy Policy"
                            onPress={() => Linking.openURL('https://openmatch.app/privacy')}
                        />
                        <Divider />
                        <SettingsRow
                            label="Terms of Service"
                            onPress={() => Linking.openURL('https://openmatch.app/terms')}
                        />
                        <Divider />
                        <SettingsRow
                            label="Contact Support"
                            onPress={() => Linking.openURL('mailto:support@openmatch.app')}
                        />
                    </SettingsSection>

                    {/* ── Identity Verification ── */}
                    <SettingsSection title="Identity Verification">
                        <SettingsRow
                            label="Verification Status"
                            subtitle={
                                verificationStatus === 'verified'
                                    ? 'Verified ✅'
                                    : verificationStatus === 'pending'
                                    ? 'Pending Review ⏳'
                                    : verificationStatus === 'rejected'
                                    ? 'Rejected ❌ (Tap to try again)'
                                    : 'Not Verified (Tap to verify)'
                            }
                            onPress={
                                verificationStatus === 'verified' || verificationStatus === 'pending'
                                    ? undefined
                                    : () => void handleVerifyIdentity()
                            }
                        />
                    </SettingsSection>

                    {/* ── Danger Zone ── */}
                    <SettingsSection title="Danger Zone">
                        <SettingsRow
                            label={signingOut ? 'Signing out…' : 'Sign out'}
                            destructive
                            onPress={signingOut ? undefined : handleSignOut}
                        />
                        <Divider />
                        <SettingsRow
                            label="Delete account"
                            subtitle="Permanently remove all data"
                            destructive
                            onPress={handleDeleteAccount}
                        />
                    </SettingsSection>

                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#f4f4f6' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#e5e5e5',
    },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#111' },
    scroll: { paddingTop: 20 },
    inner: { maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center', paddingHorizontal: 16 },
    section: {
        marginBottom: 24,
        backgroundColor: '#fff',
        borderRadius: 14,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 2,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: '#888',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 8,
    },
    sectionBody: { paddingBottom: 4 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 13,
        minHeight: 50,
    },
    rowPressed: { backgroundColor: '#f5f5f5' },
    rowLeft: { flex: 1, marginRight: 12 },
    rowLabel: { fontSize: 15, color: '#111' },
    rowLabelDestructive: { color: '#c0392b' },
    rowSubtitle: { fontSize: 12, color: '#999', marginTop: 2 },
    rowChevron: { fontSize: 20, color: '#bbb', lineHeight: 24 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#f0f0f0', marginLeft: 16 },
    inlineForm: { paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
    inlineInput: {
        borderWidth: 1.5,
        borderColor: '#d0d0d0',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 11,
        fontSize: 15,
        color: '#111',
        backgroundColor: '#fafafa',
    },
    inlineButton: {
        backgroundColor: '#123340',
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: 'center',
    },
    inlineButtonDisabled: { opacity: 0.6 },
    inlineButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
