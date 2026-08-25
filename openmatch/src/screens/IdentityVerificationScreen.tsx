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
import { captureLiveSelfie, pickGovtIdDocument } from '../lib/profilePhotoApi';
import { submitVerification } from '../lib/profileApi';
import { getFriendlyErrorMessage, showFriendlyAlert } from '../lib/errorUtils';

interface Props {
    onBack: () => void;
    onCompleted: (status: 'verified' | 'rejected' | 'pending') => void;
}

export function IdentityVerificationScreen({ onBack, onCompleted }: Props) {
    const insets = useSafeAreaInsets();
    const [idPhotoUri, setIdPhotoUri] = useState<string | null>(null);
    const [selfiePhotoUri, setSelfiePhotoUri] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function handlePickID() {
        try {
            const doc = await pickGovtIdDocument();
            if (doc?.uri) {
                // A PDF can still arrive via a renamed file or a stubborn native picker.
                // Reject it here with an actionable message rather than letting Gemini
                // fail later with an opaque 400.
                const isPdf = doc.mimeType === 'application/pdf'
                    || doc.fileName?.toLowerCase().endsWith('.pdf')
                    || doc.uri.toLowerCase().includes('.pdf');
                if (isPdf) {
                    showFriendlyAlert(
                        'Photo Required',
                        'PDF files can\'t be verified — official Aadhaar PDFs are password-protected and the photo inside is too small to match your selfie.\n\nPlease take a clear photo of your physical ID card instead, or upload a screenshot of it.',
                    );
                    return;
                }
                setIdPhotoUri(doc.uri);
            }
        } catch (err: any) {
            console.error('Failed to select ID photo:', err);
        }
    }

    async function handlePickSelfie() {
        try {
            // Live camera capture (liveness-lite) — deliberately NOT a library picker, so users
            // can't submit a downloaded photo of someone else.
            const photo = await captureLiveSelfie();
            if (photo?.uri) {
                setSelfiePhotoUri(photo.uri);
            }
        } catch (err: any) {
            console.error('Failed to capture selfie photo:', err);
            showFriendlyAlert('Camera Unavailable', err, 'Could not open the camera. Please enable camera access in your device settings.');
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
            setAiScanStep('complete');
            setSubmitting(false);

            // Allow React to paint the UI (hiding spinner) before showing blocking browser alert
            setTimeout(() => {
                if (result.status === 'approved') {
                    showFriendlyAlert('Identity Verified! 🎉', `AI Identity Verification Successful! ✅\n\n• Document Confidence: ${result.similarityScore.toFixed(0)}%\n• Facial Recognition Match: Confirmed\n• Verified Badge (✅) is now active on your profile.`);
                    onCompleted('verified');
                } else if (result.status === 'pending') {
                    showFriendlyAlert('Verification Under Review', result.reason || 'Your documents look genuine but need a quick manual review. Your verified badge will appear once approved — no need to resubmit.');
                    onCompleted('pending');
                } else if (result.status === 'error') {
                    // Transient failure — do NOT mark the user rejected. Let them retry.
                    showFriendlyAlert('Verification Unavailable', result.reason || 'The verification service is temporarily unavailable. Please try again in a moment.');
                    // Intentionally no onCompleted() — status is unchanged so the user can retry.
                } else {
                    showFriendlyAlert('Verification Failed', result.reason || 'Verification could not confirm identity. Please upload a clearer Govt ID and capture a well-lit live selfie.');
                    onCompleted('rejected');
                }
            }, 100);
        } catch (err: any) {
            clearTimeout(t1);
            clearTimeout(t2);
            setSubmitting(false);
            console.error('Verification failed:', err);
            setTimeout(() => {
                showFriendlyAlert('Verification Error', err, 'Verification upload failed. Please check your document and try again.');
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
                                <Image source={{ uri: idPhotoUri }} style={styles.previewImage} resizeMode="cover" />
                                <View style={styles.cardOverlay}>
                                    <Text style={styles.cardOverlayText}>Tap to Change ID</Text>
                                </View>
                            </View>
                        ) : (
                            <View style={styles.placeholderContainer}>
                                <Text style={styles.placeholderIcon}>🪪</Text>
                                <Text style={styles.placeholderTitle}>Government ID Document</Text>
                                <Text style={styles.placeholderSubtitle}>Clear photo of your ID (JPG or PNG)</Text>
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
                                <Text style={styles.placeholderSubtitle}>Tap to open camera</Text>
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
                        <ActivityIndicator size="large" color="#d4a853" style={{ marginBottom: 16 }} />
                        
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
        backgroundColor: '#0a0a0c',
    },
    header: {
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        backgroundColor: '#111015',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#d4a853',
    },
    container: {
        padding: 20,
    },
    infoText: {
        fontSize: 14,
        lineHeight: 20,
        color: '#8e8a9e',
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
        borderRadius: 14,
        backgroundColor: '#141318',
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.1)',
        borderStyle: 'dashed',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    cardActive: {
        borderColor: '#d4a853',
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
        fontWeight: '700',
        color: '#f0ece4',
        marginBottom: 4,
    },
    placeholderSubtitle: {
        fontSize: 12,
        color: '#8e8a9e',
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
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardOverlayText: {
        color: '#d4a853',
        fontSize: 14,
        fontWeight: '700',
    },
    actionContainer: {
        gap: 12,
    },
    submitButton: {
        height: 50,
        borderRadius: 25,
        backgroundColor: '#d4a853',
        justifyContent: 'center',
        alignItems: 'center',
    },
    submitButtonDisabled: {
        backgroundColor: 'rgba(212,168,83,0.3)',
    },
    submitButtonText: {
        color: '#0a0a0c',
        fontSize: 16,
        fontWeight: '800',
    },
    cancelButton: {
        height: 50,
        borderRadius: 25,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    cancelButtonText: {
        color: '#8e8a9e',
        fontSize: 16,
        fontWeight: '600',
    },
    spinnerOverlay: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999,
    },
    spinnerCard: {
        padding: 24,
        backgroundColor: '#141318',
        borderRadius: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    spinnerText: {
        fontSize: 18,
        fontWeight: '800',
        color: '#d4a853',
        marginBottom: 16,
    },
    scanStepList: {
        alignItems: 'flex-start',
        gap: 10,
        width: '100%',
    },
    scanStep: {
        fontSize: 14,
        color: '#8e8a9e',
        fontWeight: '500',
    },
    scanStepActive: {
        color: '#d4a853',
        fontWeight: '800',
    },
});
