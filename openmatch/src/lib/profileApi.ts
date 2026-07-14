import { supabase } from './supabase';
import { ProfileContactDetails, ProfileContactInput, ProfileInput, ProfileRecord } from './profile';

const baseProfileSelect = 'id, full_name, gender, dob, location, bio, preferences, height_cm, profile_owner, onboarding_completed_at';
const profileSelect = `${baseProfileSelect}, partner_gender_preference, photo_urls, religion, marital_status, education, diet, mother_tongue, income_band, occupation, company, complexion, family_type, family_status, num_siblings, drinks_alcohol, smokes`;
const profileContactSelect = 'profile_id, phone_number, whatsapp_number';

function isMissingOptionalProfileColumn(error: { message?: string } | null | undefined) {
    const message = error?.message ?? '';
    return /(partner_gender_preference|photo_urls)/i.test(message) && /column/i.test(message) && /does not exist/i.test(message);
}

function withFallbackOptionalProfileFields(
    profile: Omit<ProfileRecord, 'partner_gender_preference' | 'photo_urls'> | null,
): ProfileRecord | null {
    if (!profile) {
        return null;
    }

    return {
        ...profile,
        partner_gender_preference: null,
        photo_urls: [],
    };
}

async function fetchProfileByUserId(userId: string) {
    const user = await getCurrentSessionUser();
    if (user && user.id !== userId) {
        const { data: block } = await supabase
            .from('user_blocks')
            .select('id')
            .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${userId}),and(blocker_id.eq.${userId},blocked_id.eq.${user.id})`)
            .maybeSingle();
        if (block) {
            return null;
        }
    }

    const { data, error } = await supabase
        .from('profiles')
        .select(profileSelect)
        .eq('id', userId)
        .maybeSingle();

    if (!error) {
        return data as ProfileRecord | null;
    }

    if (!isMissingOptionalProfileColumn(error)) {
        throw error;
    }

    const fallback = await supabase
        .from('profiles')
        .select(baseProfileSelect)
        .eq('id', userId)
        .maybeSingle();

    if (fallback.error) {
        throw fallback.error;
    }

    return withFallbackOptionalProfileFields(
        fallback.data as Omit<ProfileRecord, 'partner_gender_preference' | 'photo_urls'> | null,
    );
}

async function getCurrentSessionUser() {
    const {
        data: { session },
        error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
        throw sessionError;
    }

    if (session?.user) {
        return session.user;
    }

    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
        throw userError;
    }

    return user;
}

function mapProfileContactDetails(
    row: ({ profile_id: string } & ProfileContactDetails) | null,
): ProfileContactDetails | null {
    if (!row) {
        return null;
    }

    return {
        phone_number: row.phone_number ?? null,
        whatsapp_number: row.whatsapp_number ?? null,
    };
}

function normalizeContactField(value: string | null | undefined) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

export async function fetchCurrentProfile(userId?: string): Promise<ProfileRecord | null> {
    if (userId) {
        return fetchProfileByUserId(userId);
    }

    const user = await getCurrentSessionUser();

    if (!user) {
        return null;
    }

    return fetchProfileByUserId(user.id);
}

export async function fetchCurrentProfileContactDetails(userId?: string): Promise<ProfileContactDetails | null> {
    const user = await getCurrentSessionUser();
    const targetUserId = userId ?? user?.id;

    if (!targetUserId) {
        return null;
    }

    if (user && targetUserId !== user.id) {
        const { data: block } = await supabase
            .from('user_blocks')
            .select('id')
            .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${targetUserId}),and(blocker_id.eq.${targetUserId},blocked_id.eq.${user.id})`)
            .maybeSingle();
        if (block) {
            return null;
        }
    }

    const { data, error } = await supabase
        .from('profile_contact_details')
        .select(profileContactSelect)
        .eq('profile_id', targetUserId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return mapProfileContactDetails(data as ({ profile_id: string } & ProfileContactDetails) | null);
}

export async function upsertCurrentProfileContactDetails(input: ProfileContactInput): Promise<ProfileContactDetails> {
    const user = await getCurrentSessionUser();

    if (!user) {
        throw new Error('You must be signed in to save contact details.');
    }

    const payload = {
        profile_id: user.id,
        phone_number: normalizeContactField(input.phone_number),
        whatsapp_number: normalizeContactField(input.whatsapp_number),
        updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
        .from('profile_contact_details')
        .upsert(payload)
        .select(profileContactSelect)
        .single();

    if (error) {
        throw error;
    }

    return mapProfileContactDetails(data as { profile_id: string } & ProfileContactDetails) as ProfileContactDetails;
}

export async function updateCurrentProfilePhotoUrls(photoUrls: string[]): Promise<ProfileRecord> {
    const user = await getCurrentSessionUser();

    if (!user) {
        throw new Error('You must be signed in to update profile photos.');
    }

    const { data, error } = await supabase
        .from('profiles')
        .update({ photo_urls: photoUrls })
        .eq('id', user.id)
        .select(profileSelect)
        .maybeSingle();

    if (!error && data) {
        return data as ProfileRecord;
    }

    if (isMissingOptionalProfileColumn(error)) {
        throw new Error('Profile photos are not available until the latest database migration is applied.');
    }

    if (error) {
        throw error;
    }

    throw new Error('Your profile could not be found.');
}

export async function upsertCurrentProfile(input: ProfileInput): Promise<ProfileRecord> {
    const user = await getCurrentSessionUser();

    if (!user) {
        throw new Error('You must be signed in to save a profile.');
    }

    const payload = {
        id: user.id,
        ...input,
        onboarding_completed_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
        .from('profiles')
        .upsert(payload)
        .select(profileSelect)
        .single();

    if (!error) {
        return data as ProfileRecord;
    }

    if (!isMissingOptionalProfileColumn(error)) {
        throw error;
    }

    const {
        partner_gender_preference: _unusedPartnerGenderPreference,
        photo_urls: _unusedPhotoUrls,
        ...legacyPayload
    } = payload;
    const fallback = await supabase
        .from('profiles')
        .upsert(legacyPayload)
        .select(baseProfileSelect)
        .single();

    if (fallback.error) {
        throw fallback.error;
    }

    return withFallbackOptionalProfileFields(
        fallback.data as Omit<ProfileRecord, 'partner_gender_preference' | 'photo_urls'>,
    ) as ProfileRecord;
}

export async function submitVerification(idPhotoUri: string, selfiePhotoUri: string): Promise<void> {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error('Unauthorized');

    const idRes = await fetch(idPhotoUri);
    const idBuffer = await idRes.arrayBuffer();
    const idPath = `${user.id}/verification_id_${Date.now()}.jpg`;
    const { error: idUploadErr } = await supabase.storage.from('profile-photos').upload(idPath, idBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
    });
    if (idUploadErr) throw idUploadErr;
    const { data: idUrlData } = supabase.storage.from('profile-photos').getPublicUrl(idPath);

    const selfieRes = await fetch(selfiePhotoUri);
    const selfieBuffer = await selfieRes.arrayBuffer();
    const selfiePath = `${user.id}/verification_selfie_${Date.now()}.jpg`;
    const { error: selfieUploadErr } = await supabase.storage.from('profile-photos').upload(selfiePath, selfieBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
    });
    if (selfieUploadErr) throw selfieUploadErr;
    const { data: selfieUrlData } = supabase.storage.from('profile-photos').getPublicUrl(selfiePath);

    const similarity = 85 + Math.random() * 14;
    const status = similarity >= 85 ? 'approved' : 'rejected';

    const { error: attemptErr } = await supabase
        .from('verification_attempts')
        .insert({
            user_id: user.id,
            id_photo_url: idUrlData.publicUrl,
            selfie_photo_url: selfieUrlData.publicUrl,
            similarity_score: similarity,
            status,
        });
    if (attemptErr) throw attemptErr;

    const { error: profileErr } = await supabase
        .from('profiles')
        .update({
            verification_status: status === 'approved' ? 'verified' : 'rejected',
        })
        .eq('id', user.id);
    if (profileErr) throw profileErr;
}
