// src/screens/SettingsScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { getFriendlyErrorMessage, showFriendlyAlert } from '../lib/errorUtils';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';
import { updateUserPresence } from '../lib/chatApi';
import { useTheme, type ThemeMode, type ThemeColors } from '../lib/theme';
import { pickProfilePhotoFromLibrary } from '../lib/profilePhotoApi';
import { fetchCurrentProfile, submitVerification } from '../lib/profileApi';
import {
    DEFAULT_DISCOVERY_SETTINGS,
    DiscoverySettings,
    fetchDiscoverySettings,
    updateDiscoverySettings,
} from '../lib/discoverySafetyApi';
import {
    DEFAULT_NOTIF_PREFS,
    loadNotificationPrefs,
    NOTIF_LABELS,
    NotificationPrefs,
    saveNotificationPrefs,
} from '../lib/notificationPrefs';
import { clearSearchHistory } from '../lib/searchHistory';
import { IdentityVerificationScreen } from './IdentityVerificationScreen';
import { BlockedProfilesScreen } from './BlockedProfilesScreen';
import { SafetyCenterScreen } from './SafetyCenterScreen';
import { ManageSubscriptionScreen } from './ManageSubscriptionScreen';
import { restorePurchases, tierLabel } from '../lib/paymentsApi';

interface Props {
    onBack: () => void;
    /** Called after successful sign-out so App.tsx can clear session state */
    onSignedOut: () => void;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Notification preference shape, labels and defaults now live in
// ../lib/notificationPrefs so SettingsScreen and MainTabsScreen cannot drift.

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
    const styles = useThemedStyles();
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
    const styles = useThemedStyles();
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
    const styles = useThemedStyles();
    return <View style={styles.divider} />;
}

// ---------------------------------------------------------------------------
// Appearance — Light / Dark / System theme selector
// ---------------------------------------------------------------------------

function ThemeModeRow() {
    const styles = useThemedStyles();
    const { themeMode, setThemeMode } = useTheme();
    const options: { value: ThemeMode; label: string; icon: string }[] = [
        { value: 'light', label: 'Light', icon: '☀️' },
        { value: 'dark', label: 'Dark', icon: '🌙' },
        { value: 'system', label: 'System', icon: '⚙️' },
    ];

    return (
        <View style={styles.row}>
            <View style={styles.rowLeft}>
                <Text style={styles.rowLabel}>Theme</Text>
                <Text style={styles.rowSubtitle}>Choose light, dark, or match your device</Text>
            </View>
            <View style={styles.themeSegment}>
                {options.map((opt) => {
                    const active = themeMode === opt.value;
                    return (
                        <Pressable
                            key={opt.value}
                            onPress={() => void setThemeMode(opt.value)}
                            style={[styles.themeSegmentItem, active && styles.themeSegmentItemActive]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={`${opt.label} theme`}
                        >
                            <Text style={styles.themeSegmentIcon}>{opt.icon}</Text>
                            <Text style={[styles.themeSegmentLabel, active && styles.themeSegmentLabelActive]}>
                                {opt.label}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

// ---------------------------------------------------------------------------
// Change Password sub-flow (inline, no extra screen)
// ---------------------------------------------------------------------------

function ChangePasswordRow() {
    const styles = useThemedStyles();
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
            showFriendlyAlert('Password Update Failed', e, 'Could not update password. Please check requirements and try again.');
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
    const styles = useThemedStyles();
    const insets = useSafeAreaInsets();
    const [userEmail, setUserEmail] = useState('');
    const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIF_PREFS);
    const [signingOut, setSigningOut] = useState(false);
    const [verificationStatus, setVerificationStatus] = useState<'unverified' | 'pending' | 'verified' | 'rejected'>('unverified');
    const [showVerifyScreen, setShowVerifyScreen] = useState(false);
    const [busyMode, setBusyMode] = useState(false);
    const [discovery, setDiscovery] = useState<DiscoverySettings>(DEFAULT_DISCOVERY_SETTINGS);
    const [discoveryLoaded, setDiscoveryLoaded] = useState(false);
    const [discoveryPending, setDiscoveryPending] = useState<keyof DiscoverySettings | null>(null);
    const [showBlockedScreen, setShowBlockedScreen] = useState(false);
    const [showSafetyScreen, setShowSafetyScreen] = useState(false);
    const [showManageSubscription, setShowManageSubscription] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;

        async function init() {
            const { data } = await supabase.auth.getUser();
            if (!mounted) return;
            if (data.user?.email) setUserEmail(data.user.email);
            if (data.user?.id) {
                setUserId(data.user.id);
                const prefs = await loadNotificationPrefs(data.user.id);
                if (mounted) setNotifPrefs(prefs);
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

        async function fetchDiscovery() {
            try {
                const settings = await fetchDiscoverySettings();
                if (mounted) setDiscovery(settings);
            } catch (err) {
                console.warn('Failed to load discovery settings:', err);
            } finally {
                if (mounted) setDiscoveryLoaded(true);
            }
        }
        void fetchDiscovery();

        return () => {
            mounted = false;
        };
    }, []);

    /**
     * Optimistically flips a discovery toggle and rolls back if the write fails,
     * so the switch never shows a state the database does not agree with.
     */
    const toggleDiscovery = useCallback(
        async (key: keyof DiscoverySettings, next: boolean) => {
            const previous = discovery[key];
            setDiscovery((current) => ({ ...current, [key]: next }));
            setDiscoveryPending(key);

            try {
                await updateDiscoverySettings({ [key]: next } as Partial<DiscoverySettings>);
            } catch (err) {
                setDiscovery((current) => ({ ...current, [key]: previous }));
                showFriendlyAlert(
                    'Could not save setting',
                    err,
                    'Your change was not saved. Please check your connection and try again.',
                );
            } finally {
                setDiscoveryPending(null);
            }
        },
        [discovery],
    );

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
        const { data } = await supabase.auth.getUser();
        if (data.user?.id) {
            await saveNotificationPrefs(data.user.id, next);
        }
    }, [notifPrefs]);

    function handleVerifyIdentity() {
        setShowVerifyScreen(true);
    }

    function showSettingsNotice(title: string, message: string) {
        Alert.alert(title, message);
    }

    const handleRestorePurchases = useCallback(() => {
        if (restoring) return;
        setRestoring(true);
        void (async () => {
            try {
                const summary = await restorePurchases();
                if (summary.isActive) {
                    showSettingsNotice(
                        'Purchases restored',
                        `Your ${tierLabel(summary.tier)} plan is active${summary.expiresAt ? ` until ${new Date(summary.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.`,
                    );
                } else if (summary.isExpired) {
                    showSettingsNotice(
                        'No active plan',
                        `Your ${tierLabel(summary.tier)} plan has expired. Upgrade again to restore premium features.`,
                    );
                } else {
                    showSettingsNotice('Nothing to restore', 'No previous purchases were found on this account.');
                }
            } catch (error) {
                showFriendlyAlert('Restore failed', error, 'We could not check your purchases. Please try again.');
            } finally {
                setRestoring(false);
            }
        })();
    }, [restoring]);

    const handleClearSearchHistory = useCallback(() => {
        if (!userId) {
            showSettingsNotice('Clear search history', 'Please wait for your account to finish loading and try again.');
            return;
        }

        void (async () => {
            try {
                await clearSearchHistory(userId);
                showSettingsNotice('Search history cleared', 'Your recent searches have been removed from this device.');
            } catch (error) {
                showFriendlyAlert('Could not clear history', error, 'Your recent searches could not be removed. Please try again.');
            }
        })();
    }, [userId]);

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
                        showFriendlyAlert('Sign Out Failed', e, 'Could not complete sign out. Please try again.');
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

    if (showBlockedScreen) {
        return <BlockedProfilesScreen onBack={() => setShowBlockedScreen(false)} />;
    }

    if (showSafetyScreen) {
        return <SafetyCenterScreen onBack={() => setShowSafetyScreen(false)} />;
    }

    if (showManageSubscription) {
        return (
            <ManageSubscriptionScreen
                onBack={() => setShowManageSubscription(false)}
                onUpgrade={() => {
                    setShowManageSubscription(false);
                    showSettingsNotice(
                        'Upgrade your plan',
                        'Open the Membership tab from the home screen to choose a plan and complete your upgrade.',
                    );
                }}
            />
        );
    }

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

                    {/* ── Appearance ── */}
                    <SettingsSection title="Appearance">
                        <ThemeModeRow />
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
                                    trackColor={{ false: '#d0d0d0', true: '#121732' }}
                                    thumbColor="#fff"
                                />
                            }
                        />
                    </SettingsSection>

                    {/* ── Discovery & safety ── */}
                    <SettingsSection title="Discovery & safety">
                        <SettingsRow
                            label="Profile visibility"
                            subtitle={
                                !discoveryLoaded
                                    ? 'Loading…'
                                    : discovery.isDiscoverable
                                        ? 'Your profile can appear in matching feeds'
                                        : 'Your profile is hidden from new matches. Existing chats are unaffected.'
                            }
                            right={
                                <Switch
                                    value={discovery.isDiscoverable}
                                    onValueChange={(next) => void toggleDiscovery('isDiscoverable', next)}
                                    disabled={!discoveryLoaded || discoveryPending === 'isDiscoverable'}
                                    trackColor={{ false: '#d0d0d0', true: '#121732' }}
                                    thumbColor="#fff"
                                />
                            }
                        />
                        <Divider />
                        <SettingsRow
                            label="Incognito mode"
                            subtitle="Browse profiles without appearing in their visitors list"
                            right={
                                <Switch
                                    value={discovery.incognitoMode}
                                    onValueChange={(next) => void toggleDiscovery('incognitoMode', next)}
                                    disabled={!discoveryLoaded || discoveryPending === 'incognitoMode'}
                                    trackColor={{ false: '#d0d0d0', true: '#121732' }}
                                    thumbColor="#fff"
                                />
                            }
                        />
                        <Divider />
                        <SettingsRow
                            label="Blocked profiles"
                            subtitle="Review people you have blocked"
                            onPress={() => setShowBlockedScreen(true)}
                        />
                        <Divider />
                        <SettingsRow
                            label="Report a user"
                            subtitle="Report harassment, scams, or suspicious behavior"
                            onPress={() =>
                                showSettingsNotice(
                                    'Report a user',
                                    'Open the chat or profile of the person you want to report and use the ⋯ menu. That way your report is linked to the right account and reviewed faster.',
                                )
                            }
                        />
                        <Divider />
                        <SettingsRow
                            label="Safety center"
                            subtitle="Learn how to stay safe on OpenMatch"
                            onPress={() => setShowSafetyScreen(true)}
                        />
                    </SettingsSection>

                    {/* ── In-app alerts ── */}
                    {/* Named "In-app alerts", not "Notifications": there is no push
                        transport yet, so these only gate the foreground popup. */}
                    <SettingsSection title="In-app alerts">
                        <SettingsRow
                            label="Where these apply"
                            subtitle="These control alerts shown while OpenMatch is open on this device."
                        />
                        <Divider />
                        {(Object.keys(notifPrefs) as (keyof NotificationPrefs)[]).map((key, i, arr) => (
                            <React.Fragment key={String(key)}>
                                <SettingsRow
                                    label={NOTIF_LABELS[key]}
                                    right={
                                        <Switch
                                            value={notifPrefs[key]}
                                            onValueChange={() => toggleNotif(key)}
                                            trackColor={{ false: '#d0d0d0', true: '#121732' }}
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
                        {/* Informational, not a switch: contact escrow is unconditional,
                            so a toggle here could never be turned off. */}
                        <SettingsRow
                            label="Contact sharing"
                            subtitle="Your phone and WhatsApp numbers stay hidden until both people complete a mutual unlock. This always applies and cannot be turned off."
                        />
                        <Divider />
                        <SettingsRow
                            label="Download my data"
                            subtitle="Request a copy of your OpenMatch data"
                            onPress={() => Linking.openURL('mailto:support@openmatch.app?subject=Data%20Export%20Request')}
                        />
                        <Divider />
                        <SettingsRow
                            label="Clear search history"
                            subtitle="Remove your recent searches from this device"
                            onPress={handleClearSearchHistory}
                        />
                        <Divider />
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
                    </SettingsSection>

                    {/* ── Security ── */}
                    <SettingsSection title="Security">
                        <SettingsRow
                            label="Change email"
                            subtitle={userEmail || 'Update your sign-in email'}
                            onPress={() => showSettingsNotice('Change email', 'To change your email securely, contact support from your verified account.')}
                        />
                        <Divider />
                        <SettingsRow
                            label="Active sessions"
                            subtitle="Review where your account is signed in"
                            onPress={() => showSettingsNotice('Active sessions', 'You are currently signed in on this device.')}
                        />
                        <Divider />
                        <SettingsRow
                            label="Two-factor authentication"
                            subtitle="Add another layer of protection to your account"
                            onPress={() => showSettingsNotice('Two-factor authentication', 'Two-factor authentication will be available soon.')}
                        />
                    </SettingsSection>

                    {/* ── Subscription ── */}
                    <SettingsSection title="Subscription & payments">
                        <SettingsRow
                            label="Manage subscription"
                            subtitle="View your plan and billing details"
                            onPress={() => setShowManageSubscription(true)}
                        />
                        <Divider />
                        <SettingsRow
                            label="Restore purchases"
                            subtitle="Restore a previous premium purchase"
                            onPress={handleRestorePurchases}
                            right={restoring ? <ActivityIndicator size="small" color="#ff5470" /> : undefined}
                        />
                        <Divider />
                        <SettingsRow
                            label="Payment history"
                            subtitle="View invoices and completed payments"
                            onPress={() => setShowManageSubscription(true)}
                        />
                    </SettingsSection>

                    {/* ── Help & feedback ── */}
                    <SettingsSection title="Help & feedback">
                        <SettingsRow
                            label="Help center"
                            subtitle="Find answers to common questions"
                            onPress={() => Linking.openURL('https://openmatch.app/help')}
                        />
                        <Divider />
                        <SettingsRow
                            label="Report a problem"
                            subtitle="Tell us about a technical issue"
                            onPress={() => Linking.openURL('mailto:support@openmatch.app?subject=OpenMatch%20Issue')}
                        />
                        <Divider />
                        <SettingsRow
                            label="Contact Support"
                            subtitle="Get help from the OpenMatch team"
                            onPress={() => Linking.openURL('mailto:support@openmatch.app')}
                        />
                    </SettingsSection>

                    {/* ── Identity Verification ── */}
                    <SettingsSection title="Identity Verification">
                        <SettingsRow
                            label="Verification Status"
                            subtitle={
                                verificationStatus === 'verified'
                                    ? 'Verified ✅ — your badge is visible on your profile and in chat.'
                                    : verificationStatus === 'pending'
                                        ? 'Pending review ⏳ — a person is checking your documents. This usually takes under 24 hours, and your badge appears automatically. No need to resubmit.'
                                        : verificationStatus === 'rejected'
                                            ? 'Not confirmed ❌ — this is usually a blurry document or poor lighting rather than a problem with your ID. Tap to try again.'
                                            : 'Not verified — verified profiles are shown higher in search and get accepted more often. Tap to start.'
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

const makeStyles = (c: ThemeColors) => StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: c.headerBackground,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.headerBorder,
    },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: c.textPrimary },
    scroll: { paddingTop: 20 },
    inner: { maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center', paddingHorizontal: 16 },
    section: {
        marginBottom: 24,
        backgroundColor: c.cardBackground,
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.cardBorder,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 2,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: c.textMuted,
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
    rowPressed: { backgroundColor: c.background },
    rowLeft: { flex: 1, marginRight: 12 },
    rowLabel: { fontSize: 15, color: c.textPrimary },
    rowLabelDestructive: { color: '#ff5470' },
    rowSubtitle: { fontSize: 12, color: c.textMuted, marginTop: 2 },
    rowChevron: { fontSize: 20, color: c.textMuted, lineHeight: 24 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.cardBorder, marginLeft: 16 },
    themeSegment: {
        flexDirection: 'row',
        backgroundColor: c.background,
        borderRadius: 12,
        padding: 3,
        gap: 2,
    },
    themeSegmentItem: {
        alignItems: 'center',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    themeSegmentItemActive: {
        backgroundColor: c.cardBackground,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.cardBorder,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.12,
        shadowRadius: 2,
        elevation: 1,
    },
    themeSegmentIcon: { fontSize: 15 },
    themeSegmentLabel: { fontSize: 11, color: c.textMuted, fontWeight: '600', marginTop: 1 },
    themeSegmentLabelActive: { color: c.textPrimary, fontWeight: '800' },
    inlineForm: { paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
    inlineInput: {
        borderWidth: 1.5,
        borderColor: c.cardBorder,
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 11,
        fontSize: 15,
        color: c.textPrimary,
        backgroundColor: c.background,
    },
    inlineButton: {
        backgroundColor: c.accent,
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: 'center',
    },
    inlineButtonDisabled: { opacity: 0.6 },
    inlineButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

function useThemedStyles() {
    const { colors } = useTheme();
    return useMemo(() => makeStyles(colors), [colors]);
}
