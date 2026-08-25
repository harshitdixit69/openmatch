import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { LinearGradient } from 'expo-linear-gradient';

import { AuthForm } from '../components/AuthForm';
import { ThemeToggle } from '../components/ThemeToggle';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';
import { trackEvent } from '../lib/analytics';
import { useTheme } from '../lib/theme';
import { AuroraBackground, GlassCard } from '../components/ui';
import { gradients, palette, spacing, typography } from '../lib/designSystem';

export function AuthScreen() {
    const { colors } = useTheme();

    useEffect(() => {
        trackEvent('auth_screen_viewed');
    }, []);

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
                            <GlassCard strong style={styles.formCard}>
                                <AuthForm />
                            </GlassCard>
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
});
