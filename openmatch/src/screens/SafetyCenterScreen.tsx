// src/screens/SafetyCenterScreen.tsx
//
// The Settings row used to open https://openmatch.app/safety, which is not a
// live site. The content lives in-app so the row can never become a dead link.
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '../components/BackButton';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';

export const SUPPORT_EMAIL = 'support@openmatch.app';

type SafetyTopic = {
    title: string;
    points: string[];
};

export const SAFETY_TOPICS: SafetyTopic[] = [
    {
        title: 'Before you share contact details',
        points: [
            'OpenMatch keeps phone numbers hidden until both people complete a mutual unlock. You never have to share first.',
            'Take your time in chat. Anyone pressuring you to move to WhatsApp or Telegram immediately is a warning sign.',
            'Video call before meeting. It is the fastest way to confirm someone is who their photos say they are.',
        ],
    },
    {
        title: 'Money is the reddest flag',
        points: [
            'Never send money, gift cards, or crypto to someone you met here — no matter the emergency described.',
            'Ignore investment or trading "tips" from a match. This is the most common scam on dating apps.',
            'OpenMatch will never ask for your password, OTP, or payment details over chat.',
        ],
    },
    {
        title: 'Meeting in person',
        points: [
            'Meet in a public place for the first few dates, and arrange your own transport there and back.',
            'Tell a friend or family member where you are going and when you expect to be back.',
            'Trust your instincts. You never owe anyone an explanation for leaving early.',
        ],
    },
    {
        title: 'Tools you already have',
        points: [
            'Block from any chat or profile to remove someone from your feed and stop them contacting you.',
            'Report harassment, scams, fake profiles, or underage accounts — reports are reviewed and are not shared with the person you report.',
            'Turn off Profile visibility in Settings to pause appearing in new feeds without deleting your account.',
        ],
    },
];

export function SafetyCenterScreen({ onBack }: { onBack: () => void }) {
    const insets = useSafeAreaInsets();

    return (
        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <BackButton onPress={onBack} />
                <Text style={styles.headerTitle}>Safety center</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView
                contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.inner}>
                    <Text style={styles.intro}>
                        Most people here are genuine. These are the habits that keep the rest from becoming your problem.
                    </Text>

                    {SAFETY_TOPICS.map((topic) => (
                        <View key={topic.title} style={styles.card}>
                            <Text style={styles.cardTitle}>{topic.title}</Text>
                            {topic.points.map((point) => (
                                <View key={point} style={styles.pointRow}>
                                    <View style={styles.bullet} />
                                    <Text style={styles.pointText}>{point}</Text>
                                </View>
                            ))}
                        </View>
                    ))}

                    <View style={[styles.card, styles.urgentCard]}>
                        <Text style={styles.cardTitle}>If you are in immediate danger</Text>
                        <Text style={styles.pointText}>
                            Contact your local emergency services first. Once you are safe, report the account so we can act on it.
                        </Text>
                        <Pressable
                            style={({ pressed }) => [styles.contactButton, pressed ? styles.contactButtonPressed : null]}
                            onPress={() =>
                                void Linking.openURL(
                                    `mailto:${SUPPORT_EMAIL}?subject=Urgent%20safety%20concern`,
                                )
                            }
                            accessibilityRole="button"
                            accessibilityLabel="Email the OpenMatch safety team"
                        >
                            <Text style={styles.contactButtonText}>Email the safety team</Text>
                        </Pressable>
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: { backgroundColor: '#0a0a0c', flex: 1 },
    header: {
        alignItems: 'center',
        backgroundColor: '#111015',
        borderBottomColor: 'rgba(255,255,255,0.08)',
        borderBottomWidth: 1,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    headerTitle: { color: '#d4a853', fontSize: 17, fontWeight: '800' },
    scroll: { paddingTop: 16 },
    inner: {
        alignSelf: 'center',
        gap: 14,
        maxWidth: MAX_CONTENT_WIDTH,
        paddingHorizontal: 16,
        width: '100%',
    },
    intro: { color: '#8e8a9e', fontSize: 15, lineHeight: 23, paddingHorizontal: 2 },
    card: { backgroundColor: '#141318', borderRadius: 14, gap: 10, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
    urgentCard: { backgroundColor: '#1a1318', borderColor: 'rgba(212,168,83,0.3)' },
    cardTitle: { color: '#f0ece4', fontSize: 16, fontWeight: '700' },
    pointRow: { flexDirection: 'row', gap: 10 },
    bullet: {
        backgroundColor: '#d4a853',
        borderRadius: 999,
        height: 6,
        marginTop: 8,
        width: 6,
    },
    pointText: { color: '#8e8a9e', flex: 1, fontSize: 14, lineHeight: 21 },
    contactButton: {
        alignItems: 'center',
        backgroundColor: '#d4a853',
        borderRadius: 12,
        marginTop: 4,
        paddingVertical: 12,
    },
    contactButtonPressed: { opacity: 0.85 },
    contactButtonText: { color: '#0a0a0c', fontSize: 14, fontWeight: '800' },
});
