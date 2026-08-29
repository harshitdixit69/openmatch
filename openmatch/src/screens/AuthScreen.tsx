import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';

import { AuthForm } from '../components/AuthForm';
import { ThemeToggle } from '../components/ThemeToggle';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';
import { trackEvent } from '../lib/analytics';
import { useTheme } from '../lib/theme';
import { AuroraBackground, GlassCard } from '../components/ui';
import { gradients, palette, spacing, typography } from '../lib/designSystem';

const INTRO_BENEFITS = [
    {
        icon: '🤖',
        title: 'AI-first matchmaking',
        body: 'Get matched on real compatibility, not just photos.',
    },
    {
        icon: '✅',
        title: 'Verified profiles',
        body: 'Phone-verified members and safety tools built in.',
    },
    {
        icon: '🎁',
        title: 'Free to start',
        body: 'Create your profile and see matches at no cost.',
    },
];

export function AuthScreen({
    onBrowseAsGuest,
    initialShowForm = false,
}: { onBrowseAsGuest?: () => void; initialShowForm?: boolean } = {}) {
    const { colors } = useTheme();
    const [showForm, setShowForm] = useState(initialShowForm);

    useEffect(() => {
        trackEvent('auth_screen_viewed');
        trackEvent('auth_intro_viewed');
    }, []);

    function handleGetStarted() {
        trackEvent('auth_get_started_tapped');
        setShowForm(true);
    }

    function handleBrowseAsGuest() {
        trackEvent('browse_as_guest_tapped');
        onBrowseAsGuest?.();
    }

    return (
        <View style={styles.safeArea}>
            <AuroraBackground style={StyleSheet.absoluteFill as never}>
                <View />
            </AuroraBackground>
            <SafeAreaView style={styles.safeArea}>
                <KeyboardAvoidingView
                    style={styles.container}
                    behavior={Platform.select({ ios: 'padding', android: undefined })}
                >
                    <View style={styles.topBar}>
                        <ThemeToggle />
                    </View>
                    <ScrollView
                        contentContainerStyle={styles.scrollContent}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    >
                        <View style={styles.contentColumn}>
                            <View style={styles.header}>
                                <View style={styles.logoRow}>
                                    <LinearGradient
                                        colors={gradients.primary as unknown as readonly [string, string, ...string[]]}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 1 }}
                                        style={styles.logoMark}
                                    >
                                        <Text style={styles.logoMarkText}>◈</Text>
                                    </LinearGradient>
                                    <Text style={[styles.title, { color: colors.textPrimary }]}>OpenMatch</Text>
                                </View>
                                <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                                    Fair matchmaking. AI-first. Verified phone authentication.
                                </Text>
                            </View>

                            {showForm ? (
                                <GlassCard strong style={styles.formCard}>
                                    <AuthForm />
                                </GlassCard>
                            ) : (
                                <View style={styles.introColumn}>
                                    <GlassCard strong style={styles.introCard}>
                                        {INTRO_BENEFITS.map((benefit) => (
                                            <View key={benefit.title} style={styles.benefitRow}>
                                                <Text style={styles.benefitIcon}>{benefit.icon}</Text>
                                                <View style={styles.benefitTextWrap}>
                                                    <Text style={[styles.benefitTitle, { color: colors.textPrimary }]}>
                                                        {benefit.title}
                                                    </Text>
                                                    <Text style={[styles.benefitBody, { color: colors.textSecondary }]}>
                                                        {benefit.body}
                                                    </Text>
                                                </View>
                                            </View>
                                        ))}
                                    </GlassCard>

                                    <Pressable style={styles.getStartedButton} onPress={handleGetStarted}>
                                        <LinearGradient
                                            colors={gradients.primary as unknown as readonly [string, string, ...string[]]}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 1, y: 1 }}
                                            style={StyleSheet.absoluteFill}
                                        />
                                        <Text style={styles.getStartedText}>Get Started</Text>
                                    </Pressable>

                                    <Pressable onPress={handleGetStarted} hitSlop={8}>
                                        <Text style={[styles.signInLink, { color: colors.textSecondary }]}>
                                            Already have an account? <Text style={styles.signInLinkStrong}>Sign in</Text>
                                        </Text>
                                    </Pressable>

                                    {onBrowseAsGuest && (
                                        <Pressable
                                            style={[styles.browseGuestButton, { borderColor: colors.cardBorder }]}
                                            onPress={handleBrowseAsGuest}
                                        >
                                            <Text style={[styles.browseGuestText, { color: colors.textPrimary }]}>
                                                Browse as guest
                                            </Text>
                                        </Pressable>
                                    )}
                                </View>
                            )}
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    container: {
        flex: 1,
    },
    topBar: {
        alignItems: 'flex-end',
        paddingHorizontal: 16,
        paddingTop: 8,
    },
    scrollContent: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: 20,
        paddingVertical: 24,
    },
    contentColumn: {
        alignSelf: 'center',
        gap: 24,
        maxWidth: MAX_CONTENT_WIDTH,
        width: '100%',
    },
    header: {
        alignItems: 'center',
        gap: spacing.md,
    },
    logoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    logoMark: {
        width: 46,
        height: 46,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    logoMarkText: {
        color: palette.white,
        fontSize: 24,
        fontWeight: '900',
    },
    title: {
        fontSize: 34,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    subtitle: {
        ...typography.body,
        lineHeight: 22,
        textAlign: 'center',
        paddingHorizontal: spacing.lg,
    },
    formCard: {
        padding: spacing.xl,
    },
    introColumn: {
        gap: spacing.lg,
        alignItems: 'stretch',
    },
    introCard: {
        padding: spacing.lg,
        gap: spacing.lg,
    },
    benefitRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
    },
    benefitIcon: {
        fontSize: 26,
        lineHeight: 32,
    },
    benefitTextWrap: {
        flex: 1,
        gap: 2,
    },
    benefitTitle: {
        fontSize: 16,
        fontWeight: '800',
    },
    benefitBody: {
        ...typography.body,
        lineHeight: 20,
    },
    getStartedButton: {
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 18,
        overflow: 'hidden',
        paddingVertical: 16,
    },
    getStartedText: {
        color: palette.white,
        fontSize: 17,
        fontWeight: '800',
    },
    signInLink: {
        ...typography.body,
        textAlign: 'center',
    },
    signInLinkStrong: {
        fontWeight: '800',
    },
    browseGuestButton: {
        alignItems: 'center',
        borderRadius: 16,
        borderWidth: 1,
        paddingVertical: 14,
    },
    browseGuestText: {
        fontSize: 15,
        fontWeight: '800',
    },
});
