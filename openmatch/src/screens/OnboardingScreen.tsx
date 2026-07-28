import { useEffect, useMemo, useState } from 'react';
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
import { updateUserPresence } from '../lib/chatApi';

const owners: ProfileOwner[] = ['self', 'parent', 'sibling', 'relative'];

const RELIGIONS = ['Hindu', 'Muslim', 'Christian', 'Sikh', 'Jain', 'Buddhist', 'Parsi', 'Jewish', 'Other'] as const;
const MARITAL_STATUSES = ['never_married', 'divorced', 'widowed', 'annulled'] as const;
const MARITAL_STATUS_LABELS: Record<string, string> = {
    never_married: 'Never Married', divorced: 'Divorced', widowed: 'Widowed', annulled: 'Annulled',
};
const EDUCATIONS = ['Below Graduate', 'Diploma', 'Graduate', 'Post-Graduate', 'Doctorate'] as const;
const INCOME_BANDS = ['below_3L', '3-5L', '5-10L', '10-20L', '20-50L', '50L+'] as const;
const INCOME_BAND_LABELS: Record<string, string> = {
    below_3L: 'Below ₹3L', '3-5L': '₹3L–5L', '5-10L': '₹5L–10L',
    '10-20L': '₹10L–20L', '20-50L': '₹20L–50L', '50L+': '₹50L+',
};
const DIETS = ['Vegetarian', 'Non-Vegetarian', 'Vegan', 'Jain', 'Eggetarian'] as const;
const FAMILY_TYPES = ['nuclear', 'joint', 'extended'] as const;
const FAMILY_TYPE_LABELS: Record<string, string> = { nuclear: 'Nuclear', joint: 'Joint', extended: 'Extended' };
const FAMILY_STATUSES = ['middle_class', 'upper_middle', 'affluent'] as const;
const FAMILY_STATUS_LABELS: Record<string, string> = {
    middle_class: 'Middle Class', upper_middle: 'Upper Middle', affluent: 'Affluent',
};

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
    const [isPhoneVerified, setIsPhoneVerified] = useState(false);

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => {
            if (data.user?.phone) {
                setPhoneNumber(data.user.phone);
                setIsPhoneVerified(true);
            }
        });
    }, []);

    async function handleVerifyPhone() {
        if (!phoneNumber.trim()) {
            Alert.alert('Error', 'Please enter a phone number first.');
            return;
        }

        if (Platform.OS === 'web') {
            const confirmed = window.confirm(
                'Verification Code Sent\n\nWe simulated sending a 6-digit OTP code to your number. Click OK to verify.'
            );
            if (confirmed) {
                setIsPhoneVerified(true);
                alert('Phone number verified successfully! ✅');
            }
            return;
        }

        Alert.alert(
            'Verification Code Sent',
            'We simulated sending a 6-digit OTP code to your number. Enter "123456" to verify.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Verify',
                    onPress: () => {
                        setIsPhoneVerified(true);
                        Alert.alert('Verified', 'Phone number verified successfully! ✅');
                    }
                }
            ]
        );
    }

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
        religion: 'Hindu',
        marital_status: 'never_married',
        education: 'Graduate',
        diet: 'Vegetarian',
        mother_tongue: 'Hindi',
        income_band: '5-10L',
        occupation: '',
        company: '',
        family_type: 'nuclear',
        family_status: 'middle_class',
        num_siblings: 0,
        drinks_alcohol: false,
        smokes: false,
    });

    const profileDisplayName = getDisplayFirstName(form.full_name);

    const steps = [
        // STEP 0: Basics
        {
            title: 'Basic Identity',
            description: 'Tell us who this profile is for, basic demographics, and location.',
            content: (
                <>
                    <Field label="Full Name *">
                        <TextInput
                            placeholder="Aarav Sharma"
                            placeholderTextColor="#7b8d96"
                            style={styles.input}
                            value={form.full_name}
                            onChangeText={(value) => updateField('full_name', value)}
                        />
                    </Field>

                    <Field label="Profile Managed By">
                        <View style={styles.choiceRow}>
                            {owners.map((owner) => (
                                <Chip
                                    key={owner}
                                    active={form.profile_owner === owner}
                                    label={owner.toUpperCase()}
                                    onPress={() => updateField('profile_owner', owner)}
                                />
                            ))}
                        </View>
                    </Field>

                    <Field label="I'm a *">
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

                    <Field label="Looking for a *">
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
                    </Field>

                    <Field label="Date of Birth (YYYY-MM-DD) *">
                        <TextInput
                            placeholder="1997-08-14"
                            placeholderTextColor="#7b8d96"
                            style={styles.input}
                            value={form.dob}
                            onChangeText={(value) => updateField('dob', value)}
                        />
                    </Field>

                    <Field label="Location (City, State) *">
                        <TextInput
                            placeholder="Pune, Maharashtra"
                            placeholderTextColor="#7b8d96"
                            style={styles.input}
                            value={form.location}
                            onChangeText={(value) => updateField('location', value)}
                        />
                    </Field>

                    <Field label="Height (cm)">
                        <TextInput
                            keyboardType="number-pad"
                            placeholder="165"
                            placeholderTextColor="#7b8d96"
                            style={styles.input}
                            value={String(form.height_cm || '')}
                            onChangeText={(value) => updateField('height_cm', Number(value || 0))}
                        />
                    </Field>
                </>
            ),
        },

        // STEP 1: Photos & Contact
        {
            title: 'Photos & Verified Contact',
            description: 'Add clear photos and confirm your verified phone number.',
            content: (
                <>
                    <Field label="Profile Photos (At least 1 required) *">
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
                            Add up to {maxProfilePhotos} photos. The first photo appears in match cards.
                        </Text>
                    </Field>

                    <Field label="Phone Number (Verified)">
                        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                            <TextInput
                                keyboardType={Platform.OS === 'web' ? 'default' : 'phone-pad'}
                                placeholder="+91 98765 43210"
                                placeholderTextColor="#7b8d96"
                                style={[styles.input, { flex: 1 }]}
                                value={phoneNumber}
                                editable={!isPhoneVerified}
                                onChangeText={(val) => {
                                    setPhoneNumber(val);
                                    setIsPhoneVerified(false);
                                }}
                            />
                            {isPhoneVerified ? (
                                <Text style={{ color: '#1a7a5e', fontWeight: 'bold' }}>Verified ✅</Text>
                            ) : (
                                <Pressable
                                    style={{ backgroundColor: '#e56a3a', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 }}
                                    onPress={handleVerifyPhone}
                                >
                                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Verify</Text>
                                </Pressable>
                            )}
                        </View>
                    </Field>

                    <Field label="WhatsApp Number (Optional)">
                        <TextInput
                            keyboardType={Platform.OS === 'web' ? 'default' : 'phone-pad'}
                            placeholder="+91 98765 43210"
                            placeholderTextColor="#7b8d96"
                            style={styles.input}
                            value={whatsappNumber}
                            onChangeText={setWhatsappNumber}
                        />
                        <Text style={styles.helper}>Shared only after mutual escrow unlock.</Text>
                    </Field>
                </>
            ),
        },

        // STEP 2: Education & Career
        {
            title: 'Education & Career',
            description: 'Share your academic background, profession, and marital status.',
            content: (
                <>
                    <Field label="Religion">
                        <View style={styles.choiceRowWrap}>
                            {RELIGIONS.map((rel) => (
                                <Chip
                                    key={rel}
                                    active={form.religion === rel}
                                    label={rel}
                                    onPress={() => updateField('religion', rel)}
                                />
                            ))}
                        </View>
                    </Field>

                    <Field label="Mother Tongue">
                        <TextInput
                            placeholder="Hindi, Punjabi, Marathi..."
                            placeholderTextColor="#7b8d96"
                            style={styles.input}
                            value={form.mother_tongue || ''}
                            onChangeText={(value) => updateField('mother_tongue', value)}
                        />
                    </Field>

                    <Field label="Education Level">
                        <View style={styles.choiceRowWrap}>
                            {EDUCATIONS.map((edu) => (
                                <Chip
                                    key={edu}
                                    active={form.education === edu}
                                    label={edu}
                                    onPress={() => updateField('education', edu)}
                                />
                            ))}
                        </View>
                    </Field>

                    <Field label="Occupation / Designation">
                        <TextInput
                            placeholder="Software Engineer, Business Owner, Doctor..."
                            placeholderTextColor="#7b8d96"
                            style={styles.input}
                            value={form.occupation || ''}
                            onChangeText={(value) => updateField('occupation', value)}
                        />
                    </Field>

                    <Field label="Company / Employer Name">
                        <TextInput
                            placeholder="Tech Corp / Self-Employed"
                            placeholderTextColor="#7b8d96"
                            style={styles.input}
                            value={form.company || ''}
                            onChangeText={(value) => updateField('company', value)}
                        />
                    </Field>

                    <Field label="Annual Income Band">
                        <View style={styles.choiceRowWrap}>
                            {INCOME_BANDS.map((band) => (
                                <Chip
                                    key={band}
                                    active={form.income_band === band}
                                    label={INCOME_BAND_LABELS[band] || band}
                                    onPress={() => updateField('income_band', band)}
                                />
                            ))}
                        </View>
                    </Field>

                    <Field label="Marital Status">
                        <View style={styles.choiceRowWrap}>
                            {MARITAL_STATUSES.map((status) => (
                                <Chip
                                    key={status}
                                    active={form.marital_status === status}
                                    label={MARITAL_STATUS_LABELS[status] || status}
                                    onPress={() => updateField('marital_status', status)}
                                />
                            ))}
                        </View>
                    </Field>
                </>
            ),
        },

        // STEP 3: Family & Lifestyle
        {
            title: 'Family & Lifestyle',
            description: 'Tell candidates about your family background and daily habits.',
            content: (
                <>
                    <Field label="Family Type">
                        <View style={styles.choiceRow}>
                            {FAMILY_TYPES.map((type) => (
                                <Chip
                                    key={type}
                                    active={form.family_type === type}
                                    label={FAMILY_TYPE_LABELS[type] || type}
                                    onPress={() => updateField('family_type', type)}
                                />
                            ))}
                        </View>
                    </Field>

                    <Field label="Family Status">
                        <View style={styles.choiceRow}>
                            {FAMILY_STATUSES.map((status) => (
                                <Chip
                                    key={status}
                                    active={form.family_status === status}
                                    label={FAMILY_STATUS_LABELS[status] || status}
                                    onPress={() => updateField('family_status', status)}
                                />
                            ))}
                        </View>
                    </Field>

                    <Field label="Number of Siblings">
                        <TextInput
                            keyboardType="number-pad"
                            placeholder="1"
                            placeholderTextColor="#7b8d96"
                            style={styles.input}
                            value={String(form.num_siblings ?? 0)}
                            onChangeText={(value) => updateField('num_siblings', Number(value || 0))}
                        />
                    </Field>

                    <Field label="Diet Preference">
                        <View style={styles.choiceRowWrap}>
                            {DIETS.map((diet) => (
                                <Chip
                                    key={diet}
                                    active={form.diet === diet}
                                    label={diet}
                                    onPress={() => updateField('diet', diet)}
                                />
                            ))}
                        </View>
                    </Field>

                    <Field label="Drinking Habits">
                        <View style={styles.choiceRow}>
                            <Chip
                                active={form.drinks_alcohol === false}
                                label="No / Never"
                                onPress={() => updateField('drinks_alcohol', false)}
                            />
                            <Chip
                                active={form.drinks_alcohol === true}
                                label="Yes / Socially"
                                onPress={() => updateField('drinks_alcohol', true)}
                            />
                        </View>
                    </Field>

                    <Field label="Smoking Habits">
                        <View style={styles.choiceRow}>
                            <Chip
                                active={form.smokes === false}
                                label="No / Never"
                                onPress={() => updateField('smokes', false)}
                            />
                            <Chip
                                active={form.smokes === true}
                                label="Yes / Socially"
                                onPress={() => updateField('smokes', true)}
                            />
                        </View>
                    </Field>
                </>
            ),
        },

        // STEP 4: Bio & Preferences
        {
            title: 'Bio & Expectations',
            description: 'Write a short intro and describe your ideal partner expectations.',
            content: (
                <>
                    <Field label="Bio / About Me *">
                        <TextInput
                            multiline
                            placeholder="Share your values, family background, work, and lifestyle."
                            placeholderTextColor="#7b8d96"
                            style={[styles.input, styles.textarea]}
                            textAlignVertical="top"
                            value={form.bio}
                            onChangeText={(value) => updateField('bio', value)}
                        />
                    </Field>

                    <Field label="Partner Preferences / Expectations *">
                        <TextInput
                            multiline
                            placeholder="Describe expected education, values, location, and lifestyle."
                            placeholderTextColor="#7b8d96"
                            style={[styles.input, styles.textareaLarge]}
                            textAlignVertical="top"
                            value={form.preferences}
                            onChangeText={(value) => updateField('preferences', value)}
                        />
                    </Field>

                    <View style={styles.summaryBox}>
                        <Text style={styles.summaryTitle}>AI Vector Matchmaking Input Preview</Text>
                        <Text style={styles.summaryText}>{buildEmbeddingSource(form)}</Text>
                    </View>
                </>
            ),
        },
    ];

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
                Alert.alert('Missing details', 'Please complete Full Name and Location.');
                return false;
            }

            if (!form.gender.trim() || !form.partner_gender_preference.trim()) {
                Alert.alert('Missing preferences', 'Please select both your gender and partner preference.');
                return false;
            }

            if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dob.trim())) {
                Alert.alert('Invalid date', 'Please enter DOB in YYYY-MM-DD format (e.g. 1997-08-14).');
                return false;
            }

            // C4 FIX: Minimum age check (18 years) for legal compliance
            const dob = new Date(form.dob.trim());
            const today = new Date();
            let age = today.getFullYear() - dob.getFullYear();
            const monthDiff = today.getMonth() - dob.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
                age--;
            }
            if (isNaN(age) || age < 18) {
                Alert.alert('Age Requirement', 'You must be at least 18 years old to register on this platform.');
                return false;
            }
            if (age > 120) {
                Alert.alert('Invalid Date', 'Please enter a valid date of birth.');
                return false;
            }
        }

        if (step === 1) {
            if (selectedPhotos.length === 0) {
                Alert.alert('Add a photo', 'Please add at least one profile photo.');
                return false;
            }

            if (!phoneNumber.trim()) {
                Alert.alert('Phone Required', 'Please enter your phone number.');
                return false;
            }

            if (!isPhoneVerified) {
                Alert.alert('Phone Unverified', 'Please verify your phone number before proceeding.');
                return false;
            }
        }

        // M16 FIX: Add validation for step 2 (Education & Career)
        if (step === 2) {
            if (!form.religion) {
                Alert.alert('Missing Religion', 'Please select your religion.');
                return false;
            }
            if (!form.education) {
                Alert.alert('Missing Education', 'Please select your education level.');
                return false;
            }
        }

        // M16 FIX: Add validation for step 3 (Family & Lifestyle)
        if (step === 3) {
            if (!form.family_type) {
                Alert.alert('Missing Family Type', 'Please select your family type.');
                return false;
            }
            if (!form.diet) {
                Alert.alert('Missing Diet', 'Please select your diet preference.');
                return false;
            }
        }

        if (step === 4) {
            if (!form.bio.trim()) {
                Alert.alert('Missing Bio', 'Please add a short bio to introduce yourself.');
                return false;
            }

            if (!form.preferences.trim()) {
                Alert.alert('Missing Preferences', 'Please describe your partner preferences.');
                return false;
            }
        }

        return true;
    }

    // C7 FIX: Debounce guard to prevent double-tap saving
    const [isSaving, setIsSaving] = useState(false);

    async function onNext() {
        if (!validateCurrentStep()) {
            return;
        }

        if (step < steps.length - 1) {
            setStep((current) => current + 1);
            return;
        }

        // C7: Prevent double-tap
        if (isSaving) return;
        setIsSaving(true);

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
                religion: form.religion,
                marital_status: form.marital_status,
                education: form.education,
                diet: form.diet,
                mother_tongue: form.mother_tongue?.trim(),
                income_band: form.income_band,
                occupation: form.occupation?.trim(),
                company: form.company?.trim(),
                family_type: form.family_type,
                family_status: form.family_status,
                num_siblings: Number(form.num_siblings || 0),
                drinks_alcohol: form.drinks_alcohol,
                smokes: form.smokes,
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
            setIsSaving(false);
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
                                {step > 0 ? <BackButton onPress={() => void onBack()} /> : null}

                                <View style={styles.titleCopy}>
                                    <Text style={styles.title}>
                                        {profileDisplayName ? `Welcome, ${profileDisplayName}` : 'Create your profile'}
                                    </Text>
                                    <Text style={styles.subtitle}>{steps[step].description}</Text>
                                </View>
                            </View>

                            <View style={styles.progressRow}>
                                {steps.map((item, index) => (
                                    <View
                                        key={item.title}
                                        style={[
                                            styles.progressSegment,
                                            index <= step && styles.progressSegmentActive,
                                        ]}
                                    />
                                ))}
                            </View>
                        </View>

                        <View style={styles.card}>
                            <Text style={styles.stepTitle}>
                                Step {step + 1} of {steps.length}: {steps[step].title}
                            </Text>
                            {steps[step].content}
                        </View>

                        {step === 4 ? (
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
        `Occupation: ${form.occupation || 'Pending'}`,
        `Education: ${form.education || 'Pending'}`,
        `Religion: ${form.religion || 'Pending'}`,
        `Mother tongue: ${form.mother_tongue || 'Pending'}`,
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
        gap: 6,
        marginTop: 4,
    },
    progressSegment: {
        backgroundColor: '#c4d7de',
        borderRadius: 999,
        flex: 1,
        height: 6,
    },
    progressSegmentActive: {
        backgroundColor: '#e56a3a',
    },
    card: {
        backgroundColor: '#ffffff',
        borderColor: '#d7e3e6',
        borderRadius: 20,
        borderWidth: 1,
        gap: 16,
        padding: 20,
    },
    stepTitle: {
        color: '#13333f',
        fontSize: 20,
        fontWeight: '800',
        marginBottom: 4,
    },
    field: {
        gap: 8,
    },
    fieldLabel: {
        color: '#34505c',
        fontSize: 13,
        fontWeight: '700',
    },
    input: {
        backgroundColor: '#f7fafb',
        borderColor: '#d7e3e6',
        borderRadius: 12,
        borderWidth: 1,
        color: '#10232a',
        fontSize: 15,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    textarea: {
        minHeight: 90,
    },
    textareaLarge: {
        minHeight: 120,
    },
    choiceRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    choiceRowWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    chip: {
        backgroundColor: '#f1f5f7',
        borderColor: '#d7e3e6',
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    chipActive: {
        backgroundColor: '#13333f',
        borderColor: '#13333f',
    },
    chipText: {
        color: '#49606b',
        fontSize: 13,
        fontWeight: '600',
    },
    chipTextActive: {
        color: '#ffffff',
    },
    helper: {
        color: '#657d87',
        fontSize: 12,
        lineHeight: 17,
    },
    photoGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    photoCard: {
        borderColor: '#d7e3e6',
        borderRadius: 14,
        borderWidth: 1,
        height: 120,
        overflow: 'hidden',
        position: 'relative',
        width: 100,
    },
    photoImage: {
        height: '100%',
        width: '100%',
    },
    removePhotoButton: {
        backgroundColor: 'rgba(0,0,0,0.6)',
        bottom: 0,
        left: 0,
        paddingVertical: 4,
        position: 'absolute',
        right: 0,
    },
    removePhotoButtonText: {
        color: '#ffffff',
        fontSize: 11,
        fontWeight: '700',
        textAlign: 'center',
    },
    addPhotoCard: {
        alignItems: 'center',
        backgroundColor: '#f7fafb',
        borderColor: '#d7e3e6',
        borderRadius: 14,
        borderStyle: 'dashed',
        borderWidth: 2,
        height: 120,
        justifyContent: 'center',
        width: 100,
    },
    disabledCard: {
        opacity: 0.5,
    },
    addPhotoSymbol: {
        color: '#e56a3a',
        fontSize: 28,
        fontWeight: '700',
    },
    addPhotoLabel: {
        color: '#5a7079',
        fontSize: 12,
        fontWeight: '600',
    },
    copilotCard: {
        backgroundColor: '#13333f',
        borderRadius: 20,
        gap: 12,
        padding: 20,
    },
    copilotTitle: {
        color: '#ffffff',
        fontSize: 18,
        fontWeight: '800',
    },
    copilotBody: {
        color: '#c4d7de',
        fontSize: 14,
        lineHeight: 20,
    },
    copilotButton: {
        alignItems: 'center',
        backgroundColor: '#e56a3a',
        borderRadius: 12,
        paddingVertical: 12,
    },
    copilotButtonDisabled: {
        backgroundColor: '#5a7079',
        opacity: 0.6,
    },
    copilotButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '700',
    },
    copilotHint: {
        color: '#94b3be',
        fontSize: 12,
    },
    copilotResultCard: {
        backgroundColor: '#1d4554',
        borderRadius: 14,
        gap: 8,
        marginTop: 4,
        padding: 14,
    },
    copilotResultTitle: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '700',
    },
    copilotResultBody: {
        color: '#e0edf1',
        fontSize: 13,
        lineHeight: 19,
    },
    copilotMissingTitle: {
        color: '#f3b499',
        fontSize: 12,
        fontWeight: '700',
        marginTop: 4,
    },
    copilotTagRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    copilotTag: {
        backgroundColor: 'rgba(229,106,58,0.2)',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    copilotTagText: {
        color: '#f3b499',
        fontSize: 12,
    },
    summaryBox: {
        backgroundColor: '#f7fafb',
        borderColor: '#d7e3e6',
        borderRadius: 12,
        borderWidth: 1,
        gap: 6,
        padding: 14,
    },
    summaryTitle: {
        color: '#34505c',
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    summaryText: {
        color: '#5a7079',
        fontSize: 13,
        lineHeight: 18,
    },
    footer: {
        alignItems: 'center',
        backgroundColor: '#ffffff',
        borderTopColor: '#d7e3e6',
        borderTopWidth: 1,
        paddingHorizontal: 20,
        paddingVertical: 14,
    },
    footerColumn: {
        maxWidth: MAX_CONTENT_WIDTH,
        width: '100%',
    },
    primaryButton: {
        alignItems: 'center',
        backgroundColor: '#e56a3a',
        borderRadius: 12,
        paddingVertical: 14,
    },
    primaryButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '800',
    },
});
