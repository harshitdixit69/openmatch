import { useMemo, useState } from 'react';
import {
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '../components/BackButton';
import { runOnboardingCopilot } from '../lib/aiApi';
import {
    getDefaultPartnerGenderPreference,
    getDisplayFirstName,
    OnboardingCopilotResult,
    partnerGenderPreferences,
    ProfileInput,
    profileGenders,
    ProfileOwner,
} from '../lib/profile';
import {
    maxProfilePhotos,
    pickProfilePhotoFromLibrary,
    PickedProfilePhoto,
    uploadCurrentUserProfilePhotos,
} from '../lib/profilePhotoApi';
import { upsertCurrentProfile, upsertCurrentProfileContactDetails } from '../lib/profileApi';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';
import { supabase } from '../lib/supabase';

const owners: ProfileOwner[] = ['self', 'parent', 'sibling', 'relative'];

type OnboardingScreenProps = {
    onComplete: () => void;
};

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
    const [step, setStep] = useState(0);
    const [loading, setLoading] = useState(false);
    const [copilotLoading, setCopilotLoading] = useState(false);
    const [copilotResult, setCopilotResult] = useState<OnboardingCopilotResult | null>(null);
    const [selectedPhotos, setSelectedPhotos] = useState<PickedProfilePhoto[]>([]);
    const [addingPhoto, setAddingPhoto] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [whatsappNumber, setWhatsappNumber] = useState('');
    const [form, setForm] = useState<ProfileInput>({
        full_name: '',
        gender: '',
        partner_gender_preference: '',
        photo_urls: [],
        dob: '',
        location: '',
        bio: '',
        preferences: '',
        height_cm: 165,
        profile_owner: 'self',
    });

    const profileDisplayName = getDisplayFirstName(form.full_name);

    const steps = useMemo(
        () => [
            {
                title: 'Basics',
                description: 'Tell us who this profile is for, who they want to meet, and where they live.',
                content: (
                    <>
                        <Field label="Full name">
                            <TextInput
                                placeholder="Aarav Sharma"
                                placeholderTextColor="#7b8d96"
                                style={styles.input}
                                value={form.full_name}
                                onChangeText={(value) => updateField('full_name', value)}
                            />
                        </Field>

                        <Field label="I'm a">
                            <View style={styles.choiceRow}>
                                {profileGenders.map((gender) => (
                                    <Chip
                                        key={gender}
                                        active={form.gender === gender}
                                        label={gender}
                                        onPress={() => updateGender(gender)}
                                    />
                                ))}
                            </View>
                        </Field>

                        <Field label="Looking for a">
                            <View style={styles.choiceRow}>
                                {partnerGenderPreferences.map((preference) => (
                                    <Chip
                                        key={preference}
                                        active={form.partner_gender_preference === preference}
                                        label={preference}
                                        onPress={() => updateField('partner_gender_preference', preference)}
                                    />
                                ))}
                            </View>
                            <Text style={styles.helper}>This keeps the feed aligned with the profiles you want to see.</Text>
                        </Field>

                        <Field label="Profile owner">
                            <View style={styles.choiceRow}>
                                {owners.map((owner) => (
                                    <Chip
                                        key={owner}
                                        active={form.profile_owner === owner}
                                        label={owner}
                                        onPress={() => updateField('profile_owner', owner)}
                                    />
                                ))}
                            </View>
                        </Field>

                        <Field label="Location">
                            <TextInput
                                placeholder="Pune, Maharashtra"
                                placeholderTextColor="#7b8d96"
                                style={styles.input}
                                value={form.location}
                                onChangeText={(value) => updateField('location', value)}
                            />
                        </Field>
                    </>
                ),
            },
            {
                title: 'Photos',
                description: 'Add clear photos so matches can recognize the person behind the profile.',
                content: (
                    <>
                        <Field label="Profile photos">
                            <View style={styles.photoGrid}>
                                {selectedPhotos.map((photo) => (
                                    <View key={photo.id} style={styles.photoCard}>
                                        <Image source={{ uri: photo.uri }} style={styles.photoImage} />

                                        <Pressable
                                            style={styles.removePhotoButton}
                                            onPress={() => removePhoto(photo.id)}
                                            disabled={loading || addingPhoto}
                                        >
                                            <Text style={styles.removePhotoButtonText}>Remove</Text>
                                        </Pressable>
                                    </View>
                                ))}

                                {selectedPhotos.length < maxProfilePhotos ? (
                                    <Pressable
                                        style={[styles.addPhotoCard, (loading || addingPhoto) && styles.disabledCard]}
                                        onPress={() => void handleAddPhoto()}
                                        disabled={loading || addingPhoto}
                                    >
                                        <Text style={styles.addPhotoSymbol}>+</Text>
                                        <Text style={styles.addPhotoLabel}>{addingPhoto ? 'Adding...' : 'Add photo'}</Text>
                                    </Pressable>
                                ) : null}
                            </View>

                            <Text style={styles.helper}>
                                Add up to {maxProfilePhotos} photos. The first photo appears in the feed cards.
                            </Text>
                        </Field>
                    </>
                ),
            },
            {
                title: 'Profile details',
                description: 'Add age-related details and a short introduction.',
                content: (
                    <>
                        <Field label="Date of birth">
                            <TextInput
                                placeholder="1997-08-14"
                                placeholderTextColor="#7b8d96"
                                style={styles.input}
                                value={form.dob}
                                onChangeText={(value) => updateField('dob', value)}
                            />
                            <Text style={styles.helper}>Use YYYY-MM-DD so it maps cleanly to Supabase.</Text>
                        </Field>

                        <Field label="Height (cm)">
                            <TextInput
                                keyboardType="number-pad"
                                placeholder="165"
                                placeholderTextColor="#7b8d96"
                                style={styles.input}
                                value={String(form.height_cm)}
                                onChangeText={(value) => updateField('height_cm', Number(value || 0))}
                            />
                        </Field>

                        <Field label="Bio">
                            <TextInput
                                multiline
                                placeholder="Share family background, work, personality, and lifestyle."
                                placeholderTextColor="#7b8d96"
                                style={[styles.input, styles.textarea]}
                                textAlignVertical="top"
                                value={form.bio}
                                onChangeText={(value) => updateField('bio', value)}
                            />
                        </Field>

                        <Field label="Phone number (optional)">
                            <TextInput
                                keyboardType="phone-pad"
                                placeholder="+91 98765 43210"
                                placeholderTextColor="#7b8d96"
                                style={styles.input}
                                value={phoneNumber}
                                onChangeText={setPhoneNumber}
                            />
                        </Field>

                        <Field label="WhatsApp number (optional)">
                            <TextInput
                                keyboardType="phone-pad"
                                placeholder="+91 98765 43210"
                                placeholderTextColor="#7b8d96"
                                style={styles.input}
                                value={whatsappNumber}
                                onChangeText={setWhatsappNumber}
                            />
                            <Text style={styles.helper}>Visible only after both people complete the mutual unlock flow.</Text>
                        </Field>
                    </>
                ),
            },
            {
                title: 'Preferences',
                description: 'This will also be used to generate embeddings later.',
                content: (
                    <>
                        <Field label="Partner preferences">
                            <TextInput
                                multiline
                                placeholder="Describe values, location preferences, education, lifestyle, and family expectations."
                                placeholderTextColor="#7b8d96"
                                style={[styles.input, styles.textareaLarge]}
                                textAlignVertical="top"
                                value={form.preferences}
                                onChangeText={(value) => updateField('preferences', value)}
                            />
                        </Field>

                        <View style={styles.summaryBox}>
                            <Text style={styles.summaryTitle}>Embedding preview input</Text>
                            <Text style={styles.summaryText}>{buildEmbeddingSource(form)}</Text>
                        </View>
                    </>
                ),
            },
        ],
        [form],
    );

    function updateField<K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    async function handleAddPhoto() {
        if (addingPhoto || loading || selectedPhotos.length >= maxProfilePhotos) {
            return;
        }

        setAddingPhoto(true);

        try {
            const pickedPhoto = await pickProfilePhotoFromLibrary();
            if (!pickedPhoto) {
                return;
            }

            setSelectedPhotos((current) => [...current, pickedPhoto]);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not add this photo.';
            Alert.alert('Photo unavailable', message);
        } finally {
            setAddingPhoto(false);
        }
    }

    function removePhoto(photoId: string) {
        setSelectedPhotos((current) => current.filter((photo) => photo.id !== photoId));
        setForm((current) => ({ ...current, photo_urls: [] }));
    }

    function updateGender(gender: string) {
        setForm((current) => {
            const shouldAutofillPreference =
                !current.partner_gender_preference ||
                current.partner_gender_preference === getDefaultPartnerGenderPreference(current.gender);

            return {
                ...current,
                gender,
                partner_gender_preference: shouldAutofillPreference
                    ? getDefaultPartnerGenderPreference(gender)
                    : current.partner_gender_preference,
            };
        });
    }

    const canUseCopilot = Boolean(form.full_name.trim() && form.location.trim());

    function validateCurrentStep() {
        if (step === 0) {
            if (!form.full_name.trim() || !form.location.trim()) {
                Alert.alert('Missing details', 'Please complete the name and location fields.');
                return false;
            }

            if (!form.gender.trim() || !form.partner_gender_preference.trim()) {
                Alert.alert('Missing preferences', 'Please tell us both who this profile is for and who they want to meet.');
                return false;
            }
        }

        if (step === 1 && selectedPhotos.length === 0) {
            Alert.alert('Add a photo', 'Please add at least one profile photo.');
            return false;
        }

        if (step === 2) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dob)) {
                Alert.alert('Invalid date', 'Please enter DOB in YYYY-MM-DD format.');
                return false;
            }

            if (form.height_cm < 120 || form.height_cm > 250) {
                Alert.alert('Invalid height', 'Height should be between 120cm and 250cm.');
                return false;
            }

            if (!form.bio.trim()) {
                Alert.alert('Missing bio', 'Please add a short bio.');
                return false;
            }
        }

        if (step === 3 && !form.preferences.trim()) {
            Alert.alert('Missing preferences', 'Please describe partner preferences.');
            return false;
        }

        return true;
    }

    async function onNext() {
        if (!validateCurrentStep()) {
            return;
        }

        if (step < steps.length - 1) {
            setStep((current) => current + 1);
            return;
        }

        setLoading(true);
        try {
            const photoUrls =
                form.photo_urls.length === selectedPhotos.length && form.photo_urls.length > 0
                    ? form.photo_urls
                    : await uploadCurrentUserProfilePhotos(selectedPhotos);

            setForm((current) => ({ ...current, photo_urls: photoUrls }));

            await upsertCurrentProfile({
                ...form,
                bio: form.bio.trim(),
                preferences: form.preferences.trim(),
                full_name: form.full_name.trim(),
                partner_gender_preference: form.partner_gender_preference.trim(),
                photo_urls: photoUrls,
                location: form.location.trim(),
                dob: form.dob.trim(),
            });

            await upsertCurrentProfileContactDetails({
                phone_number: phoneNumber,
                whatsapp_number: whatsappNumber,
            });

            onComplete();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Profile save failed.';
            Alert.alert('Save failed', message);
        } finally {
            setLoading(false);
        }
    }

    async function handleCopilot() {
        if (!canUseCopilot || copilotLoading || loading) {
            return;
        }

        setCopilotLoading(true);

        try {
            const result = await runOnboardingCopilot(form);

            setForm((current) => ({
                ...current,
                bio: result.bio || current.bio,
                preferences: result.preferences || current.preferences,
            }));
            setCopilotResult(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'AI copilot is unavailable right now.';
            Alert.alert('AI copilot unavailable', message);
        } finally {
            setCopilotLoading(false);
        }
    }

    async function onBack() {
        if (loading) {
            return;
        }

        if (step > 0) {
            setStep((current) => current - 1);
            return;
        }

        const { error } = await supabase.auth.signOut();
        if (error) {
            Alert.alert('Sign out failed', error.message);
        }
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView
                style={styles.keyboardArea}
                behavior={Platform.select({ ios: 'padding', android: undefined })}
            >
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.contentColumn}>
                        <View style={styles.header}>
                            <View style={styles.titleRow}>
                                <BackButton onPress={() => void onBack()} />
                                <View style={styles.titleCopy}>
                                    <Text style={styles.title}>
                                        {profileDisplayName ? `Build ${profileDisplayName}'s profile` : 'Build the profile that powers matching'}
                                    </Text>
                                </View>
                            </View>
                            <Text style={styles.subtitle}>{steps[step].description}</Text>
                        </View>

                        <View style={styles.progressRow}>
                            {steps.map((item, index) => (
                                <View
                                    key={item.title}
                                    style={[styles.progressDot, index <= step && styles.progressDotActive]}
                                />
                            ))}
                        </View>

                        <View style={styles.card}>
                            <Text style={styles.stepTitle}>{steps[step].title}</Text>
                            {steps[step].content}
                        </View>

                        {step > 1 ? (
                            <View style={styles.copilotCard}>
                                <Text style={styles.copilotTitle}>AI onboarding copilot</Text>
                                <Text style={styles.copilotBody}>
                                    Generate a cleaner bio and partner preferences from the details you already entered.
                                </Text>

                                <Pressable
                                    style={[
                                        styles.copilotButton,
                                        (!canUseCopilot || copilotLoading || loading) && styles.copilotButtonDisabled,
                                    ]}
                                    onPress={() => void handleCopilot()}
                                    disabled={!canUseCopilot || copilotLoading || loading}
                                >
                                    <Text style={styles.copilotButtonText}>
                                        {copilotLoading ? 'Thinking...' : 'Generate with AI'}
                                    </Text>
                                </Pressable>

                                {!canUseCopilot ? (
                                    <Text style={styles.copilotHint}>Add at least a name and location first.</Text>
                                ) : null}

                                {copilotResult ? (
                                    <View style={styles.copilotResultCard}>
                                        <Text style={styles.copilotResultTitle}>AI summary</Text>
                                        <Text style={styles.copilotResultBody}>{copilotResult.summary}</Text>

                                        {copilotResult.missingTopics.length > 0 ? (
                                            <>
                                                <Text style={styles.copilotMissingTitle}>Still worth adding</Text>
                                                <View style={styles.copilotTagRow}>
                                                    {copilotResult.missingTopics.map((topic) => (
                                                        <View key={topic} style={styles.copilotTag}>
                                                            <Text style={styles.copilotTagText}>{topic}</Text>
                                                        </View>
                                                    ))}
                                                </View>
                                            </>
                                        ) : null}
                                    </View>
                                ) : null}
                            </View>
                        ) : null}
                    </View>
                </ScrollView>

                <View style={styles.footer}>
                    <View style={styles.footerColumn}>
                        <Pressable style={styles.primaryButton} onPress={onNext} disabled={loading}>
                            <Text style={styles.primaryButtonText}>
                                {loading ? 'Saving...' : step === steps.length - 1 ? 'Finish profile' : 'Continue'}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

function buildEmbeddingSource(form: ProfileInput) {
    return [
        `Bio: ${form.bio || 'Pending'}`,
        `Preferences: ${form.preferences || 'Pending'}`,
        `Looking for: ${form.partner_gender_preference || 'Pending'}`,
        `Location: ${form.location || 'Pending'}`,
        `Profile owner: ${form.profile_owner}`,
    ].join('\n');
}

type FieldProps = {
    label: string;
    children: React.ReactNode;
};

function Field({ label, children }: FieldProps) {
    return (
        <View style={styles.field}>
            <Text style={styles.fieldLabel}>{label}</Text>
            {children}
        </View>
    );
}

type ChipProps = {
    label: string;
    active: boolean;
    onPress: () => void;
};

function Chip({ label, active, onPress }: ChipProps) {
    return (
        <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#eef5f7',
    },
    keyboardArea: {
        flex: 1,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        alignItems: 'center',
        flexGrow: 1,
        padding: 20,
        paddingBottom: 40,
    },
    contentColumn: {
        gap: 18,
        maxWidth: MAX_CONTENT_WIDTH,
        width: '100%',
    },
    header: {
        gap: 8,
    },
    titleRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
    },
    titleCopy: {
        flex: 1,
        gap: 8,
    },
    title: {
        color: '#13333f',
        fontSize: 30,
        fontWeight: '800',
    },
    subtitle: {
        color: '#5a7079',
        fontSize: 15,
        lineHeight: 22,
    },
    progressRow: {
        flexDirection: 'row',
        gap: 8,
    },
    progressDot: {
        backgroundColor: '#d1dde1',
        borderRadius: 999,
        flex: 1,
        height: 6,
    },
    progressDotActive: {
        backgroundColor: '#123340',
    },
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        gap: 16,
        padding: 18,
    },
    stepTitle: {
        color: '#123340',
        fontSize: 20,
        fontWeight: '700',
    },
    field: {
        gap: 8,
    },
    fieldLabel: {
        color: '#35515c',
        fontSize: 13,
        fontWeight: '700',
    },
    input: {
        backgroundColor: '#f7fafb',
        borderColor: '#d8e4e8',
        borderRadius: 12,
        borderWidth: 1,
        color: '#122f39',
        fontSize: 15,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    helper: {
        color: '#69808a',
        fontSize: 12,
    },
    textarea: {
        minHeight: 120,
    },
    textareaLarge: {
        minHeight: 160,
    },
    choiceRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    photoGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    photoCard: {
        borderRadius: 18,
        height: 168,
        overflow: 'hidden',
        position: 'relative',
        width: 118,
    },
    photoImage: {
        height: '100%',
        width: '100%',
    },
    removePhotoButton: {
        backgroundColor: 'rgba(18, 51, 64, 0.88)',
        borderRadius: 999,
        bottom: 10,
        paddingHorizontal: 12,
        paddingVertical: 7,
        position: 'absolute',
        right: 10,
    },
    removePhotoButtonText: {
        color: '#ffffff',
        fontSize: 11,
        fontWeight: '800',
    },
    addPhotoCard: {
        alignItems: 'center',
        backgroundColor: '#f7fafb',
        borderColor: '#d8e4e8',
        borderRadius: 18,
        borderStyle: 'dashed',
        borderWidth: 1,
        gap: 8,
        height: 168,
        justifyContent: 'center',
        width: 118,
    },
    addPhotoSymbol: {
        color: '#123340',
        fontSize: 30,
        fontWeight: '400',
        lineHeight: 30,
    },
    addPhotoLabel: {
        color: '#35515c',
        fontSize: 13,
        fontWeight: '700',
    },
    disabledCard: {
        opacity: 0.6,
    },
    chip: {
        backgroundColor: '#f0f4f5',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    chipActive: {
        backgroundColor: '#123340',
    },
    chipText: {
        color: '#49606a',
        fontSize: 13,
        fontWeight: '700',
        textTransform: 'capitalize',
    },
    chipTextActive: {
        color: '#ffffff',
    },
    summaryBox: {
        backgroundColor: '#f5f8f9',
        borderRadius: 14,
        gap: 8,
        padding: 14,
    },
    summaryTitle: {
        color: '#123340',
        fontSize: 13,
        fontWeight: '700',
    },
    summaryText: {
        color: '#4f6670',
        fontSize: 13,
        lineHeight: 19,
    },
    copilotCard: {
        backgroundColor: '#fefbf7',
        borderColor: '#ecd9c7',
        borderRadius: 20,
        borderWidth: 1,
        gap: 10,
        padding: 18,
    },
    copilotTitle: {
        color: '#123340',
        fontSize: 18,
        fontWeight: '800',
    },
    copilotBody: {
        color: '#4f6670',
        fontSize: 14,
        lineHeight: 21,
    },
    copilotButton: {
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: '#123340',
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 11,
    },
    copilotButtonDisabled: {
        opacity: 0.6,
    },
    copilotButtonText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '800',
    },
    copilotHint: {
        color: '#69808a',
        fontSize: 12,
    },
    copilotResultCard: {
        backgroundColor: '#f5f8f9',
        borderRadius: 14,
        gap: 8,
        padding: 14,
    },
    copilotResultTitle: {
        color: '#123340',
        fontSize: 13,
        fontWeight: '800',
    },
    copilotResultBody: {
        color: '#45606b',
        fontSize: 13,
        lineHeight: 20,
    },
    copilotMissingTitle: {
        color: '#123340',
        fontSize: 12,
        fontWeight: '700',
        marginTop: 2,
    },
    copilotTagRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    copilotTag: {
        backgroundColor: '#eef2f3',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    copilotTagText: {
        color: '#49606a',
        fontSize: 12,
        fontWeight: '700',
    },
    footer: {
        alignItems: 'center',
        backgroundColor: '#eef5f7',
        borderTopColor: '#d6e1e4',
        borderTopWidth: 1,
        padding: 20,
    },
    footerColumn: {
        maxWidth: MAX_CONTENT_WIDTH,
        width: '100%',
    },
    primaryButton: {
        alignItems: 'center',
        backgroundColor: '#de6b3b',
        borderRadius: 12,
        justifyContent: 'center',
        paddingVertical: 14,
    },
    primaryButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
});
