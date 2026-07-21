import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { fetchCurrentProfile, upsertCurrentProfile } from '../lib/profileApi';
import { ProfileRecord } from '../lib/profile';

export default function PremiumProfileEditScreen({ onBack }: { onBack: () => void }) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState<ProfileRecord | null>(null);

    // Form fields
    const [fullName, setFullName] = useState('');
    const [bio, setBio] = useState('');
    const [location, setLocation] = useState('');
    const [occupation, setOccupation] = useState('');
    const [education, setEducation] = useState('');
    const [height, setHeight] = useState('');
    const [religion, setReligion] = useState('');
    const [diet, setDiet] = useState('');

    useEffect(() => {
        let mounted = true;
        async function load() {
            try {
                const data = await fetchCurrentProfile();
                if (mounted && data) {
                    setProfile(data);
                    setFullName(data.full_name || '');
                    setBio(data.bio || '');
                    setLocation(data.location || '');
                    setOccupation(data.occupation || '');
                    setEducation(data.education || '');
                    setHeight(data.height_cm ? String(data.height_cm) : '');
                    setReligion(data.religion || '');
                    setDiet(data.diet || '');
                }
            } catch (e) {
                console.error('Failed to load profile for edit:', e);
            } finally {
                if (mounted) setLoading(false);
            }
        }
        void load();
        return () => { mounted = false; };
    }, []);

    const handleSave = async () => {
        if (!profile) return;
        setSaving(true);
        try {
            await upsertCurrentProfile({
                full_name: fullName.trim(),
                gender: profile.gender || 'male',
                dob: profile.dob || '1995-01-01',
                location: location.trim(),
                bio: bio.trim(),
                preferences: profile.preferences || null,
                height_cm: height.trim() ? parseInt(height.trim(), 10) : null,
                partner_gender_preference: profile.partner_gender_preference || null,
                photo_urls: profile.photo_urls || [],
            });
            Alert.alert('Profile Saved', 'Your profile details have been updated successfully.');
            onBack();
        } catch (e: any) {
            Alert.alert('Save Failed', e.message || 'Could not update profile.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={onBack}>
                    <Text style={styles.backArrow}>‹</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>Edit Profile</Text>
                    <Text style={styles.headerSub}>Update your personal & career details</Text>
                </View>
                <Pressable
                    style={[styles.saveBtn, saving && styles.btnDisabled]}
                    onPress={handleSave}
                    disabled={saving}
                >
                    {saving ? (
                        <ActivityIndicator size="small" color="#0d0c0f" />
                    ) : (
                        <Text style={styles.saveBtnText}>Save</Text>
                    )}
                </Pressable>
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator color="#d4b373" size="large" />
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.formContent} showsVerticalScrollIndicator={false}>
                    {/* Basic Info */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Basic Information</Text>

                        <Text style={styles.label}>Full Name</Text>
                        <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder="Full Name" placeholderTextColor="#5a5570" />

                        <Text style={styles.label}>Bio / About Me</Text>
                        <TextInput style={[styles.input, styles.multiline]} value={bio} onChangeText={setBio} multiline placeholder="Describe your background and lifestyle..." placeholderTextColor="#5a5570" />

                        <Text style={styles.label}>Location (City, Country)</Text>
                        <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="City, Country" placeholderTextColor="#5a5570" />
                    </View>

                    {/* Career & Education */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Career & Education</Text>

                        <Text style={styles.label}>Occupation / Role</Text>
                        <TextInput style={styles.input} value={occupation} onChangeText={setOccupation} placeholder="e.g. Software Engineer" placeholderTextColor="#5a5570" />

                        <Text style={styles.label}>Highest Education</Text>
                        <TextInput style={styles.input} value={education} onChangeText={setEducation} placeholder="e.g. Master's in CS" placeholderTextColor="#5a5570" />
                    </View>

                    {/* Personal Attributes */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Personal Attributes</Text>

                        <Text style={styles.label}>Height (cm)</Text>
                        <TextInput style={styles.input} value={height} onChangeText={setHeight} keyboardType="numeric" placeholder="175" placeholderTextColor="#5a5570" />

                        <Text style={styles.label}>Religion / Background</Text>
                        <TextInput style={styles.input} value={religion} onChangeText={setReligion} placeholder="e.g. Hindu / Jain" placeholderTextColor="#5a5570" />

                        <Text style={styles.label}>Dietary Preference</Text>
                        <TextInput style={styles.input} value={diet} onChangeText={setDiet} placeholder="e.g. Vegetarian / Eggetarian" placeholderTextColor="#5a5570" />
                    </View>
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const GOLD = '#d4b373';
const DARK_BG = '#0d0c0f';
const CARD_BG = '#1a1828';
const BORDER = '#2a2640';
const TEXT_PRIMARY = '#f0ece8';
const TEXT_SUB = '#8e8aa0';
const TEXT_MUTED = '#6c6880';

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: DARK_BG },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 12 },
    backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_BG, borderRadius: 18, borderWidth: 1, borderColor: BORDER },
    backArrow: { fontSize: 26, color: GOLD, lineHeight: 28 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY },
    headerSub: { fontSize: 12, color: TEXT_MUTED, marginTop: 1 },
    saveBtn: { backgroundColor: GOLD, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8 },
    saveBtnText: { fontSize: 13, fontWeight: '800', color: DARK_BG },
    btnDisabled: { opacity: 0.6 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    formContent: { padding: 16, gap: 16 },
    section: { backgroundColor: CARD_BG, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: BORDER, gap: 10 },
    sectionTitle: { fontSize: 15, fontWeight: '800', color: GOLD, marginBottom: 4 },
    label: { fontSize: 12, fontWeight: '600', color: TEXT_SUB, marginTop: 4 },
    input: { backgroundColor: '#14121e', borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: TEXT_PRIMARY },
    multiline: { minHeight: 80, textAlignVertical: 'top' },
});
