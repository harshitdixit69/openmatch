// src/screens/PremiumUpgradeScreen.tsx
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Linking,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton } from '../components/BackButton';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';

interface Props {
    onBack: () => void;
}

type ActiveTier = 'plus' | 'vip';

export function PremiumUpgradeScreen({ onBack }: Props) {
    const [activeTier, setActiveTier] = useState<ActiveTier>('plus');
    const [checkoutLoading, setCheckoutLoading] = useState(false);

    return (
        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
            {/* Header */}
            <View style={styles.header}>
                <BackButton onPress={onBack} />
                <Text style={styles.headerTitle}>Premium Upgrades</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Intro Card */}
                <View style={styles.introCard}>
                    <Text style={styles.introEyebrow}>Enhance Your Journey</Text>
                    <Text style={styles.introTitle}>Fair upgrades, zero lockouts</Text>
                    <Text style={styles.introBody}>
                        Choose the premium tier that fits your pacing. The core matching, chats, and mutual unlocks remain completely free for everyone.
                    </Text>
                </View>

                {/* Segmented Controller Toggle */}
                <View style={styles.toggleContainer}>
                    <Pressable
                        style={[
                            styles.toggleSegment,
                            activeTier === 'plus' && styles.toggleSegmentActive,
                        ]}
                        onPress={() => setActiveTier('plus')}
                    >
                        <Text
                            style={[
                                styles.toggleText,
                                activeTier === 'plus' && styles.toggleTextActive,
                            ]}
                        >
                            Self-Service (Plus)
                        </Text>
                    </Pressable>
                    <Pressable
                        style={[
                            styles.toggleSegment,
                            activeTier === 'vip' && styles.toggleSegmentActive,
                        ]}
                        onPress={() => setActiveTier('vip')}
                    >
                        <Text
                            style={[
                                styles.toggleText,
                                activeTier === 'vip' && styles.toggleTextActive,
                            ]}
                        >
                            Assisted (VIP)
                        </Text>
                    </Pressable>
                </View>

                {/* Viewable State Details */}
                {activeTier === 'plus' ? (
                    <View style={styles.tierInfoContainer}>
                        <Text style={styles.tierSectionTitle}>Plus Features (Self-Service)</Text>
                        <View style={styles.featureItem}>
                            <Text style={styles.featureCheck}>✓</Text>
                            <View style={styles.featureDetails}>
                                <Text style={styles.featureTitle}>Upfront Unlock Credits</Text>
                                <Text style={styles.featureDescription}>
                                    Includes a bundle of manual contact unlock credits. Skip individual transaction micro-payments.
                                </Text>
                            </View>
                        </View>
                        <View style={styles.featureItem}>
                            <Text style={styles.featureCheck}>✓</Text>
                            <View style={styles.featureDetails}>
                                <Text style={styles.featureTitle}>Verification Priority</Text>
                                <Text style={styles.featureDescription}>
                                    Your uploaded government ID verification requests get reviewed and processed first.
                                </Text>
                            </View>
                        </View>
                    </View>
                ) : (
                    <View style={styles.tierInfoContainer}>
                        <Text style={styles.tierSectionTitle}>VIP Features (Assisted)</Text>
                        <View style={styles.featureItem}>
                            <Text style={styles.featureCheck}>★</Text>
                            <View style={styles.featureDetails}>
                                <Text style={styles.featureTitle}>AI Voice Broker Calls</Text>
                                <Text style={styles.featureDescription}>
                                    Outsource the coordination friction. Our AI Voice Broker reaches out to match candidates to gather feedback.
                                </Text>
                            </View>
                        </View>
                        <View style={styles.featureItem}>
                            <Text style={styles.featureCheck}>★</Text>
                            <View style={styles.featureDetails}>
                                <Text style={styles.featureTitle}>Everything in Plus Included</Text>
                                <Text style={styles.featureDescription}>
                                    Receive all manual unlock credits, premium highlights, and priority verification benefits.
                                </Text>
                            </View>
                        </View>
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#eef4f2',
    },
    header: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#d6e1df',
        backgroundColor: '#ffffff',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#14313a',
    },
    scrollContent: {
        alignSelf: 'center',
        width: '100%',
        maxWidth: MAX_CONTENT_WIDTH,
        paddingHorizontal: 20,
        paddingVertical: 24,
        gap: 24,
    },
    introCard: {
        backgroundColor: '#14313a',
        borderRadius: 24,
        padding: 24,
        gap: 8,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 4,
    },
    introEyebrow: {
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
        color: '#f9a159',
        letterSpacing: 1.5,
    },
    introTitle: {
        fontSize: 24,
        fontWeight: '800',
        color: '#ffffff',
    },
    introBody: {
        fontSize: 14,
        color: '#c7d6d8',
        lineHeight: 20,
    },
    toggleContainer: {
        flexDirection: 'row',
        backgroundColor: '#e1ebe8',
        borderRadius: 16,
        padding: 4,
    },
    toggleSegment: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        borderRadius: 12,
    },
    toggleSegmentActive: {
        backgroundColor: '#ffffff',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
    },
    toggleText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#5d7075',
    },
    toggleTextActive: {
        color: '#14313a',
    },
    tierInfoContainer: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        padding: 20,
        gap: 20,
        borderWidth: 1,
        borderColor: '#e1ebe8',
    },
    tierSectionTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: '#14313a',
        borderBottomWidth: 1,
        borderBottomColor: '#edf3f2',
        paddingBottom: 8,
    },
    featureItem: {
        flexDirection: 'row',
        gap: 16,
    },
    featureCheck: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#d9643d',
        marginTop: 2,
    },
    featureDetails: {
        flex: 1,
        gap: 4,
    },
    featureTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#14313a',
    },
    featureDescription: {
        fontSize: 13,
        color: '#5d6d71',
        lineHeight: 18,
    },
});
