import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchPartnerPreferences, upsertPartnerPreferences } from '../lib/partnerPreferencesApi';
import { showFriendlyAlert } from '../lib/errorUtils';

export default function PremiumPartnerPreferencesScreen({ onBack }: { onBack: () => void }) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Form fields
    const [minAge, setMinAge] = useState('');
    const [maxAge, setMaxAge] = useState('');
    const [minHeight, setMinHeight] = useState('');
    const [maxHeight, setMaxHeight] = useState('');
    const [religion, setReligion] = useState('');
    const [education, setEducation] = useState('');
    const [diet, setDiet] = useState('');

    useEffect(() => {
        let mounted = true;
        async function load() {
            try {
                const prefs = await fetchPartnerPreferences();
                if (mounted && prefs) {
                    setMinAge(prefs.pref_age_min ? String(prefs.pref_age_min) : '21');
                    setMaxAge(prefs.pref_age_max ? String(prefs.pref_age_max) : '35');
                    setMinHeight(prefs.pref_height_min ? String(prefs.pref_height_min) : '155');
                    setMaxHeight(prefs.pref_height_max ? String(prefs.pref_height_max) : '190');
                    setReligion(prefs.pref_religion || '');
                    setEducation(prefs.pref_education || '');
                    setDiet(prefs.pref_diet || '');
                }
            } catch (e) {
                console.error('Failed to load partner preferences:', e);
            } finally {
                if (mounted) setLoading(false);
            }
        }
        void load();
        return () => { mounted = false; };
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await upsertPartnerPreferences({
                pref_age_min: minAge.trim() ? parseInt(minAge.trim(), 10) : null,
                pref_age_max: maxAge.trim() ? parseInt(maxAge.trim(), 10) : null,
                pref_height_min: minHeight.trim() ? parseInt(minHeight.trim(), 10) : null,
                pref_height_max: maxHeight.trim() ? parseInt(maxHeight.trim(), 10) : null,
                pref_religion: (religion.trim() || null) as any,
                pref_education: (education.trim() || null) as any,
                pref_diet: (diet.trim() || null) as any,
                pref_marital_status: [],
                pref_income_band: null,
                pref_mother_tongue: null,
                pref_location_flexibility: null,
            });
            Alert.alert('Preferences Saved', 'Your partner match criteria have been updated.');
            onBack();
        } catch (e: any) {
            showFriendlyAlert('Save Failed', e, 'Could not save partner preferences. Please check your inputs and try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={onBack}>
                    <Text style={styles.backArrow}>‹</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>Partner Preferences</Text>
                    <Text style={styles.headerSub}>Refine your ideal match criteria</Text>
                </View>
                <Pressable
                    style={[styles.saveBtn, saving && styles.btnDisabled]}
                    onPress={handleSave}
                    disabled={saving}
                >
                    {saving ? (
                        <ActivityIndicator size="small" color="#0a0a0c" />
                    ) : (
                        <Text style={styles.saveBtnText}>Save</Text>
                    )}
                </Pressable>
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator color="#d4a853" size="large" />
                </View>
            ) : (
                <ScrollView
                    style={{ flex: 1, backgroundColor: '#0a0a0c' }}
                    contentContainerStyle={styles.formContent}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Age Range */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Age Range</Text>
                        <View style={styles.rowInputs}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.label}>Min Age</Text>
                                <TextInput
                                    style={styles.input}
                                    value={minAge}
                                    onChangeText={setMinAge}
                                    keyboardType="numeric"
                                    placeholder="21"
                                    placeholderTextColor="#5a5770"
                                />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.label}>Max Age</Text>
                                <TextInput
                                    style={styles.input}
                                    value={maxAge}
                                    onChangeText={setMaxAge}
                                    keyboardType="numeric"
                                    placeholder="35"
                                    placeholderTextColor="#5a5770"
                                />
                            </View>
                        </View>
                    </View>

                    {/* Height Range */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Height Range (cm)</Text>
                        <View style={styles.rowInputs}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.label}>Min Height</Text>
                                <TextInput
                                    style={styles.input}
                                    value={minHeight}
                                    onChangeText={setMinHeight}
                                    keyboardType="numeric"
                                    placeholder="155"
                                    placeholderTextColor="#5a5770"
                                />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.label}>Max Height</Text>
                                <TextInput
                                    style={styles.input}
                                    value={maxHeight}
                                    onChangeText={setMaxHeight}
                                    keyboardType="numeric"
                                    placeholder="190"
                                    placeholderTextColor="#5a5770"
                                />
                            </View>
                        </View>
                    </View>

                    {/* Background & Diet */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Background & Lifestyle</Text>

                        <Text style={styles.label}>Preferred Religion</Text>
                        <TextInput
                            style={styles.input}
                            value={religion}
                            onChangeText={setReligion}
                            placeholder="Hindu, Jain, Sikh..."
                            placeholderTextColor="#5a5770"
                        />

                        <Text style={styles.label}>Education Requirement</Text>
                        <TextInput
                            style={styles.input}
                            value={education}
                            onChangeText={setEducation}
                            placeholder="Bachelor's, Master's..."
                            placeholderTextColor="#5a5770"
                        />

                        <Text style={styles.label}>Diet Preference</Text>
                        <TextInput
                            style={styles.input}
                            value={diet}
                            onChangeText={setDiet}
                            placeholder="Vegetarian, Eggetarian..."
                            placeholderTextColor="#5a5770"
                        />
                    </View>
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0a0a0c' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: '#111015',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.08)',
        gap: 12,
    },
    backBtn: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#141318',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    backArrow: { fontSize: 26, color: '#d4a853', lineHeight: 28 },
    headerTitle: { fontSize: 18, fontWeight: '800', color: '#d4a853' },
    headerSub: { fontSize: 12, color: '#8e8a9e', marginTop: 1 },
    saveBtn: { backgroundColor: '#d4a853', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
    saveBtnText: { fontSize: 13, fontWeight: '800', color: '#0a0a0c' },
    btnDisabled: { opacity: 0.6 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0c' },
    formContent: { padding: 16, gap: 16 },
    section: {
        backgroundColor: '#141318',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        gap: 10,
    },
    sectionTitle: { fontSize: 13, fontWeight: '800', color: '#d4a853', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
    label: { fontSize: 12, fontWeight: '700', color: '#8e8a9e', marginTop: 4 },
    input: {
        backgroundColor: '#1e1d26',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        paddingHorizontal: 14,
        paddingVertical: 11,
        fontSize: 14,
        color: '#f0ece4',
    },
    rowInputs: { flexDirection: 'row', gap: 12 },
});
