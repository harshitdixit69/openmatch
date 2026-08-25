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
import { showFriendlyAlert } from '../lib/errorUtils';
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
            showFriendlyAlert('Save Failed', e, 'Could not save partner preferences. Please check your selections and try again.');
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
                <ActivityIndicator size="large" color="#d4a853" />
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
                style={[styles.flex, { backgroundColor: '#0a0a0c' }]}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={insets.top + 56}
            >
                <ScrollView
                    style={{ flex: 1, backgroundColor: '#0a0a0c' }}
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
                                placeholderTextColor="#5a5770"
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
                        <ActivityIndicator color="#0a0a0c" size="small" />
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
    safeArea: { flex: 1, backgroundColor: '#0a0a0c' },
    loadingContainer: {
        flex: 1,
        backgroundColor: '#0a0a0c',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
    },
    loadingText: { fontSize: 14, color: '#8e8a9e' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#111015',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    headerTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 17,
        fontWeight: '800',
        color: '#d4a853',
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
        color: '#8e8a9e',
        marginBottom: 10,
    },
    textInput: {
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 11,
        fontSize: 15,
        color: '#f0ece4',
        backgroundColor: '#1e1d26',
        marginBottom: 6,
    },
    saveBar: {
        paddingTop: 12,
        paddingHorizontal: 20,
        backgroundColor: '#111015',
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.08)',
    },
    saveButton: {
        backgroundColor: '#d4a853',
        borderRadius: 12,
        paddingVertical: 15,
        alignItems: 'center',
    },
    saveButtonDisabled: { opacity: 0.6 },
    saveButtonText: {
        color: '#0a0a0c',
        fontSize: 16,
        fontWeight: '800',
    },
});
