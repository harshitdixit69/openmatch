// src/screens/PartnerPreferencesScreen.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../components/BackButton';
import { ChipPicker, MultiChipPicker } from '../components/prefs/ChipPicker';
import { AgeRangeRow } from '../components/prefs/AgeRangeRow';
import { HeightRangeRow } from '../components/prefs/HeightRangeRow';
import { SectionCard } from '../components/prefs/SectionCard';
import {
    DEFAULT_PARTNER_PREFERENCES,
    PREF_DIETS,
    PREF_EDUCATIONS,
    PREF_INCOME_BAND_LABELS,
    PREF_INCOME_BANDS,
    PREF_LOCATION_FLEXIBILITY_LABELS,
    PREF_LOCATION_FLEXIBILITIES,
    PREF_MARITAL_STATUS_LABELS,
    PREF_MARITAL_STATUSES,
    PREF_RELIGIONS,
    validatePartnerPreferences,
    type PartnerPreferences,
    type PrefMaritalStatus,
} from '../lib/partnerPreferences';
import { fetchPartnerPreferences, upsertPartnerPreferences } from '../lib/partnerPreferencesApi';
import { MAX_CONTENT_WIDTH } from '../lib/responsiveLayout';

interface Props {
    onBack: () => void;
}

export function PartnerPreferencesScreen({ onBack }: Props) {
    const insets = useSafeAreaInsets();
    const [prefs, setPrefs] = useState<PartnerPreferences>(DEFAULT_PARTNER_PREFERENCES);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const isDirtyRef = useRef(false);

    useEffect(() => {
        fetchPartnerPreferences()
            .then((p) => {
                if (p) setPrefs(p);
            })
            .catch(() => {/* use defaults */ })
            .finally(() => setLoading(false));
    }, []);

    const set = useCallback(<K extends keyof PartnerPreferences>(
        key: K,
        value: PartnerPreferences[K],
    ) => {
        isDirtyRef.current = true;
        setPrefs((prev) => ({ ...prev, [key]: value }));
    }, []);

    const toggleMaritalStatus = useCallback((status: PrefMaritalStatus) => {
        isDirtyRef.current = true;
        setPrefs((prev) => ({
            ...prev,
            pref_marital_status: prev.pref_marital_status.includes(status)
                ? prev.pref_marital_status.filter((s) => s !== status)
                : [...prev.pref_marital_status, status],
        }));
    }, []);

    const handleSave = useCallback(async () => {
        const err = validatePartnerPreferences(prefs);
        if (err) {
            Alert.alert('Invalid Preferences', err);
            return;
        }
        setSaving(true);
        try {
            await upsertPartnerPreferences(prefs);
            isDirtyRef.current = false;
            onBack();
        } catch (e: any) {
            Alert.alert('Save Failed', e?.message ?? 'Please try again.');
        } finally {
            setSaving(false);
        }
    }, [prefs, onBack]);

    const handleBack = useCallback(() => {
        if (!isDirtyRef.current) {
            onBack();
            return;
        }
        Alert.alert(
            'Unsaved Changes',
            'You have unsaved changes. Discard them?',
            [
                { text: 'Keep Editing', style: 'cancel' },
                { text: 'Discard', style: 'destructive', onPress: onBack },
            ],
        );
    }, [onBack]);

    if (loading) {
        return (
            <SafeAreaView style={styles.loadingContainer} edges={['top', 'left', 'right']}>
                <ActivityIndicator size="large" color="#123340" />
                <Text style={styles.loadingText}>Loading your preferences…</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            {/* Header */}
            <View style={styles.header}>
                <BackButton onPress={handleBack} />
                <Text style={styles.headerTitle}>Partner Preferences</Text>
                <View style={styles.headerRight} />
            </View>

            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={insets.top + 56}
            >
                <ScrollView
                    contentContainerStyle={[
                        styles.scrollContent,
                        { paddingBottom: insets.bottom + 100 },
                    ]}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.inner}>

                        {/* Age */}
                        <SectionCard title="Age Range">
                            <AgeRangeRow
                                min={prefs.pref_age_min}
                                max={prefs.pref_age_max}
                                onChange={(min, max) => {
                                    isDirtyRef.current = true;
                                    setPrefs((p) => ({ ...p, pref_age_min: min, pref_age_max: max }));
                                }}
                            />
                        </SectionCard>

                        {/* Height */}
                        <SectionCard title="Height Range">
                            <HeightRangeRow
                                min={prefs.pref_height_min}
                                max={prefs.pref_height_max}
                                onChange={(min, max) => {
                                    isDirtyRef.current = true;
                                    setPrefs((p) => ({ ...p, pref_height_min: min, pref_height_max: max }));
                                }}
                            />
                        </SectionCard>

                        {/* Religion */}
                        <SectionCard title="Religion">
                            <ChipPicker
                                options={PREF_RELIGIONS}
                                selected={prefs.pref_religion}
                                onSelect={(v) => set('pref_religion', v)}
                            />
                        </SectionCard>

                        {/* Marital Status */}
                        <SectionCard title="Marital Status">
                            <Text style={styles.hint}>Select all you're open to</Text>
                            <MultiChipPicker
                                options={PREF_MARITAL_STATUSES}
                                labels={PREF_MARITAL_STATUS_LABELS}
                                selected={prefs.pref_marital_status}
                                onToggle={toggleMaritalStatus}
                            />
                        </SectionCard>

                        {/* Education */}
                        <SectionCard title="Education">
                            <ChipPicker
                                options={PREF_EDUCATIONS}
                                selected={prefs.pref_education}
                                onSelect={(v) => set('pref_education', v)}
                            />
                        </SectionCard>

                        {/* Diet */}
                        <SectionCard title="Diet">
                            <ChipPicker
                                options={PREF_DIETS}
                                selected={prefs.pref_diet}
                                onSelect={(v) => set('pref_diet', v)}
                            />
                        </SectionCard>

                        {/* Income */}
                        <SectionCard title="Annual Income">
                            <ChipPicker
                                options={PREF_INCOME_BANDS}
                                labels={PREF_INCOME_BAND_LABELS as any}
                                selected={prefs.pref_income_band}
                                onSelect={(v) => set('pref_income_band', v)}
                            />
                        </SectionCard>

                        {/* Location Flexibility */}
                        <SectionCard title="Location Flexibility">
                            <ChipPicker
                                options={PREF_LOCATION_FLEXIBILITIES}
                                labels={PREF_LOCATION_FLEXIBILITY_LABELS as any}
                                selected={prefs.pref_location_flexibility}
                                onSelect={(v) => set('pref_location_flexibility', v)}
                            />
                        </SectionCard>

                        {/* Mother Tongue */}
                        <SectionCard title="Mother Tongue">
                            <TextInput
                                style={styles.textInput}
                                value={prefs.pref_mother_tongue ?? ''}
                                placeholder="e.g. Hindi, Tamil, Marathi…"
                                placeholderTextColor="#bbb"
                                onChangeText={(t) => set('pref_mother_tongue', t.trim() || null)}
                                autoCapitalize="words"
                            />
                            <Text style={styles.hint}>Leave blank to accept any language</Text>
                        </SectionCard>

                    </View>
                </ScrollView>
            </KeyboardAvoidingView>

            {/* Sticky save button */}
            <View style={[styles.saveBar, { paddingBottom: insets.bottom + 12 }]}>
                <Pressable
                    style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                    onPress={handleSave}
                    disabled={saving}
                >
                    {saving ? (
                        <ActivityIndicator color="#fff" size="small" />
                    ) : (
                        <Text style={styles.saveButtonText}>Save Preferences</Text>
                    )}
                </Pressable>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { flex: 1, backgroundColor: '#f4f4f6' },
    loadingContainer: {
        flex: 1,
        backgroundColor: '#f4f4f6',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
    },
    loadingText: { fontSize: 14, color: '#666' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#e5e5e5',
    },
    headerTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 17,
        fontWeight: '600',
        color: '#111',
    },
    headerRight: { width: 36 },
    scrollContent: { paddingTop: 16 },
    inner: {
        maxWidth: MAX_CONTENT_WIDTH,
        width: '100%',
        alignSelf: 'center',
        paddingHorizontal: 16,
    },
    hint: {
        fontSize: 12,
        color: '#999',
        marginBottom: 10,
    },
    textInput: {
        borderWidth: 1.5,
        borderColor: '#d0d0d0',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 11,
        fontSize: 15,
        color: '#111',
        backgroundColor: '#fafafa',
        marginBottom: 6,
    },
    saveBar: {
        paddingTop: 12,
        paddingHorizontal: 20,
        backgroundColor: '#fff',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#e5e5e5',
    },
    saveButton: {
        backgroundColor: '#123340',
        borderRadius: 12,
        paddingVertical: 15,
        alignItems: 'center',
    },
    saveButtonDisabled: { opacity: 0.6 },
    saveButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
});
