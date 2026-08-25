import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect } from 'react';

import { AuthForm } from '../components/AuthForm';
import { ThemeToggle } from '../components/ThemeToggle';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';
import { trackEvent } from '../lib/analytics';
import { useTheme } from '../lib/theme';

export function AuthScreen() {
    const { colors } = useTheme();

    useEffect(() => {
        trackEvent('auth_screen_viewed');
    }, []);

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
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
                            <Text style={[styles.title, { color: colors.accent }]}>OpenMatch</Text>
                            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                                Fair matchmaking. AI-first. Verified phone authentication.
                            </Text>
                        </View>
                        <AuthForm />
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
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
        gap: 20,
        maxWidth: MAX_CONTENT_WIDTH,
        width: '100%',
    },
    header: {
        alignItems: 'center',
        gap: 8,
    },
    title: {
        fontSize: 34,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: 15,
        lineHeight: 22,
        textAlign: 'center',
    },
});
