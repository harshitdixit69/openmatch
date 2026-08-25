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
import { fetchCurrentProfile, upsertCurrentProfile } from '../lib/profileApi';
import { showFriendlyAlert } from '../lib/errorUtils';
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
                preferences: profile.preferences || '',
                height_cm: height.trim() ? parseInt(height.trim(), 10) : 170,
                partner_gender_preference: profile.partner_gender_preference || 'Everyone',
                photo_urls: profile.photo_urls || [],
                profile_owner: profile.profile_owner || 'self',
            });
            Alert.alert('Profile Saved', 'Your profile details have been updated successfully.');
            onBack();
        } catch (e: any) {
            showFriendlyAlert('Save Failed', e, 'Could not update your profile details. Please try again.');
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
                    <Text style={styles.headerTitle}>Edit Profile</Text>
                    <Text style={styles.headerSub}>Update your personal & career details</Text>
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
                    {/* Basic Info */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Basic Information</Text>

                        <Text style={styles.label}>Full Name</Text>
                        <TextInput
                            style={styles.input}
                            value={fullName}
                            onChangeText={setFullName}
                            placeholder="Full Name"
                            placeholderTextColor="#5a5770"
                        />

                        <Text style={styles.label}>Bio / About Me</Text>
                        <TextInput
                            style={[styles.input, styles.multiline]}
                            value={bio}
                            onChangeText={setBio}
                            multiline
                            placeholder="Describe your background and lifestyle..."
                            placeholderTextColor="#5a5770"
                        />

                        <Text style={styles.label}>Location (City, Country)</Text>
                        <TextInput
                            style={styles.input}
                            value={location}
                            onChangeText={setLocation}
                            placeholder="City, Country"
                            placeholderTextColor="#5a5770"
                        />
                    </View>

                    {/* Career & Education */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Career & Education</Text>

                        <Text style={styles.label}>Occupation / Role</Text>
                        <TextInput
                            style={styles.input}
                            value={occupation}
                            onChangeText={setOccupation}
                            placeholder="e.g. Software Engineer"
                            placeholderTextColor="#5a5770"
                        />

                        <Text style={styles.label}>Highest Education</Text>
                        <TextInput
                            style={styles.input}
                            value={education}
                            onChangeText={setEducation}
                            placeholder="e.g. Master's in CS"
                            placeholderTextColor="#5a5770"
                        />
                    </View>

                    {/* Personal Attributes */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Personal Attributes</Text>

                        <Text style={styles.label}>Height (cm)</Text>
                        <TextInput
                            style={styles.input}
                            value={height}
                            onChangeText={setHeight}
                            keyboardType="numeric"
                            placeholder="175"
                            placeholderTextColor="#5a5770"
                        />

                        <Text style={styles.label}>Religion / Background</Text>
                        <TextInput
                            style={styles.input}
                            value={religion}
                            onChangeText={setReligion}
                            placeholder="e.g. Hindu / Jain"
                            placeholderTextColor="#5a5770"
                        />

                        <Text style={styles.label}>Dietary Preference</Text>
                        <TextInput
                            style={styles.input}
                            value={diet}
                            onChangeText={setDiet}
                            placeholder="e.g. Vegetarian / Eggetarian"
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
    multiline: { minHeight: 80, textAlignVertical: 'top' },
});
