// src/screens/ProfileEditScreen.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../components/BackButton';
import { ChipPicker } from '../components/prefs/ChipPicker';
import { SectionCard } from '../components/prefs/SectionCard';
import { profileGenders, partnerGenderPreferences, type ProfileOwner, type ProfileRecord } from '../lib/profile';
import { fetchCurrentProfile, upsertCurrentProfile } from '../lib/profileApi';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';

// ---------------------------------------------------------------------------
// Option constants
// ---------------------------------------------------------------------------

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
const PROFILE_OWNER_OPTIONS: ProfileOwner[] = ['self', 'parent', 'sibling', 'relative'];
const PROFILE_OWNER_LABELS: Record<ProfileOwner, string> = {
    self: 'Self', parent: 'Parent', sibling: 'Sibling', relative: 'Relative',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EditableProfile = {
    full_name: string;
    gender: string;
    partner_gender_preference: string;
    dob: string;
    location: string;
    bio: string;
    height_cm: string;          // string for TextInput, convert on save
    profile_owner: ProfileOwner;
    religion: string;
    marital_status: string;
    education: string;
    diet: string;
    mother_tongue: string;
    income_band: string;
    occupation: string;
    company: string;
    family_type: string;
    family_status: string;
    num_siblings: string;       // string for TextInput
    drinks_alcohol: boolean;
    smokes: boolean;
};

function profileToEditable(p: ProfileRecord): EditableProfile {
    return {
        full_name: p.full_name ?? '',
        gender: p.gender ?? '',
        partner_gender_preference: p.partner_gender_preference ?? '',
        dob: p.dob ?? '',
        location: p.location ?? '',
        bio: p.bio ?? '',
        height_cm: p.height_cm !== null ? String(p.height_cm) : '',
        profile_owner: p.profile_owner ?? 'self',
        religion: p.religion ?? '',
        marital_status: p.marital_status ?? '',
        education: p.education ?? '',
        diet: p.diet ?? '',
        mother_tongue: p.mother_tongue ?? '',
        income_band: p.income_band ?? '',
        occupation: p.occupation ?? '',
        company: p.company ?? '',
        family_type: p.family_type ?? '',
        family_status: p.family_status ?? '',
        num_siblings: p.num_siblings !== null ? String(p.num_siblings) : '',
        drinks_alcohol: p.drinks_alcohol ?? false,
        smokes: p.smokes ?? false,
    };
}

function validate(f: EditableProfile): string | null {
    if (!f.full_name.trim()) return 'Full name is required.';
    if (!f.dob.trim()) return 'Date of birth is required.';
    if (!f.location.trim()) return 'Location is required.';
    if (f.height_cm && (isNaN(Number(f.height_cm)) || Number(f.height_cm) < 100 || Number(f.height_cm) > 250)) {
        return 'Height must be between 100 and 250 cm.';
    }
    if (f.num_siblings && (isNaN(Number(f.num_siblings)) || Number(f.num_siblings) < 0)) {
        return 'Number of siblings must be 0 or more.';
    }
    return null;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

interface Props {
    onBack: () => void;
    onSaved?: () => void;
}

export function ProfileEditScreen({ onBack, onSaved }: Props) {
    const insets = useSafeAreaInsets();
    const [form, setForm] = useState<EditableProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const isDirtyRef = useRef(false);

    useEffect(() => {
        fetchCurrentProfile()
            .then((p) => { if (p) setForm(profileToEditable(p)); })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    const set = useCallback(<K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) => {
        isDirtyRef.current = true;
        setForm((prev) => prev ? { ...prev, [key]: value } : prev);
    }, []);

    const handleSave = useCallback(async () => {
        if (!form) return;
        const err = validate(form);
        if (err) { Alert.alert('Validation Error', err); return; }
        setSaving(true);
        try {
            await upsertCurrentProfile({
                full_name: form.full_name.trim(),
                gender: form.gender,
                partner_gender_preference: form.partner_gender_preference,
                dob: form.dob.trim(),
                location: form.location.trim(),
                bio: form.bio.trim(),
                preferences: '',  // preserved field for legacy compat
                photo_urls: [],   // managed separately via photo manager
                height_cm: form.height_cm ? Number(form.height_cm) : 0,
                profile_owner: form.profile_owner,
                religion: form.religion || null,
                marital_status: form.marital_status || null,
                education: form.education || null,
                diet: form.diet || null,
                mother_tongue: form.mother_tongue || null,
                income_band: form.income_band || null,
                occupation: form.occupation || null,
                company: form.company || null,
                family_type: form.family_type || null,
                family_status: form.family_status || null,
                num_siblings: form.num_siblings ? Number(form.num_siblings) : null,
                drinks_alcohol: form.drinks_alcohol,
                smokes: form.smokes,
            });
            isDirtyRef.current = false;
            onSaved?.();
            onBack();
        } catch (e: any) {
            Alert.alert('Save Failed', e?.message ?? 'Please try again.');
        } finally {
            setSaving(false);
        }
    }, [form, onBack, onSaved]);

    const handleBack = useCallback(() => {
        if (!isDirtyRef.current) { onBack(); return; }
        Alert.alert('Unsaved Changes', 'Discard changes?', [
            { text: 'Keep Editing', style: 'cancel' },
            { text: 'Discard', style: 'destructive', onPress: onBack },
        ]);
    }, [onBack]);

    if (loading || !form) {
        return (
            <SafeAreaView style={styles.loading} edges={['top', 'left', 'right']}>
                <ActivityIndicator size="large" color="#123340" />
                <Text style={styles.loadingText}>Loading profile…</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <BackButton onPress={handleBack} />
                <Text style={styles.headerTitle}>Edit Profile</Text>
                <View style={{ width: 36 }} />
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={insets.top + 56}
            >
                <ScrollView
                    contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.inner}>

                        {/* ── About ── */}
                        <SectionCard title="About You">
                            <Field label="Full name *">
                                <TextInput style={styles.input} value={form.full_name}
                                    onChangeText={(t) => set('full_name', t)} autoCapitalize="words" />
                            </Field>
                            <Field label="Bio">
                                <TextInput style={[styles.input, styles.textArea]} value={form.bio}
                                    onChangeText={(t) => set('bio', t)} multiline numberOfLines={4}
                                    placeholder="Tell people about yourself…" placeholderTextColor="#bbb" />
                            </Field>
                            <Field label="Date of birth *  (YYYY-MM-DD)">
                                <TextInput style={styles.input} value={form.dob}
                                    onChangeText={(t) => set('dob', t)} placeholder="1995-06-15"
                                    placeholderTextColor="#bbb" keyboardType="numbers-and-punctuation" />
                            </Field>
                            <Field label="Location *">
                                <TextInput style={styles.input} value={form.location}
                                    onChangeText={(t) => set('location', t)}
                                    placeholder="Mumbai, India" placeholderTextColor="#bbb" />
                            </Field>
                            <Field label="Mother tongue">
                                <TextInput style={styles.input} value={form.mother_tongue}
                                    onChangeText={(t) => set('mother_tongue', t)}
                                    placeholder="e.g. Hindi, Tamil…" placeholderTextColor="#bbb"
                                    autoCapitalize="words" />
                            </Field>
                            <Field label="Gender">
                                <ChipPicker options={profileGenders} selected={form.gender as any}
                                    onSelect={(v) => set('gender', v)} />
                            </Field>
                            <Field label="Looking for">
                                <ChipPicker options={partnerGenderPreferences} selected={form.partner_gender_preference as any}
                                    onSelect={(v) => set('partner_gender_preference', v)} />
                            </Field>
                            <Field label="Profile managed by">
                                <ChipPicker options={PROFILE_OWNER_OPTIONS}
                                    labels={PROFILE_OWNER_LABELS as any}
                                    selected={form.profile_owner}
                                    onSelect={(v) => set('profile_owner', v)} />
                            </Field>
                            <Field label="Religion">
                                <ChipPicker options={RELIGIONS} selected={form.religion as any}
                                    onSelect={(v) => set('religion', v)} />
                            </Field>
                            <Field label="Marital status">
                                <ChipPicker options={MARITAL_STATUSES}
                                    labels={MARITAL_STATUS_LABELS as any}
                                    selected={form.marital_status as any}
                                    onSelect={(v) => set('marital_status', v)} />
                            </Field>
                        </SectionCard>

                        {/* ── Career & Education ── */}
                        <SectionCard title="Career &amp; Education">
                            <Field label="Occupation">
                                <TextInput style={styles.input} value={form.occupation}
                                    onChangeText={(t) => set('occupation', t)}
                                    placeholder="e.g. Software Engineer" placeholderTextColor="#bbb"
                                    autoCapitalize="words" />
                            </Field>
                            <Field label="Company / Organisation">
                                <TextInput style={styles.input} value={form.company}
                                    onChangeText={(t) => set('company', t)}
                                    placeholder="e.g. Infosys" placeholderTextColor="#bbb"
                                    autoCapitalize="words" />
                            </Field>
                            <Field label="Education">
                                <ChipPicker options={EDUCATIONS} selected={form.education as any}
                                    onSelect={(v) => set('education', v)} />
                            </Field>
                            <Field label="Annual income">
                                <ChipPicker options={INCOME_BANDS}
                                    labels={INCOME_BAND_LABELS as any}
                                    selected={form.income_band as any}
                                    onSelect={(v) => set('income_band', v)} />
                            </Field>
                        </SectionCard>

                        {/* ── Physical ── */}
                        <SectionCard title="Physical">
                            <Field label="Height (cm)">
                                <TextInput style={styles.input} value={form.height_cm}
                                    onChangeText={(t) => set('height_cm', t)}
                                    keyboardType="number-pad" maxLength={3}
                                    placeholder="170" placeholderTextColor="#bbb" />
                            </Field>
                        </SectionCard>

                        {/* ── Family ── */}
                        <SectionCard title="Family">
                            <Field label="Family type">
                                <ChipPicker options={FAMILY_TYPES}
                                    labels={FAMILY_TYPE_LABELS as any}
                                    selected={form.family_type as any}
                                    onSelect={(v) => set('family_type', v)} />
                            </Field>
                            <Field label="Family status">
                                <ChipPicker options={FAMILY_STATUSES}
                                    labels={FAMILY_STATUS_LABELS as any}
                                    selected={form.family_status as any}
                                    onSelect={(v) => set('family_status', v)} />
                            </Field>
                            <Field label="Number of siblings">
                                <TextInput style={styles.input} value={form.num_siblings}
                                    onChangeText={(t) => set('num_siblings', t)}
                                    keyboardType="number-pad" maxLength={2}
                                    placeholder="2" placeholderTextColor="#bbb" />
                            </Field>
                        </SectionCard>

                        {/* ── Lifestyle ── */}
                        <SectionCard title="Lifestyle">
                            <Field label="Diet">
                                <ChipPicker options={DIETS} selected={form.diet as any}
                                    onSelect={(v) => set('diet', v)} />
                            </Field>
                            <ToggleRow
                                label="Drinks alcohol"
                                value={form.drinks_alcohol}
                                onChange={(v) => set('drinks_alcohol', v)}
                            />
                            <ToggleRow
                                label="Smokes"
                                value={form.smokes}
                                onChange={(v) => set('smokes', v)}
                            />
                        </SectionCard>

                    </View>
                </ScrollView>
            </KeyboardAvoidingView>

            <View style={[styles.saveBar, { paddingBottom: insets.bottom + 12 }]}>
                <Pressable
                    style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                    onPress={handleSave}
                    disabled={saving}
                >
                    {saving
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={styles.saveButtonText}>Save Profile</Text>
                    }
                </Pressable>
            </View>
        </SafeAreaView>
    );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <View style={styles.field}>
            <Text style={styles.fieldLabel}>{label}</Text>
            {children}
        </View>
    );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
        <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>{label}</Text>
            <Switch
                value={value}
                onValueChange={onChange}
                trackColor={{ false: '#d0d0d0', true: '#123340' }}
                thumbColor="#fff"
            />
        </View>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#f4f4f6' },
    loading: { flex: 1, backgroundColor: '#f4f4f6', alignItems: 'center', justifyContent: 'center', gap: 12 },
    loadingText: { fontSize: 14, color: '#666' },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e5e5',
    },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#111' },
    scroll: { paddingTop: 16 },
    inner: { maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center', paddingHorizontal: 16 },
    field: { marginBottom: 14 },
    fieldLabel: { fontSize: 12, color: '#888', fontWeight: '500', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
    input: {
        borderWidth: 1.5, borderColor: '#d0d0d0', borderRadius: 10,
        paddingHorizontal: 14, paddingVertical: 11,
        fontSize: 15, color: '#111', backgroundColor: '#fafafa',
    },
    textArea: { height: 100, textAlignVertical: 'top', paddingTop: 12 },
    toggleRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f0f0f0',
    },
    toggleLabel: { fontSize: 15, color: '#222' },
    saveBar: { paddingTop: 12, paddingHorizontal: 20, backgroundColor: '#fff', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e5e5' },
    saveButton: { backgroundColor: '#123340', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
    saveButtonDisabled: { opacity: 0.6 },
    saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
