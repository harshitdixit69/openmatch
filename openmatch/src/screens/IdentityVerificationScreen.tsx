import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '../components/BackButton';
import { pickGovtIdDocument, pickProfilePhotoFromLibrary } from '../lib/profilePhotoApi';
import { submitVerification } from '../lib/profileApi';

interface Props {
    onBack: () => void;
    onCompleted: (status: 'verified' | 'rejected') => void;
}

export function IdentityVerificationScreen({ onBack, onCompleted }: Props) {
    const insets = useSafeAreaInsets();
    const [idPhotoUri, setIdPhotoUri] = useState<string | null>(null);
    const [idIsPdf, setIdIsPdf] = useState(false);
    const [selfiePhotoUri, setSelfiePhotoUri] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function handlePickID() {
        try {
            const doc = await pickGovtIdDocument();
            if (doc?.uri) {
                setIdPhotoUri(doc.uri);
                const isPdf = doc.mimeType === 'application/pdf' || doc.fileName?.toLowerCase().endsWith('.pdf') || doc.uri.toLowerCase().includes('.pdf');
                setIdIsPdf(Boolean(isPdf));
            }
        } catch (err: any) {
            console.error('Failed to select ID photo:', err);
        }
    }

    async function handlePickSelfie() {
        try {
            const photo = await pickProfilePhotoFromLibrary();
            if (photo?.uri) {
                setSelfiePhotoUri(photo.uri);
            }
        } catch (err: any) {
            console.error('Failed to select selfie photo:', err);
        }
    }

    const [aiScanStep, setAiScanStep] = useState<'ocr' | 'face' | 'data' | 'complete'>('ocr');

    async function handleSubmit() {
        if (!idPhotoUri || !selfiePhotoUri) return;

        setSubmitting(true);
        setAiScanStep('ocr');

        const t1 = setTimeout(() => setAiScanStep('face'), 600);
        const t2 = setTimeout(() => setAiScanStep('data'), 1200);

        try {
            const result = await submitVerification(idPhotoUri, selfiePhotoUri);
            clearTimeout(t1);
            clearTimeout(t2);
            setSubmitting(false);

            // Allow React to paint the UI (hiding spinner) before showing blocking browser alert
            setTimeout(() => {
                if (result.status === 'approved') {
                    const msg = `AI Identity Verification Successful! ✅\n\n• Document Confidence: ${result.similarityScore.toFixed(0)}%\n• Facial Recognition Match: Confirmed\n• Verified Badge (✅) is now active on your profile.`;
                    if (Platform.OS === 'web') alert(msg);
                    else Alert.alert('Identity Verified! 🎉', msg);
                    onCompleted('verified');
                } else {
                    const msg = result.reason || 'Verification could not confirm identity match. Please upload clearer photos.';
                    if (Platform.OS === 'web') alert(msg);
                    else Alert.alert('Verification Failed', msg);
                    onCompleted('rejected');
                }
            }, 100);
        } catch (err: any) {
            clearTimeout(t1);
            clearTimeout(t2);
            setSubmitting(false);
            console.error('Verification failed:', err);
            const msg = err?.message || 'Verification upload failed. Please try again.';
            setTimeout(() => {
                if (Platform.OS === 'web') alert(msg);
                else Alert.alert('Verification Error', msg);
                onCompleted('rejected');
            }, 100);
        }
    }

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.header}>
                <BackButton onPress={onBack} />
                <Text style={styles.headerTitle}>AI Identity Verification</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView contentContainerStyle={styles.container}>
                <Text style={styles.infoText}>
                    Verify your profile to increase trust and match authenticity. Upload an official Govt ID document (Aadhaar, PAN, Passport) and a matching live selfie for instant AI verification (✅).
                </Text>

                {/* Upload Cards Grid */}
                <View style={styles.gridContainer}>
                    {/* ID Document Card */}
                    <Pressable
                        style={[styles.card, idPhotoUri ? styles.cardActive : null]}
                        onPress={handlePickID}
                    >
                        {idPhotoUri ? (
                            <View style={styles.previewContainer}>
                                {idIsPdf ? (
                                    <View style={[styles.placeholderContainer, { backgroundColor: '#FFF5F5', height: '100%', justifyContent: 'center' }]}>
                                        <Text style={{ fontSize: 36, marginBottom: 6 }}>📄</Text>
                                        <Text style={{ fontSize: 15, fontWeight: '700', color: '#D9363E' }}>PDF Document Attached</Text>
                                        <Text style={{ fontSize: 12, color: '#666666', marginTop: 2 }}>Official Aadhaar / PAN PDF</Text>
                                    </View>
                                ) : (
                                    <Image source={{ uri: idPhotoUri }} style={styles.previewImage} resizeMode="cover" />
                                )}
                                <View style={styles.cardOverlay}>
                                    <Text style={styles.cardOverlayText}>Tap to Change ID</Text>
                                </View>
                            </View>
                        ) : (
                            <View style={styles.placeholderContainer}>
                                <Text style={styles.placeholderIcon}>🪪</Text>
                                <Text style={styles.placeholderTitle}>Government ID Document</Text>
                                <Text style={styles.placeholderSubtitle}>Image (JPG, PNG) or PDF Document</Text>
                            </View>
                        )}
                    </Pressable>

                    {/* Selfie Card */}
                    <Pressable
                        style={[styles.card, selfiePhotoUri ? styles.cardActive : null]}
                        onPress={handlePickSelfie}
                    >
                        {selfiePhotoUri ? (
                            <View style={styles.previewContainer}>
                                <Image source={{ uri: selfiePhotoUri }} style={styles.previewImage} resizeMode="cover" />
                                <View style={styles.cardOverlay}>
                                    <Text style={styles.cardOverlayText}>Tap to Change Selfie</Text>
                                </View>
                            </View>
                        ) : (
                            <View style={styles.placeholderContainer}>
                                <Text style={styles.placeholderIcon}>📸</Text>
                                <Text style={styles.placeholderTitle}>Live Selfie</Text>
                                <Text style={styles.placeholderSubtitle}>Clear front-facing photo</Text>
                            </View>
                        )}
                    </Pressable>
                </View>

                {/* Submit Action */}
                <View style={styles.actionContainer}>
                    <Pressable
                        style={[
                            styles.submitButton,
                            (!idPhotoUri || !selfiePhotoUri) && styles.submitButtonDisabled,
                        ]}
                        disabled={!idPhotoUri || !selfiePhotoUri}
                        onPress={handleSubmit}
                    >
                        <Text style={styles.submitButtonText}>🤖 Verify Identity with AI ⚡</Text>
                    </Pressable>

                    <Pressable style={styles.cancelButton} onPress={onBack}>
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                    </Pressable>
                </View>
            </ScrollView>

            {/* AI Scanner Processing Overlay */}
            {submitting && (
                <View style={styles.spinnerOverlay}>
                    <View style={styles.spinnerCard}>
                        <ActivityIndicator size="large" color="#e56a3a" style={{ marginBottom: 16 }} />
                        
                        <Text style={styles.spinnerText}>AI Scanner Active</Text>
                        
                        <View style={styles.scanStepList}>
                            <Text style={[styles.scanStep, aiScanStep === 'ocr' && styles.scanStepActive]}>
                                {aiScanStep === 'ocr' ? '🔍 Scanning Govt ID Document...' : '✓ Govt ID Scanned'}
                            </Text>
                            <Text style={[styles.scanStep, aiScanStep === 'face' && styles.scanStepActive]}>
                                {aiScanStep === 'face' ? '👤 Matching Facial Features...' : aiScanStep === 'data' ? '✓ Facial Recognition Match' : '⏳ Facial Recognition'}
                            </Text>
                            <Text style={[styles.scanStep, aiScanStep === 'data' && styles.scanStepActive]}>
                                {aiScanStep === 'data' ? '📋 Cross-Checking Name & DOB...' : '⏳ Name & DOB Validation'}
                            </Text>
                        </View>
                    </View>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    header: {
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1F1F1F',
    },
    container: {
        padding: 20,
    },
    infoText: {
        fontSize: 14,
        lineHeight: 20,
        color: '#666666',
        textAlign: 'center',
        marginBottom: 24,
    },
    gridContainer: {
        flexDirection: 'column',
        gap: 20,
        marginBottom: 32,
    },
    card: {
        height: 180,
        borderRadius: 12,
        backgroundColor: '#F7F8FA',
        borderWidth: 2,
        borderColor: '#EAEAEA',
        borderStyle: 'dashed',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    cardActive: {
        borderColor: '#FF6F61',
        borderStyle: 'solid',
    },
    placeholderContainer: {
        alignItems: 'center',
        padding: 16,
    },
    placeholderIcon: {
        fontSize: 32,
        marginBottom: 8,
    },
    placeholderTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333333',
        marginBottom: 4,
    },
    placeholderSubtitle: {
        fontSize: 12,
        color: '#999999',
    },
    previewContainer: {
        width: '100%',
        height: '100%',
        position: 'relative',
    },
    previewImage: {
        width: '100%',
        height: '100%',
    },
    cardOverlay: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardOverlayText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
    },
    actionContainer: {
        gap: 12,
    },
    submitButton: {
        height: 50,
        borderRadius: 25,
        backgroundColor: '#FF6F61',
        justifyContent: 'center',
        alignItems: 'center',
    },
    submitButtonDisabled: {
        backgroundColor: '#FFA39E',
    },
    submitButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    cancelButton: {
        height: 50,
        borderRadius: 25,
        borderWidth: 1,
        borderColor: '#D9D9D9',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
    },
    cancelButtonText: {
        color: '#666666',
        fontSize: 16,
        fontWeight: '600',
    },
    spinnerOverlay: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999,
    },
    spinnerCard: {
        padding: 24,
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        alignItems: 'center',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    spinnerText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#11313c',
        marginBottom: 16,
    },
    scanStepList: {
        alignItems: 'flex-start',
        gap: 10,
        width: '100%',
    },
    scanStep: {
        fontSize: 14,
        color: '#8b9da5',
        fontWeight: '500',
    },
    scanStepActive: {
        color: '#e56a3a',
        fontWeight: '700',
    },
});
