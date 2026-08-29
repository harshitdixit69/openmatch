import { supabase } from './supabase';

/**
 * A sanitized, privacy-safe profile shown to logged-out guest users.
 * Backed by the `guest_feed` SECURITY DEFINER RPC — it only ever exposes
 * opt-in profiles and a limited set of non-sensitive fields.
 */
export type GuestProfile = {
    id: string;
    first_name: string | null;
    age: number | null;
    city: string | null;
    photo_url: string | null;
    short_bio: string | null;
    verified: boolean;
};

/**
 * Fetch the sanitized guest feed. Safe to call without an authenticated
 * session (uses the anon key). Never throws — returns [] on failure.
 */
export async function fetchGuestFeed(limit = 12): Promise<GuestProfile[]> {
    try {
        const { data, error } = await supabase.rpc('guest_feed', { feed_limit: limit });
        if (error) {
            if (__DEV__) console.warn('[guestApi] guest_feed error:', error.message);
            return [];
        }
        return (data ?? []) as GuestProfile[];
    } catch (err) {
        if (__DEV__) console.warn('[guestApi] guest_feed threw:', err);
        return [];
    }
}
