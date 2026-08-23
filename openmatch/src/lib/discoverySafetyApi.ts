// src/lib/discoverySafetyApi.ts
//
// Backing API for the Settings > "Discovery & safety" section. Before this the
// section was cosmetic: the two toggles were local useState and "Blocked
// profiles" was a placeholder Alert.
//
// Columns live on public.profiles (see migration 20260823000100):
//   is_discoverable -> enforced inside match_profiles()
//   incognito_mode  -> enforced inside upsert_profile_view()
//
// Blocks read from public.user_blocks. Note there is exactly one blocks table;
// the `blocked_users` table some older code referenced never existed.

import { supabase } from './supabase';

export type DiscoverySettings = {
    /** Profile appears in other people's matching feeds. */
    isDiscoverable: boolean;
    /** Browsing does not add the user to anyone's visitor list. */
    incognitoMode: boolean;
};

export const DEFAULT_DISCOVERY_SETTINGS: DiscoverySettings = {
    isDiscoverable: true,
    incognitoMode: false,
};

export type BlockedProfile = {
    id: string;
    fullName: string;
    location: string | null;
    photoUrl: string | null;
    blockedAt: string;
};

async function requireUserId(): Promise<string> {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
        throw error ?? new Error('You must be signed in.');
    }
    return data.user.id;
}

// ---------------------------------------------------------------------------
// Discovery settings
// ---------------------------------------------------------------------------

export async function fetchDiscoverySettings(): Promise<DiscoverySettings> {
    const userId = await requireUserId();

    const { data, error } = await supabase
        .from('profiles')
        .select('is_discoverable, incognito_mode')
        .eq('id', userId)
        .maybeSingle();

    if (error) throw error;
    if (!data) return DEFAULT_DISCOVERY_SETTINGS;

    return {
        isDiscoverable: data.is_discoverable ?? true,
        incognitoMode: data.incognito_mode ?? false,
    };
}

/**
 * Persists a partial change. Callers apply the change optimistically and roll
 * back on throw, so this deliberately surfaces errors instead of swallowing them.
 */
export async function updateDiscoverySettings(
    patch: Partial<DiscoverySettings>,
): Promise<void> {
    const userId = await requireUserId();

    const row: Record<string, boolean> = {};
    if (patch.isDiscoverable !== undefined) row.is_discoverable = patch.isDiscoverable;
    if (patch.incognitoMode !== undefined) row.incognito_mode = patch.incognitoMode;

    if (Object.keys(row).length === 0) return;

    const { error } = await supabase.from('profiles').update(row).eq('id', userId);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Blocked profiles
// ---------------------------------------------------------------------------

type BlockedRow = {
    blocked_id: string;
    created_at: string;
    profiles: {
        id: string;
        full_name: string | null;
        location: string | null;
        photo_urls: string[] | null;
    } | null;
};

export async function fetchBlockedProfiles(): Promise<BlockedProfile[]> {
    const userId = await requireUserId();

    const { data, error } = await supabase
        .from('user_blocks')
        .select('blocked_id, created_at, profiles:blocked_id (id, full_name, location, photo_urls)')
        .eq('blocker_id', userId)
        .order('created_at', { ascending: false });

    if (error) throw error;

    return ((data ?? []) as unknown as BlockedRow[]).map((row) => ({
        id: row.blocked_id,
        // A blocked account can be deleted out from under the row; keep the
        // entry visible so the user can still clear it.
        fullName: row.profiles?.full_name?.trim() || 'Removed account',
        location: row.profiles?.location ?? null,
        photoUrl: row.profiles?.photo_urls?.[0] ?? null,
        blockedAt: row.created_at,
    }));
}
