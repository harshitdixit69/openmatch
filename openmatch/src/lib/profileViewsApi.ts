// src/lib/profileViewsApi.ts
// F7 – Who Viewed My Profile
import { supabase } from './supabase';

export type ProfileViewer = {
    viewerId: string;
    viewedAt: string;
    // Joined profile fields
    fullName: string;
    photoUrls: string[];
    location: string;
    bio: string | null;
    dob: string;
};

// ---------------------------------------------------------------------------
// Record a view (deduplicated per day on the DB side)
// ---------------------------------------------------------------------------
export async function recordProfileView(viewedProfileId: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id === viewedProfileId) return;

    await supabase.rpc('upsert_profile_view', {
        p_viewed_id: viewedProfileId,
    });
    // Intentionally swallow errors — view recording is fire-and-forget
}

// ---------------------------------------------------------------------------
// Fetch recent viewers of the current user's profile
// ---------------------------------------------------------------------------
export async function fetchProfileViewers(): Promise<ProfileViewer[]> {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) throw authErr ?? new Error('Not authenticated');

    // Get viewer IDs + times
    const { data: rows, error } = await supabase.rpc('get_profile_viewers', {
        p_viewed_id: user.id,
        p_limit: 50,
    }) as { data: { viewer_id: string; viewed_at: string }[] | null; error: any };

    if (error) throw error;
    if (!rows || rows.length === 0) return [];

    const viewerIds = rows.map((r) => r.viewer_id);

    // Filter out blocked users
    const { data: blockRows } = await supabase
        .from('user_blocks')
        .select('blocker_id, blocked_id')
        .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`);

    const blockedUserIds = new Set<string>();
    if (blockRows) {
        for (const block of blockRows) {
            blockedUserIds.add(block.blocker_id === user.id ? block.blocked_id : block.blocker_id);
        }
    }

    const filteredViewerIds = viewerIds.filter((id) => !blockedUserIds.has(id));
    if (filteredViewerIds.length === 0) return [];

    // Join profile data
    const { data: profiles, error: profilesErr } = await supabase
        .from('profiles')
        .select('id, full_name, photo_urls, location, bio, dob')
        .in('id', filteredViewerIds);

    if (profilesErr) throw profilesErr;

    const profileMap = new Map(
        (profiles ?? []).map((p) => [p.id, p])
    );

    return rows
        .map((r) => {
            const p = profileMap.get(r.viewer_id);
            if (!p) return null;
            return {
                viewerId: r.viewer_id,
                viewedAt: r.viewed_at,
                fullName: p.full_name,
                photoUrls: p.photo_urls ?? [],
                location: p.location,
                bio: p.bio ?? null,
                dob: p.dob,
            } satisfies ProfileViewer;
        })
        .filter((v): v is ProfileViewer => v !== null)
        .sort((a, b) => new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime());
}
