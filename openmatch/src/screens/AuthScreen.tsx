import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthForm } from '../components/AuthForm';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';

export function AuthScreen() {
    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView
                style={styles.container}
                behavior={Platform.select({ ios: 'padding', android: undefined })}
            >
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.contentColumn}>
                        <View style={styles.header}>
                            <Text style={styles.title}>OpenMatch</Text>
                            <Text style={styles.subtitle}>Fair matchmaking. AI-first. No exploitative paywalls.</Text>
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
        backgroundColor: '#eff6f8',
        flex: 1,
    },
    container: {
        flex: 1,
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
        gap: 8,
    },
    title: {
        color: '#0e2e3a',
        fontSize: 34,
        fontWeight: '800',
    },
    subtitle: {
        color: '#4a6670',
        fontSize: 15,
        lineHeight: 22,
    },
});
