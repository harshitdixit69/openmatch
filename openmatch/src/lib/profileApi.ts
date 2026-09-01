import { supabase } from './supabase';
import { compressImageToArrayBuffer } from './profilePhotoApi';
import { ProfileContactDetails, ProfileContactInput, ProfileInput, ProfileRecord } from './profile';

const baseProfileSelect = 'id, full_name, gender, dob, location, bio, preferences, height_cm, profile_owner, onboarding_completed_at';
const profileSelect = `${baseProfileSelect}, partner_gender_preference, photo_urls, religion, marital_status, education, diet, mother_tongue, income_band, occupation, company, complexion, family_type, family_status, num_siblings, drinks_alcohol, smokes, busy_mode, busy_mode_changed_at, subscription_tier, subscription_expires_at, manual_unlock_credits, ai_call_credits, unlock_credits_remaining, super_interest_remaining, spotlights_remaining, spotlight_active_until, verification_status`;
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

async function fetchProfileByUserId(userId: string, isCurrentUser = false) {
    if (!isCurrentUser) {
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
        return fetchProfileByUserId(userId, true);
    }

    const user = await getCurrentSessionUser();

    if (!user) {
        return null;
    }

    return fetchProfileByUserId(user.id, true);
}

/**
 * Whether a profile should be treated as having finished onboarding.
 *
 * Historically we relied solely on `onboarding_completed_at`, but older
 * accounts (created before that column was populated, or via paths that never
 * stamped it) have a fully filled profile with a NULL timestamp. Those users
 * were being pushed back through onboarding on every login. We now also treat a
 * profile whose essential fields are present as onboarded.
 */
export function isProfileOnboarded(profile: ProfileRecord | null | undefined): boolean {
    if (!profile) {
        return false;
    }
    if (profile.onboarding_completed_at) {
        return true;
    }
    const hasName = Boolean(profile.full_name && profile.full_name.trim());
    const hasGender = Boolean(profile.gender);
    const hasDob = Boolean(profile.dob);
    return hasName && hasGender && hasDob;
}

export async function fetchCurrentProfileContactDetails(userId?: string): Promise<ProfileContactDetails | null> {
    // A candidate id is already known by the caller, so avoid an extra auth
    // request. The RPC validates auth.uid() server-side.
    const targetUserId = userId ?? (await getCurrentSessionUser())?.id;

    if (!targetUserId) {
        return null;
    }

    // Access checks and the contact lookup run inside one database function.
    // This avoids a session -> block -> match -> contact request waterfall.
    const { data, error } = await supabase.rpc('get_contact_details_if_unlocked', {
        target_profile_id: targetUserId,
    });

    if (error) {
        throw error;
    }

    const row = Array.isArray(data) ? data[0] ?? null : data;
    return mapProfileContactDetails(row as ({ profile_id: string } & ProfileContactDetails) | null);
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

function triggerProfileEmbeddingGeneration(userId: string, input: ProfileInput): void {
    if (!supabase.functions?.invoke) return;
    // H5 FIX: The edge function will validate the caller's auth token server-side.
    // We pass userId here but the edge function MUST verify auth.uid() === record.id.
    supabase.functions.invoke('generate-profile-embedding', {
        body: {
            type: 'INSERT',
            record: {
                id: userId,
                bio: input.bio,
                preferences: input.preferences,
                location: input.location,
                profile_owner: input.profile_owner,
            },
        },
    }).catch((err) => {
        console.warn('Failed to auto-generate profile embedding via Edge Function:', err);
    });
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
        if (input.location) {
            await saveProfileCoordinates(user.id, input.location);
        }
        triggerProfileEmbeddingGeneration(user.id, input);
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

    if (input.location) {
        await saveProfileCoordinates(user.id, input.location);
    }

    triggerProfileEmbeddingGeneration(user.id, input);

    return withFallbackOptionalProfileFields(
        fallback.data as Omit<ProfileRecord, 'partner_gender_preference' | 'photo_urls'>,
    ) as ProfileRecord;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

function mimeTypeForUri(uri: string): string {
    const lower = uri.toLowerCase();
    if (lower.includes('.pdf') || lower.startsWith('data:application/pdf')) return 'application/pdf';
    if (lower.includes('.png') || lower.startsWith('data:image/png')) return 'image/png';
    if (lower.includes('.heic') || lower.startsWith('data:image/heic')) return 'image/heic';
    if (lower.includes('.webp') || lower.startsWith('data:image/webp')) return 'image/webp';
    return 'image/jpeg';
}

/**
 * supabase-js collapses any non-2xx Edge Function response into the useless message
 * "Edge Function returned a non-2xx status code", discarding the JSON body that says
 * what actually went wrong. The body is still readable off `error.context` (a Response),
 * so pull the real message out of it for display.
 */
async function readFunctionErrorMessage(fnError: any): Promise<string | null> {
    const response = fnError?.context;
    if (response && typeof response.json === 'function') {
        try {
            const body = await response.json();
            if (body?.error) return String(body.error);
        } catch {
            // Body was not JSON, or was already consumed — fall through.
        }
    }
    return fnError?.message ?? null;
}

export async function submitVerification(idPhotoUri: string, selfiePhotoUri: string): Promise<{
    // 'approved'/'rejected' are final; 'pending' means queued for manual review;
    // 'error' means a transient failure (retry) and must NOT be treated as a rejection.
    status: 'approved' | 'rejected' | 'pending' | 'error';
    similarityScore: number;
    extractedName?: string;
    extractedDob?: string;
    reason?: string;
}> {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error('Unauthorized');

    // Registered identity to cross-check the ID against (name/DOB match).
    const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, dob')
        .eq('id', user.id)
        .maybeSingle();

    // Convert both images to base64 in memory. We deliberately do NOT upload here:
    // the Edge Function stores the raw KYC docs in a PRIVATE bucket using the service
    // role, and is the ONLY path allowed to write the verification badge. This closes
    // two holes: (1) client-forged 'verified' status, (2) govt IDs in a public bucket.
    //
    // Both images are downscaled/re-encoded first. A raw camera capture or a browser
    // file pick is often several MB, and base64 inflates it by a further ~33% — which
    // blew past both the Edge Function body limit and the storage bucket size limit
    // ("The object exceeded the maximum allowed size"). PDFs are passed through
    // untouched since the canvas path only understands raster images.
    const idMimeType = mimeTypeForUri(idPhotoUri);
    const selfieMimeType = mimeTypeForUri(selfiePhotoUri);

    const rawId = await (await fetch(idPhotoUri)).arrayBuffer();
    const rawSelfie = await (await fetch(selfiePhotoUri)).arrayBuffer();

    const idBuffer = idMimeType === 'application/pdf'
        ? rawId
        : await compressImageToArrayBuffer(idPhotoUri, rawId);
    const selfieBuffer = await compressImageToArrayBuffer(selfiePhotoUri, rawSelfie);

    const idBase64 = arrayBufferToBase64(idBuffer);
    const selfieBase64 = arrayBufferToBase64(selfieBuffer);

    // Server-side AI verification. The Edge Function performs the decision, persists the
    // documents, logs the attempt, and writes verification_status with the service role.
    const { data: fnData, error: fnError } = await supabase.functions.invoke('verify-identity-ai', {
        body: {
            idBase64,
            idMimeType: idMimeType === 'application/pdf' ? idMimeType : 'image/jpeg',
            selfieBase64,
            selfieMimeType: 'image/jpeg',
            fullName: profile?.full_name ?? null,
            dob: profile?.dob ?? null,
        },
    });

    if (fnError || !fnData) {
        const rawReason = await readFunctionErrorMessage(fnError);
        // Log the unmodified server message. The alert the user sees is passed through
        // getFriendlyErrorMessage(), which collapses anything mentioning "gemini" into a
        // generic "temporarily busy" line — useful for users, useless for debugging.
        console.warn('[AI Verification] Edge Function call failed:', rawReason, fnError);
        return {
            status: 'error',
            similarityScore: 0,
            reason: rawReason
                || 'AI verification service is temporarily unavailable. Please try again.',
        };
    }

    const status = (fnData.status as 'approved' | 'rejected' | 'pending' | 'error') ?? 'error';
    return {
        status,
        similarityScore: fnData.confidenceScore ?? 0,
        extractedName: fnData.extractedName,
        extractedDob: fnData.extractedDob,
        reason: fnData.reason,
    };
}

export function resolveCityToCoordinates(city: string): { latitude: number; longitude: number } {
    const normalized = city.trim().toLowerCase();
    
    // Exact mapping for major cities
    if (normalized.includes('lucknow')) {
        return { latitude: 26.8467, longitude: 80.9462 };
    }
    if (normalized.includes('delhi') || normalized.includes('new delhi')) {
        return { latitude: 28.6139, longitude: 77.2090 };
    }
    if (normalized.includes('mumbai') || normalized.includes('bombay')) {
        return { latitude: 19.0760, longitude: 72.8777 };
    }
    if (normalized.includes('bangalore') || normalized.includes('bengaluru')) {
        return { latitude: 12.9716, longitude: 77.5946 };
    }
    if (normalized.includes('kanpur')) {
        return { latitude: 26.4499, longitude: 80.3319 };
    }
    if (normalized.includes('varanasi') || normalized.includes('banaras')) {
        return { latitude: 25.3176, longitude: 82.9739 };
    }
    if (normalized.includes('patna')) {
        return { latitude: 25.5941, longitude: 85.1376 };
    }
    if (normalized.includes('kolkata') || normalized.includes('calcutta')) {
        return { latitude: 22.5726, longitude: 88.3639 };
    }
    if (normalized.includes('chennai') || normalized.includes('madras')) {
        return { latitude: 13.0827, longitude: 80.2707 };
    }
    if (normalized.includes('hyderabad')) {
        return { latitude: 17.3850, longitude: 78.4867 };
    }
    if (normalized.includes('pune')) {
        return { latitude: 18.5204, longitude: 73.8567 };
    }

    // Default fallback (slightly randomized near Lucknow so distance calculations function naturally in tests)
    const hash = normalized.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const randomOffsetLat = ((hash % 100) - 50) / 1000; // -0.05 to +0.05 degrees
    const randomOffsetLon = (((hash * 17) % 100) - 50) / 1000;
    return {
        latitude: 26.8467 + randomOffsetLat,
        longitude: 80.9462 + randomOffsetLon,
    };
}

export async function saveProfileCoordinates(userId: string, city: string): Promise<void> {
    try {
        const { latitude, longitude } = resolveCityToCoordinates(city);
        const geog = `POINT(${longitude} ${latitude})`;
        const { error } = await supabase
            .from('profile_locations')
            .upsert({
                profile_id: userId,
                latitude,
                longitude,
                geog,
                updated_at: new Date().toISOString()
            });
        if (error) throw error;
    } catch (err) {
        console.warn('Failed to save profile coordinates for city:', city, err);
    }
}

export async function activateSpotlight(): Promise<{ success: boolean; spotlight_active_until: string; spotlights_remaining: number }> {
    const { data, error } = await supabase.rpc('activate_spotlight');
    if (error) {
        throw error;
    }
    return data as { success: boolean; spotlight_active_until: string; spotlights_remaining: number };
}

// ─── Block & Report User API ────────────────────────────────────────────────
//
// The block/report implementations that used to live here targeted a
// `blocked_users` table that has no migration and never existed, and inserted a
// `description` column on user_reports that is actually named `details`. Every
// call through them failed. They also had zero consumers — ChatScreen and
// MatchProfileScreen both import the working versions from `./chatApi`.
//
// They have been removed so there is a single block path:
//   blockUser / unblockUser / reportUser  ->  src/lib/chatApi.ts (public.user_blocks, public.user_reports)
//   fetchBlockedProfiles                  ->  src/lib/discoverySafetyApi.ts

export type ReportReason = 'fake_profile' | 'harassment' | 'spam' | 'inappropriate_content' | 'underage' | 'other';

export async function isUserBlocked(otherUserId: string): Promise<boolean> {
    const user = await getCurrentSessionUser();
    if (!user) return false;

    const { data } = await supabase
        .from('user_blocks')
        .select('id')
        .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${otherUserId}),and(blocker_id.eq.${otherUserId},blocked_id.eq.${user.id})`)
        .maybeSingle();

    return Boolean(data);
}
