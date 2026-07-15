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
import {
    profileGenders,
    partnerGenderPreferences,
    type ProfileOwner,
    type ProfileRecord,
    type ProfileRevision,
    type ProfileVariantTone,
} from '../lib/profile';
import { fetchCurrentProfile, upsertCurrentProfile } from '../lib/profileApi';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';
import {
    generateProfileVariants,
    fetchProfileRevisions,
    saveProfileRevision,
} from '../lib/aiApi';

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
    preferences: string;
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

function formatRevisionDate(dateStr: string) {
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
        return dateStr;
    }
}

function profileToEditable(p: ProfileRecord): EditableProfile {
    return {
        full_name: p.full_name ?? '',
        gender: p.gender ?? '',
        partner_gender_preference: p.partner_gender_preference ?? '',
        dob: p.dob ?? '',
        location: p.location ?? '',
        bio: p.bio ?? '',
        preferences: p.preferences ?? '',
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

    // Ghostwriter States
    const [ghostwriterOpen, setGhostwriterOpen] = useState(false);
    const [tone, setTone] = useState<ProfileVariantTone>('balanced');
    const [section, setSection] = useState<'both' | 'bio' | 'preferences'>('both');
    const [refinement, setRefinement] = useState('');
    const [generating, setGenerating] = useState(false);
    const [preview, setPreview] = useState<{ bio: string; preferences: string; summary: string } | null>(null);
    const [undoStack, setUndoStack] = useState<EditableProfile[]>([]);

    // Revision History States
    const [revisions, setRevisions] = useState<ProfileRevision[]>([]);
    const [loadingRevisions, setLoadingRevisions] = useState(false);

    const loadRevisions = useCallback(async () => {
        setLoadingRevisions(true);
        try {
            const data = await fetchProfileRevisions();
            setRevisions(data);
        } catch (e) {
            console.error('Failed to fetch profile revisions:', e);
        } finally {
            setLoadingRevisions(false);
        }
    }, []);

    useEffect(() => {
        fetchCurrentProfile()
            .then((p) => {
                if (p) {
                    setForm(profileToEditable(p));
                }
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (form) {
            void loadRevisions();
        }
    }, [form ? true : false]);

    const set = useCallback(<K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) => {
        isDirtyRef.current = true;
        setForm((prev) => prev ? { ...prev, [key]: value } : prev);
    }, []);

    const handleGenerate = async () => {
        if (!form) return;
        setGenerating(true);
        setPreview(null);
        try {
            const inputPayload = {
                full_name: form.full_name,
                gender: form.gender,
                partner_gender_preference: form.partner_gender_preference,
                dob: form.dob,
                location: form.location,
                bio: form.bio,
                preferences: form.preferences,
                height_cm: form.height_cm ? Number(form.height_cm) : undefined,
                profile_owner: form.profile_owner,
            };

            const sec = section === 'both' ? undefined : section;
            const res = await generateProfileVariants(inputPayload, tone, refinement, sec);

            setPreview({
                bio: res.bio || (section === 'preferences' ? '' : form.bio),
                preferences: res.preferences || (section === 'bio' ? '' : form.preferences),
                summary: res.summary || '',
            });
        } catch (e: any) {
            Alert.alert('AI Ghostwriter Error', e?.message ?? 'Failed to generate rewrite.');
        } finally {
            setGenerating(false);
        }
    };

    const handleApply = async () => {
        if (!form || !preview) return;
        setUndoStack((prev) => [...prev, { ...form }]);

        const updatedBio = section === 'preferences' ? form.bio : (preview.bio || form.bio);
        const updatedPrefs = section === 'bio' ? form.preferences : (preview.preferences || form.preferences);

        setForm((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                bio: updatedBio,
                preferences: updatedPrefs,
            };
        });

        isDirtyRef.current = true;

        try {
            await saveProfileRevision(tone, updatedBio, updatedPrefs, 'ai', refinement || undefined);
            void loadRevisions();
        } catch (e) {
            console.error('Failed to auto-save AI profile revision:', e);
        }

        setPreview(null);
        setRefinement('');
        Alert.alert('Applied', 'AI rewrite applied to draft. Remember to tap Save Profile at the bottom to finalize.');
    };

    const handleUndo = () => {
        if (undoStack.length === 0) return;
        const previousState = undoStack[undoStack.length - 1];
        setUndoStack((prev) => prev.slice(0, -1));
        setForm(previousState);
        isDirtyRef.current = true;
        Alert.alert('Undone', 'Reverted to the previous state.');
    };

    const handleRestoreRevision = (rev: ProfileRevision) => {
        if (!form) return;
        Alert.alert(
            'Restore Revision',
            `Are you sure you want to restore revision #${rev.revision_number} (${rev.source === 'ai' ? 'AI ' + rev.tone : 'Manual'})?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Restore',
                    onPress: () => {
                        setUndoStack((prev) => [...prev, { ...form }]);
                        setForm((prev) => {
                            if (!prev) return prev;
                            return {
                                ...prev,
                                bio: rev.bio,
                                preferences: rev.preferences,
                            };
                        });
                        isDirtyRef.current = true;
                        Alert.alert('Restored', 'Loaded revision into draft fields. Save profile to finalize.');
                    },
                },
            ]
        );
    };

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
                preferences: form.preferences.trim(),
                photo_urls: [],
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

            try {
                await saveProfileRevision('manual', form.bio.trim(), form.preferences.trim(), 'manual');
            } catch (revErr) {
                console.warn('Failed to save manual profile revision:', revErr);
            }

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
                            <Field label="Partner Preferences">
                                <TextInput style={[styles.input, styles.textArea]} value={form.preferences}
                                    onChangeText={(t) => set('preferences', t)} multiline numberOfLines={4}
                                    placeholder="Describe values, location preferences, education, lifestyle, and family expectations…" placeholderTextColor="#bbb" />
                            </Field>

                            {/* ── AI Ghostwriter Section ── */}
                            <View style={styles.ghostwriterContainer}>
                                <Pressable
                                    style={styles.ghostwriterHeaderBtn}
                                    onPress={() => setGhostwriterOpen(!ghostwriterOpen)}
                                >
                                    <View style={styles.ghostwriterHeaderLeft}>
                                        <Text style={styles.ghostwriterEmoji}>✨</Text>
                                        <Text style={styles.ghostwriterTitle}>AI Ghostwriter</Text>
                                    </View>
                                    <Text style={styles.ghostwriterToggleText}>
                                        {ghostwriterOpen ? 'Hide Panel' : 'Optimize Profile'}
                                    </Text>
                                </Pressable>

                                {ghostwriterOpen && (
                                    <View style={styles.ghostwriterBody}>
                                        <Text style={styles.ghostwriterDescription}>
                                            Refine your bio and partner preferences to maximize matching and alignment scores.
                                        </Text>

                                        <Text style={styles.ghostwriterSublabel}>Tone Variant</Text>
                                        <View style={styles.row}>
                                            {(['balanced', 'witty', 'sincere'] as const).map((t) => (
                                                <Pressable
                                                    key={t}
                                                    style={[styles.ghostChip, tone === t && styles.ghostChipActive]}
                                                    onPress={() => setTone(t)}
                                                >
                                                    <Text style={[styles.ghostChipText, tone === t && styles.ghostChipTextActive]}>
                                                        {t.charAt(0).toUpperCase() + t.slice(1)}
                                                    </Text>
                                                </Pressable>
                                            ))}
                                        </View>

                                        <Text style={styles.ghostwriterSublabel}>Target Section</Text>
                                        <View style={styles.row}>
                                            {(['both', 'bio', 'preferences'] as const).map((s) => (
                                                <Pressable
                                                    key={s}
                                                    style={[styles.ghostChip, section === s && styles.ghostChipActive]}
                                                    onPress={() => setSection(s)}
                                                >
                                                    <Text style={[styles.ghostChipText, section === s && styles.ghostChipTextActive]}>
                                                        {s === 'both' ? 'Both' : s === 'bio' ? 'Bio Only' : 'Preferences Only'}
                                                    </Text>
                                                </Pressable>
                                            ))}
                                        </View>

                                        <Text style={styles.ghostwriterSublabel}>Custom Instructions (Optional)</Text>
                                        <TextInput
                                            style={styles.ghostInput}
                                            placeholder="e.g. 'focus on travel', 'sound warm', 'make it shorter'"
                                            placeholderTextColor="#999"
                                            value={refinement}
                                            onChangeText={setRefinement}
                                        />

                                        <View style={styles.ghostActionRow}>
                                            <Pressable
                                                style={[styles.ghostBtn, generating && styles.ghostBtnDisabled]}
                                                onPress={handleGenerate}
                                                disabled={generating}
                                            >
                                                {generating ? (
                                                    <ActivityIndicator color="#fff" size="small" />
                                                ) : (
                                                    <Text style={styles.ghostBtnText}>Generate Proposal</Text>
                                                )}
                                            </Pressable>

                                            {undoStack.length > 0 && (
                                                <Pressable style={styles.ghostUndoBtn} onPress={handleUndo}>
                                                    <Text style={styles.ghostUndoBtnText}>Undo ({undoStack.length})</Text>
                                                </Pressable>
                                            )}
                                        </View>

                                        {/* AI Preview Section */}
                                        {preview && (
                                            <View style={styles.previewContainer}>
                                                <Text style={styles.previewTitle}>✨ AI Rewrite Proposal</Text>

                                                {preview.summary ? (
                                                    <View style={styles.summaryBadge}>
                                                        <Text style={styles.summaryText}>AI Summary: {preview.summary}</Text>
                                                    </View>
                                                ) : null}

                                                {section !== 'preferences' && preview.bio && (
                                                    <View style={styles.previewField}>
                                                        <Text style={styles.previewFieldLabel}>Proposed Bio</Text>
                                                        <Text style={styles.previewFieldText}>{preview.bio}</Text>
                                                    </View>
                                                )}

                                                {section !== 'bio' && preview.preferences && (
                                                    <View style={styles.previewField}>
                                                        <Text style={styles.previewFieldLabel}>Proposed Preferences</Text>
                                                        <Text style={styles.previewFieldText}>{preview.preferences}</Text>
                                                    </View>
                                                )}

                                                <View style={styles.previewActions}>
                                                    <Pressable style={styles.applyBtn} onPress={handleApply}>
                                                        <Text style={styles.applyBtnText}>Apply to Draft</Text>
                                                    </Pressable>
                                                    <Pressable style={styles.discardBtn} onPress={() => setPreview(null)}>
                                                        <Text style={styles.discardBtnText}>Discard</Text>
                                                    </Pressable>
                                                </View>
                                            </View>
                                        )}
                                    </View>
                                )}
                            </View>
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

                        {/* ── Revision History ── */}
                        <SectionCard title="Revision History">
                            {loadingRevisions ? (
                                <ActivityIndicator color="#123340" size="small" style={{ marginVertical: 12 }} />
                            ) : revisions.length === 0 ? (
                                <Text style={styles.emptyHistoryText}>No revisions saved yet. Revisions are created when you save your profile or apply AI rewrites.</Text>
                            ) : (
                                revisions.map((rev, idx) => (
                                    <View key={rev.id || idx} style={styles.revisionItem}>
                                        <View style={styles.revisionHeader}>
                                            <View style={{ flex: 1, paddingRight: 8 }}>
                                                <Text style={styles.revisionTitle}>
                                                    Rev #{rev.revision_number} • {rev.source === 'ai' ? `AI (${rev.tone})` : 'Manual Edit'}
                                                </Text>
                                                <Text style={styles.revisionDate}>
                                                    {formatRevisionDate(rev.created_at)}
                                                </Text>
                                            </View>
                                            <Pressable
                                                style={styles.restoreBtn}
                                                onPress={() => handleRestoreRevision(rev)}
                                            >
                                                <Text style={styles.restoreBtnText}>Restore</Text>
                                            </Pressable>
                                        </View>
                                        {rev.bio ? (
                                            <Text style={styles.revisionSnippet} numberOfLines={2}>
                                                Bio: {rev.bio}
                                            </Text>
                                        ) : null}
                                        {rev.preferences ? (
                                            <Text style={styles.revisionSnippet} numberOfLines={2}>
                                                Prefs: {rev.preferences}
                                            </Text>
                                        ) : null}
                                        {idx < revisions.length - 1 && <View style={styles.revisionDivider} />}
                                    </View>
                                ))
                            )}
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

    // Ghostwriter Styles
    row: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
    ghostwriterContainer: {
        backgroundColor: '#fff',
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: '#e1e3e5',
        padding: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    ghostwriterHeaderBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    ghostwriterHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    ghostwriterEmoji: { fontSize: 18 },
    ghostwriterTitle: { fontSize: 15, fontWeight: '600', color: '#123340' },
    ghostwriterToggleText: { fontSize: 14, fontWeight: '600', color: '#1a7a5e' },
    ghostwriterBody: { marginTop: 14 },
    ghostwriterDescription: { fontSize: 13, color: '#666', marginBottom: 14, lineHeight: 18 },
    ghostwriterSublabel: { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', marginBottom: 6, letterSpacing: 0.5 },
    ghostChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#dcdcdc', backgroundColor: '#fafafa' },
    ghostChipActive: { borderColor: '#123340', backgroundColor: '#eef3f5' },
    ghostChipText: { fontSize: 13, color: '#555' },
    ghostChipTextActive: { color: '#123340', fontWeight: '600' },
    ghostInput: { borderWidth: 1, borderColor: '#dcdcdc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#333', backgroundColor: '#fafafa', marginBottom: 14 },
    ghostActionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
    ghostBtn: { flex: 1, backgroundColor: '#123340', paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    ghostBtnDisabled: { opacity: 0.6 },
    ghostBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    ghostUndoBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#dcdcdc', alignItems: 'center' },
    ghostUndoBtnText: { color: '#555', fontSize: 14, fontWeight: '500' },
    previewContainer: { backgroundColor: '#f6fdfa', borderWidth: 1, borderColor: '#a3e2c9', borderRadius: 8, padding: 14 },
    previewTitle: { fontSize: 14, fontWeight: '700', color: '#1a7a5e', marginBottom: 10 },
    summaryBadge: { backgroundColor: '#e6f7f0', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, alignSelf: 'flex-start', marginBottom: 10 },
    summaryText: { fontSize: 12, color: '#1a7a5e', fontWeight: '500' },
    previewField: { marginBottom: 10 },
    previewFieldLabel: { fontSize: 11, fontWeight: '600', color: '#888', textTransform: 'uppercase', marginBottom: 2 },
    previewFieldText: { fontSize: 13, color: '#333', lineHeight: 18 },
    previewActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
    applyBtn: { flex: 1, backgroundColor: '#1a7a5e', paddingVertical: 10, borderRadius: 6, alignItems: 'center' },
    applyBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    discardBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 6, borderWidth: 1, borderColor: '#dcdcdc', alignItems: 'center' },
    discardBtnText: { color: '#666', fontSize: 13, fontWeight: '500' },
    emptyHistoryText: { fontSize: 13, color: '#666', fontStyle: 'italic', textAlign: 'center', paddingVertical: 10 },
    revisionItem: { marginVertical: 8 },
    revisionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    revisionTitle: { fontSize: 14, fontWeight: '600', color: '#222' },
    revisionDate: { fontSize: 11, color: '#888' },
    restoreBtn: { backgroundColor: '#eef3f5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, borderWidth: 1, borderColor: '#123340' },
    restoreBtnText: { color: '#123340', fontSize: 12, fontWeight: '600' },
    revisionSnippet: { fontSize: 12, color: '#666', lineHeight: 16, marginTop: 2 },
    revisionDivider: { height: 1, backgroundColor: '#f0f0f0', marginVertical: 10 },
});
