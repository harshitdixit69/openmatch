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
import { DatePickerField } from '../components/DatePickerField';
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
import { getFriendlyErrorMessage, showFriendlyAlert } from '../lib/errorUtils';
import { trackEvent, setAnalyticsUser } from '../lib/analytics';
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
    const [errors, setErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => {
            if (data.user?.phone) {
                setPhoneNumber(data.user.phone);
                setIsPhoneVerified(true);
            }
        });
    }, []);

    // Track onboarding funnel: which step people reach (and where they drop off).
    useEffect(() => {
        trackEvent('onboarding_step_viewed', { step: step + 1 });
    }, [step]);

    async function handleVerifyPhone() {
        if (!phoneNumber.trim()) {
            setErrors((prev) => ({ ...prev, phone: 'Please enter a phone number first.' }));
            Alert.alert('Error', 'Please enter a phone number first.');
            return;
        }

        if (Platform.OS === 'web') {
            const confirmed = window.confirm(
                'Verification Code Sent\n\nWe simulated sending a 6-digit OTP code to your number. Click OK to verify.'
            );
            if (confirmed) {
                setIsPhoneVerified(true);
                setErrors((prev) => {
                    const n = { ...prev };
                    delete n.phone;
                    return n;
                });
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
                        setErrors((prev) => {
                            const n = { ...prev };
                            delete n.phone;
                            return n;
                        });
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

    function updateField<K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) {
        setForm((current) => ({ ...current, [key]: value }));
        if (errors[key as string]) {
            setErrors((prev) => {
                const next = { ...prev };
                delete next[key as string];
                return next;
            });
        }
    }

    const steps = [
        // STEP 0: Basics
        {
            title: 'Basic Identity',
            description: 'Tell us who this profile is for, basic demographics, and location.',
            content: (
                <>
                    <Field label="Full Name" required error={errors.full_name}>
                        <TextInput
                            placeholder="Aarav Sharma"
                            placeholderTextColor="#7b8d96"
                            style={[styles.input, errors.full_name && styles.inputError]}
                            value={form.full_name}
                            onChangeText={(value) => updateField('full_name', value)}
                        />
                    </Field>

                    <Field label="Profile Managed By" required error={errors.profile_owner}>
                        <View style={[styles.choiceRow, errors.profile_owner && styles.choiceRowError]}>
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

                    <Field label="I'm a" required error={errors.gender}>
                        <View style={[styles.choiceRow, errors.gender && styles.choiceRowError]}>
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

                    <Field label="Looking for a" required error={errors.partner_gender_preference}>
                        <View style={[styles.choiceRow, errors.partner_gender_preference && styles.choiceRowError]}>
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

                    <Field label="Date of Birth" required error={errors.dob}>
                        <DatePickerField
                            value={form.dob}
                            onChange={(value) => updateField('dob', value)}
                            hasError={Boolean(errors.dob)}
                            errorMessage={errors.dob}
                            minAge={18}
                            maxAge={100}
                        />
                    </Field>

                    <Field label="Location (City, State)" required error={errors.location}>
                        <TextInput
                            placeholder="Pune, Maharashtra"
                            placeholderTextColor="#7b8d96"
                            style={[styles.input, errors.location && styles.inputError]}
                            value={form.location}
                            onChangeText={(value) => updateField('location', value)}
                        />
                    </Field>

                    <Field label="Height (cm)" required error={errors.height_cm}>
                        <TextInput
                            keyboardType="number-pad"
                            placeholder="165"
                            placeholderTextColor="#7b8d96"
                            style={[styles.input, errors.height_cm && styles.inputError]}
                            value={form.height_cm ? String(form.height_cm) : ''}
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
                    <Field label="Profile Photos (At least 1 required)" required error={errors.photos}>
                        <View style={[styles.photoGrid, errors.photos && styles.photoGridError]}>
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

                    <Field label="Phone Number (Verified)" required error={errors.phone}>
                        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                            <TextInput
                                keyboardType={Platform.OS === 'web' ? 'default' : 'phone-pad'}
                                placeholder="+91 98765 43210"
                                placeholderTextColor="#7b8d96"
                                style={[styles.input, { flex: 1 }, errors.phone && styles.inputError]}
                                value={phoneNumber}
                                editable={!isPhoneVerified}
                                onChangeText={(val) => {
                                    setPhoneNumber(val);
                                    setIsPhoneVerified(false);
                                    if (errors.phone) {
                                        setErrors((prev) => {
                                            const n = { ...prev };
                                            delete n.phone;
                                            return n;
                                        });
                                    }
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

                    <Field label="WhatsApp Number" required error={errors.whatsapp}>
                        <TextInput
                            keyboardType={Platform.OS === 'web' ? 'default' : 'phone-pad'}
                            placeholder="+91 98765 43210"
                            placeholderTextColor="#7b8d96"
                            style={[styles.input, errors.whatsapp && styles.inputError]}
                            value={whatsappNumber}
                            onChangeText={(val) => {
                                setWhatsappNumber(val);
                                if (errors.whatsapp) {
                                    setErrors((prev) => {
                                        const n = { ...prev };
                                        delete n.whatsapp;
                                        return n;
                                    });
                                }
                            }}
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
                    <Field label="Religion" required error={errors.religion}>
                        <View style={[styles.choiceRowWrap, errors.religion && styles.choiceRowError]}>
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

                    <Field label="Mother Tongue" required error={errors.mother_tongue}>
                        <TextInput
                            placeholder="Hindi, Punjabi, Marathi..."
                            placeholderTextColor="#7b8d96"
                            style={[styles.input, errors.mother_tongue && styles.inputError]}
                            value={form.mother_tongue || ''}
                            onChangeText={(value) => updateField('mother_tongue', value)}
                        />
                    </Field>

                    <Field label="Education Level" required error={errors.education}>
                        <View style={[styles.choiceRowWrap, errors.education && styles.choiceRowError]}>
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

                    <Field label="Occupation / Designation" required error={errors.occupation}>
                        <TextInput
                            placeholder="Software Engineer, Business Owner, Doctor..."
                            placeholderTextColor="#7b8d96"
                            style={[styles.input, errors.occupation && styles.inputError]}
                            value={form.occupation || ''}
                            onChangeText={(value) => updateField('occupation', value)}
                        />
                    </Field>

                    <Field label="Company / Employer Name" required error={errors.company}>
                        <TextInput
                            placeholder="Tech Corp / Self-Employed"
                            placeholderTextColor="#7b8d96"
                            style={[styles.input, errors.company && styles.inputError]}
                            value={form.company || ''}
                            onChangeText={(value) => updateField('company', value)}
                        />
                    </Field>

                    <Field label="Annual Income Band" required error={errors.income_band}>
                        <View style={[styles.choiceRowWrap, errors.income_band && styles.choiceRowError]}>
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

                    <Field label="Marital Status" required error={errors.marital_status}>
                        <View style={[styles.choiceRowWrap, errors.marital_status && styles.choiceRowError]}>
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
                    <Field label="Family Type" required error={errors.family_type}>
                        <View style={[styles.choiceRow, errors.family_type && styles.choiceRowError]}>
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

                    <Field label="Family Status" required error={errors.family_status}>
                        <View style={[styles.choiceRow, errors.family_status && styles.choiceRowError]}>
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

                    <Field label="Number of Siblings" required error={errors.num_siblings}>
                        <TextInput
                            keyboardType="number-pad"
                            placeholder="0"
                            placeholderTextColor="#7b8d96"
                            style={[styles.input, errors.num_siblings && styles.inputError]}
                            value={String(form.num_siblings ?? 0)}
                            onChangeText={(value) => updateField('num_siblings', Number(value || 0))}
                        />
                    </Field>

                    <Field label="Diet Preference" required error={errors.diet}>
                        <View style={[styles.choiceRowWrap, errors.diet && styles.choiceRowError]}>
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

                    <Field label="Drinking Habits" required error={errors.drinks_alcohol}>
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

                    <Field label="Smoking Habits" required error={errors.smokes}>
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
                    <Field label="Bio / About Me" required error={errors.bio}>
                        <TextInput
                            multiline
                            placeholder="Share your values, family background, work, and lifestyle."
                            placeholderTextColor="#7b8d96"
                            style={[styles.input, styles.textarea, errors.bio && styles.inputError]}
                            textAlignVertical="top"
                            value={form.bio}
                            onChangeText={(value) => updateField('bio', value)}
                        />
                    </Field>

                    <Field label="Partner Preferences / Expectations" required error={errors.preferences}>
                        <TextInput
                            multiline
                            placeholder="Describe expected education, values, location, and lifestyle."
                            placeholderTextColor="#7b8d96"
                            style={[styles.input, styles.textareaLarge, errors.preferences && styles.inputError]}
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
            if (errors.photos) {
                setErrors((prev) => {
                    const n = { ...prev };
                    delete n.photos;
                    return n;
                });
            }
        } catch (error) {
            showFriendlyAlert('Photo Unavailable', error, 'Could not add this photo. Please grant photo permissions and try another image.');
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
        if (errors.gender) {
            setErrors((prev) => {
                const n = { ...prev };
                delete n.gender;
                return n;
            });
        }
    }

    const canUseCopilot = Boolean(form.full_name.trim() && form.location.trim());

    function validateCurrentStep(): boolean {
        const stepErrors: Record<string, string> = {};

        if (step === 0) {
            if (!form.full_name.trim()) {
                stepErrors.full_name = 'Full Name is required.';
            }
            if (!form.profile_owner) {
                stepErrors.profile_owner = 'Please select who manages this profile.';
            }
            if (!form.gender) {
                stepErrors.gender = 'Please select your gender.';
            }
            if (!form.partner_gender_preference) {
                stepErrors.partner_gender_preference = 'Please select partner preference.';
            }
            if (!form.dob || !/^\d{4}-\d{2}-\d{2}$/.test(form.dob.trim())) {
                stepErrors.dob = 'Please select your Date of Birth.';
            } else {
                const dob = new Date(form.dob.trim());
                const today = new Date();
                let age = today.getFullYear() - dob.getFullYear();
                const monthDiff = today.getMonth() - dob.getMonth();
                if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
                    age--;
                }
                if (isNaN(age) || age < 18) {
                    stepErrors.dob = 'You must be at least 18 years old to register.';
                } else if (age > 120) {
                    stepErrors.dob = 'Please enter a valid date of birth.';
                }
            }
            if (!form.location.trim()) {
                stepErrors.location = 'Location (City, State) is required.';
            }
            if (!form.height_cm || form.height_cm < 100 || form.height_cm > 250) {
                stepErrors.height_cm = 'Please enter a valid height between 100 cm and 250 cm.';
            }
        } else if (step === 1) {
            if (selectedPhotos.length === 0) {
                stepErrors.photos = 'Please add at least one profile photo.';
            }
            if (!phoneNumber.trim()) {
                stepErrors.phone = 'Phone number is required.';
            } else if (!isPhoneVerified) {
                stepErrors.phone = 'Please verify your phone number before proceeding.';
            }
            if (!whatsappNumber.trim()) {
                stepErrors.whatsapp = 'WhatsApp number is required.';
            }
        } else if (step === 2) {
            if (!form.religion) {
                stepErrors.religion = 'Please select your religion.';
            }
            if (!form.mother_tongue?.trim()) {
                stepErrors.mother_tongue = 'Mother tongue is required.';
            }
            if (!form.education) {
                stepErrors.education = 'Please select your education level.';
            }
            if (!form.occupation?.trim()) {
                stepErrors.occupation = 'Occupation / Designation is required.';
            }
            if (!form.company?.trim()) {
                stepErrors.company = 'Company or employer name is required.';
            }
            if (!form.income_band) {
                stepErrors.income_band = 'Please select your annual income band.';
            }
            if (!form.marital_status) {
                stepErrors.marital_status = 'Please select your marital status.';
            }
        } else if (step === 3) {
            if (!form.family_type) {
                stepErrors.family_type = 'Please select your family type.';
            }
            if (!form.family_status) {
                stepErrors.family_status = 'Please select your family status.';
            }
            if (form.num_siblings === undefined || form.num_siblings === null || isNaN(form.num_siblings) || form.num_siblings < 0) {
                stepErrors.num_siblings = 'Please enter number of siblings (0 or more).';
            }
            if (!form.diet) {
                stepErrors.diet = 'Please select your diet preference.';
            }
        } else if (step === 4) {
            if (!form.bio.trim()) {
                stepErrors.bio = 'Bio / About Me is required.';
            } else if (form.bio.trim().length < 15) {
                stepErrors.bio = 'Bio should be at least 15 characters to introduce yourself properly.';
            }
            if (!form.preferences.trim()) {
                stepErrors.preferences = 'Partner Preferences are required.';
            } else if (form.preferences.trim().length < 15) {
                stepErrors.preferences = 'Preferences should be at least 15 characters.';
            }
        }

        if (Object.keys(stepErrors).length > 0) {
            setErrors(stepErrors);
            Alert.alert('Required Fields Incomplete', 'Please fill in all mandatory fields highlighted in red to continue.');
            return false;
        }

        setErrors({});
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

            await setAnalyticsUser(form.full_name.trim());
            trackEvent('profile_completed');
            onComplete();
        } catch (error) {
            showFriendlyAlert('Save Failed', error, 'Could not save your profile. Please check your network and try again.');
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
            showFriendlyAlert('AI Assistant Busy', error, 'AI profile assistant is temporarily unavailable. You can write your own bio or try again in a moment.');
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
    error?: string;
    required?: boolean;
};

function Field({ label, children, error, required }: FieldProps) {
    return (
        <View style={styles.field}>
            <View style={styles.fieldLabelRow}>
                <Text style={styles.fieldLabel}>
                    {label} {required ? <Text style={styles.requiredStar}>*</Text> : null}
                </Text>
            </View>
            {children}
            {error ? <Text style={styles.errorText}>⚠️ {error}</Text> : null}
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
    fieldLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    fieldLabel: {
        color: '#34505c',
        fontSize: 13,
        fontWeight: '700',
    },
    requiredStar: {
        color: '#e53935',
        fontWeight: '800',
    },
    input: {
        backgroundColor: '#f7fafb',
        borderColor: '#d7e3e6',
        borderRadius: 12,
        borderWidth: 1.5,
        color: '#10232a',
        fontSize: 15,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    inputError: {
        borderColor: '#e53935',
        backgroundColor: '#fff8f8',
    },
    choiceRowError: {
        borderColor: '#e53935',
        borderWidth: 1.5,
        borderRadius: 12,
        padding: 6,
        backgroundColor: '#fff8f8',
    },
    photoGridError: {
        borderColor: '#e53935',
        borderWidth: 1.5,
        borderRadius: 14,
        padding: 8,
        backgroundColor: '#fff8f8',
    },
    errorText: {
        color: '#e53935',
        fontSize: 12,
        fontWeight: '600',
        marginTop: 2,
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
