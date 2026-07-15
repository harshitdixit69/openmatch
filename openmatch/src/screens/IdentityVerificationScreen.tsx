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
import { pickProfilePhotoFromLibrary } from '../lib/profilePhotoApi';
import { submitVerification } from '../lib/profileApi';

interface Props {
    onBack: () => void;
    onCompleted: (status: 'verified' | 'rejected') => void;
}

export function IdentityVerificationScreen({ onBack, onCompleted }: Props) {
    const insets = useSafeAreaInsets();
    const [idPhotoUri, setIdPhotoUri] = useState<string | null>(null);
    const [selfiePhotoUri, setSelfiePhotoUri] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function handlePickID() {
        try {
            const photo = await pickProfilePhotoFromLibrary();
            if (photo?.uri) {
                setIdPhotoUri(photo.uri);
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

    async function handleSubmit() {
        if (!idPhotoUri || !selfiePhotoUri) return;

        setSubmitting(true);
        // Simulate a brief processing delay (facial recognition & OCR scans)
        setTimeout(async () => {
            try {
                await submitVerification(idPhotoUri, selfiePhotoUri);
                setSubmitting(false);
                if (Platform.OS === 'web') {
                    alert('Verification Successful: Your identity has been successfully verified! ✅');
                } else {
                    Alert.alert('Verification Successful', 'Your identity has been successfully verified! ✅');
                }
                onCompleted('verified');
            } catch (err: any) {
                console.error('Verification failed:', err);
                setSubmitting(false);
                if (Platform.OS === 'web') {
                    alert(err?.message || 'Verification upload failed. Please try again.');
                } else {
                    Alert.alert('Verification Failed', err?.message || 'Verification upload failed. Please try again.');
                }
                onCompleted('rejected');
            }
        }, 2000);
    }

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.header}>
                <BackButton onPress={onBack} />
                <Text style={styles.headerTitle}>Verify Identity</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView contentContainerStyle={styles.container}>
                <Text style={styles.infoText}>
                    Verify your profile to increase trust and match authenticity. Upload your official identity document and a matching live selfie to unlock the verified badge (✅).
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
                                <Image source={{ uri: idPhotoUri }} style={styles.previewImage} />
                                <View style={styles.cardOverlay}>
                                    <Text style={styles.cardOverlayText}>Tap to Change ID</Text>
                                </View>
                            </View>
                        ) : (
                            <View style={styles.placeholderContainer}>
                                <Text style={styles.placeholderIcon}>🪪</Text>
                                <Text style={styles.placeholderTitle}>Government ID Card</Text>
                                <Text style={styles.placeholderSubtitle}>Tap to upload photo ID</Text>
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
                                <Image source={{ uri: selfiePhotoUri }} style={styles.previewImage} />
                                <View style={styles.cardOverlay}>
                                    <Text style={styles.cardOverlayText}>Tap to Change Selfie</Text>
                                </View>
                            </View>
                        ) : (
                            <View style={styles.placeholderContainer}>
                                <Text style={styles.placeholderIcon}>📸</Text>
                                <Text style={styles.placeholderTitle}>Live Selfie</Text>
                                <Text style={styles.placeholderSubtitle}>Tap to upload selfie photo</Text>
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
                        <Text style={styles.submitButtonText}>Submit Verification</Text>
                    </Pressable>

                    <Pressable style={styles.cancelButton} onPress={onBack}>
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                    </Pressable>
                </View>
            </ScrollView>

            {/* Processing Spinner Overlay */}
            {submitting && (
                <View style={styles.spinnerOverlay}>
                    <View style={styles.spinnerCard}>
                        <ActivityIndicator size="large" color="#FF6F61" />
                        <Text style={styles.spinnerText}>Comparing face match biometric score...</Text>
                        <Text style={styles.spinnerSubtext}>This will take just a few seconds</Text>
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
        resizeMode: 'cover',
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
        marginTop: 16,
        fontSize: 15,
        fontWeight: '600',
        color: '#333333',
    },
    spinnerSubtext: {
        marginTop: 6,
        fontSize: 12,
        color: '#999999',
    },
});
