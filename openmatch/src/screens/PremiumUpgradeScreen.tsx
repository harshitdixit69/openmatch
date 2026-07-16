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
import { supabase } from '../lib/supabase';

interface Props {
    onBack: () => void;
}

type ActiveTier = 'plus' | 'vip';

interface SubscriptionPackage {
    id: string;
    months: number;
    priceINR: number;
    priceUSD: number;
    unlockCredits: number;
    aiCalls: number;
    savingsPercent?: number;
    isPopular?: boolean;
}

const PLUS_PACKAGES: SubscriptionPackage[] = [
    { id: 'plus_1m', months: 1, priceINR: 1499, priceUSD: 18, unlockCredits: 5, aiCalls: 0 },
    { id: 'plus_3m', months: 3, priceINR: 3499, priceUSD: 42, unlockCredits: 18, aiCalls: 0, savingsPercent: 22, isPopular: true },
    { id: 'plus_6m', months: 6, priceINR: 5999, priceUSD: 72, unlockCredits: 40, aiCalls: 0, savingsPercent: 33 },
    { id: 'plus_12m', months: 12, priceINR: 9999, priceUSD: 120, unlockCredits: 90, aiCalls: 0, savingsPercent: 44 },
];

const VIP_PACKAGES: SubscriptionPackage[] = [
    { id: 'vip_1m', months: 1, priceINR: 9999, priceUSD: 120, unlockCredits: 10, aiCalls: 2 },
    { id: 'vip_3m', months: 3, priceINR: 24999, priceUSD: 300, unlockCredits: 35, aiCalls: 8, savingsPercent: 17, isPopular: true },
    { id: 'vip_6m', months: 6, priceINR: 44999, priceUSD: 540, unlockCredits: 80, aiCalls: 20, savingsPercent: 25 },
    { id: 'vip_12m', months: 12, priceINR: 79999, priceUSD: 960, unlockCredits: 180, aiCalls: 50, savingsPercent: 33 },
];

export function PremiumUpgradeScreen({ onBack }: Props) {
    const [activeTier, setActiveTier] = useState<ActiveTier>('plus');
    const [selectedPackageId, setSelectedPackageId] = useState<string>('plus_3m');
    const [checkoutLoading, setCheckoutLoading] = useState(false);

    const packages = activeTier === 'plus' ? PLUS_PACKAGES : VIP_PACKAGES;
    const selectedPackage = packages.find(pkg => pkg.id === selectedPackageId) || packages[0];

    // Reset default package selection when switching tab tiers
    const handleTierChange = (tier: ActiveTier) => {
        setActiveTier(tier);
        setSelectedPackageId(tier === 'plus' ? 'plus_3m' : 'vip_3m');
    };

    const handleCheckout = async () => {
        setCheckoutLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('create-subscription-checkout', {
                body: {
                    packageTier: activeTier,
                    durationMonths: selectedPackage.months,
                    successUrl: Platform.OS === 'web' ? window.location.origin : undefined,
                    cancelUrl: Platform.OS === 'web' ? window.location.origin : undefined,
                },
            });

            if (error) throw error;
            if (data?.checkoutUrl) {
                if (Platform.OS === 'web') {
                    window.location.href = data.checkoutUrl;
                } else {
                    const supported = await Linking.canOpenURL(data.checkoutUrl);
                    if (supported) {
                        await Linking.openURL(data.checkoutUrl);
                    } else {
                        Alert.alert('Checkout Unavailable', 'Could not open Checkout page on this device.');
                    }
                }
            } else {
                throw new Error('No checkout URL returned from server.');
            }
        } catch (err: any) {
            Alert.alert('Payment Failed', err.message || 'Unable to start Stripe checkout session.');
        } finally {
            setCheckoutLoading(false);
        }
    };

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
                        onPress={() => handleTierChange('plus')}
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
                        onPress={() => handleTierChange('vip')}
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

                {/* Tiers Benefits List */}
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

                {/* Duration Block Package Selection List */}
                <View style={styles.packagesSection}>
                    <Text style={styles.packagesSectionTitle}>Select Duration Package</Text>
                    <View style={styles.packagesGrid}>
                        {packages.map((pkg) => {
                            const isSelected = pkg.id === selectedPackageId;
                            const priceText = Platform.OS === 'web' || Platform.OS === 'ios' || Platform.OS === 'android'
                                ? `₹${pkg.priceINR.toLocaleString('en-IN')}`
                                : `$${pkg.priceUSD}`;
                            const perMonthText = Platform.OS === 'web' || Platform.OS === 'ios' || Platform.OS === 'android'
                                ? `₹${Math.round(pkg.priceINR / pkg.months).toLocaleString('en-IN')}/mo`
                                : `$${Math.round(pkg.priceUSD / pkg.months)}/mo`;

                            return (
                                <Pressable
                                    key={pkg.id}
                                    style={[
                                        styles.packageCard,
                                        isSelected && styles.packageCardSelected,
                                    ]}
                                    onPress={() => setSelectedPackageId(pkg.id)}
                                >
                                    {pkg.isPopular && (
                                        <View style={styles.popularBadge}>
                                            <Text style={styles.popularBadgeText}>POPULAR</Text>
                                        </View>
                                    )}
                                    {pkg.savingsPercent && (
                                        <View style={styles.savingsBadge}>
                                            <Text style={styles.savingsBadgeText}>SAVE {pkg.savingsPercent}%</Text>
                                        </View>
                                    )}
                                    <Text style={styles.packageDuration}>{pkg.months} {pkg.months === 1 ? 'Month' : 'Months'}</Text>
                                    <Text style={styles.packagePrice}>{priceText}</Text>
                                    <Text style={styles.packagePerMonth}>{perMonthText}</Text>
                                    <View style={styles.packageCreditDetail}>
                                        <Text style={styles.packageCreditDetailText}>
                                            🔑 {pkg.unlockCredits} Unlock Credits
                                        </Text>
                                        {pkg.aiCalls > 0 && (
                                            <Text style={styles.packageCreditDetailText}>
                                                📞 {pkg.aiCalls} AI Voice Calls
                                            </Text>
                                        )}
                                    </View>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                {/* Checkout CTA */}
                <Pressable
                    style={[styles.checkoutBtn, checkoutLoading && styles.checkoutBtnDisabled]}
                    onPress={handleCheckout}
                    disabled={checkoutLoading}
                >
                    {checkoutLoading ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                        <Text style={styles.checkoutBtnText}>
                            Subscribe to {activeTier.toUpperCase()} ({selectedPackage.months} {selectedPackage.months === 1 ? 'Month' : 'Months'})
                        </Text>
                    )}
                </Pressable>
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
        paddingBottom: 48,
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
    packagesSection: {
        gap: 16,
    },
    packagesSectionTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: '#14313a',
    },
    packagesGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    packageCard: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        borderWidth: 2,
        borderColor: '#e1ebe8',
        padding: 16,
        width: '48%',
        flexGrow: 1,
        minWidth: 140,
        alignItems: 'center',
        position: 'relative',
        gap: 6,
    },
    packageCardSelected: {
        borderColor: '#d9643d',
        backgroundColor: '#fdf9f7',
    },
    popularBadge: {
        position: 'absolute',
        top: -10,
        backgroundColor: '#d9643d',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    popularBadgeText: {
        color: '#ffffff',
        fontSize: 9,
        fontWeight: '900',
    },
    savingsBadge: {
        position: 'absolute',
        top: -10,
        right: 10,
        backgroundColor: '#2e7d32',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
    },
    savingsBadgeText: {
        color: '#ffffff',
        fontSize: 8,
        fontWeight: '800',
    },
    packageDuration: {
        fontSize: 15,
        fontWeight: '800',
        color: '#14313a',
    },
    packagePrice: {
        fontSize: 20,
        fontWeight: '900',
        color: '#14313a',
    },
    packagePerMonth: {
        fontSize: 12,
        color: '#5d6d71',
        fontWeight: '600',
    },
    packageCreditDetail: {
        marginTop: 6,
        borderTopWidth: 1,
        borderTopColor: '#edf3f2',
        paddingTop: 6,
        width: '100%',
        alignItems: 'center',
        gap: 2,
    },
    packageCreditDetailText: {
        fontSize: 10.5,
        fontWeight: '700',
        color: '#2b525d',
    },
    checkoutBtn: {
        backgroundColor: '#d9643d',
        borderRadius: 24,
        height: 52,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 8,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
        elevation: 4,
    },
    checkoutBtnDisabled: {
        opacity: 0.6,
    },
    checkoutBtnText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '800',
    },
});
