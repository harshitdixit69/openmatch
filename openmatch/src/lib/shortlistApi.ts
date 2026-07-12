// src/lib/shortlistApi.ts
import { supabase } from './supabase';
import type { MatchCandidate } from './matchmaking';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShortlistedProfile = {
    shortlist_id: string;
    saved_profile_id: string;
    created_at: string;
    // Joined profile fields
    full_name: string;
    gender: string;
    dob: string;
    location: string;
    bio: string | null;
    preferences: string | null;
    photo_urls: string[];
    height_cm: number | null;
    profile_owner: string | null;
    partner_gender_preference: string | null;
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function fetchShortlist(): Promise<ShortlistedProfile[]> {
    const { data, error } = await supabase
        .from('profile_shortlists')
        .select(
            `id,
             saved_profile_id,
             created_at,
             saved_profile:profiles (
               full_name, gender, dob, location, bio, preferences,
               photo_urls, height_cm, profile_owner, partner_gender_preference
             )`,
        )
        .order('created_at', { ascending: false });

    if (error) throw error;

    return ((data ?? []) as any[]).map((row) => ({
        shortlist_id: row.id,
        saved_profile_id: row.saved_profile_id,
        created_at: row.created_at,
        ...row.saved_profile,
    })) as ShortlistedProfile[];
}

/** Returns the Set of saved profile IDs — cheap call to hydrate bookmark icons. */
export async function fetchShortlistedIds(): Promise<Set<string>> {
    const { data, error } = await supabase.rpc('get_shortlisted_profile_ids');
    if (error) throw error;
    return new Set<string>((data ?? []) as string[]);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function saveToShortlist(profileId: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
        .from('profile_shortlists')
        .insert({ viewer_id: user.id, saved_profile_id: profileId });

    // Ignore duplicate — idempotent save
    if (error && !error.message.includes('unique')) throw error;
}

export async function removeFromShortlist(profileId: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
        .from('profile_shortlists')
        .delete()
        .eq('viewer_id', user.id)
        .eq('saved_profile_id', profileId);

    if (error) throw error;
}

export async function toggleShortlist(profileId: string, currentlySaved: boolean): Promise<boolean> {
    if (currentlySaved) {
        await removeFromShortlist(profileId);
        return false;
    } else {
        await saveToShortlist(profileId);
        return true;
    }
}

// ---------------------------------------------------------------------------
// Helper: convert ShortlistedProfile → MatchCandidate for reuse in UI
// ---------------------------------------------------------------------------

export function shortlistToCandidate(s: ShortlistedProfile): MatchCandidate {
    return {
        id: s.saved_profile_id,
        full_name: s.full_name,
        gender: s.gender,
        dob: s.dob,
        location: s.location,
        bio: s.bio,
        preferences: s.preferences,
        photo_urls: s.photo_urls ?? [],
        height_cm: s.height_cm,
        profile_owner: s.profile_owner as any,
        partner_gender_preference: s.partner_gender_preference,
        similarity: 0,
    };
}
