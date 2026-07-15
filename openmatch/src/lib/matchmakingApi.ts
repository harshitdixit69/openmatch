import { MatchCandidate, MatchFeedResult, ViewerEmbeddingStatus } from './matchmaking';
import { getDefaultPartnerGenderPreference } from './profile';
import { supabase } from './supabase';

type ViewerEmbeddingRow = {
    embedding: unknown | null;
    onboarding_completed_at: string | null;
    created_at: string;
    gender: string;
    partner_gender_preference: string | null;
};

type LegacyViewerEmbeddingRow = Omit<ViewerEmbeddingRow, 'partner_gender_preference'>;

export type MatchRequestMessage = {
    id: string;
    match_id: string;
    sender_id: string;
    content: string;
    is_flagged_by_system: boolean;
    created_at: string;
};

export type MatchRequestRecord = {
    id: string;
    user_1_id: string;
    user_2_id: string;
    status: string;
    is_unlocked: boolean;
    created_at: string;
};

export type MatchRequestResponse = {
    action: string;
    match: MatchRequestRecord | null;
    message: MatchRequestMessage | null;
    notice?: string;
};

const delayedEmbeddingThresholdMs = 3 * 60 * 1000;

function normalizeCandidates(data: unknown, currentUserId: string): MatchCandidate[] {
    if (!Array.isArray(data)) {
        return [];
    }

    return data.flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object' || !('id' in candidate) || candidate.id === currentUserId) {
            return [];
        }

        const nextCandidate = candidate as MatchCandidate & {
            partner_gender_preference?: unknown;
            photo_urls?: unknown;
            distance_km?: unknown;
        };
        return [
            {
                ...nextCandidate,
                photo_urls: Array.isArray(nextCandidate.photo_urls)
                    ? nextCandidate.photo_urls.filter((photoUrl): photoUrl is string => typeof photoUrl === 'string')
                    : [],
                partner_gender_preference:
                    typeof nextCandidate.partner_gender_preference === 'string'
                        ? nextCandidate.partner_gender_preference
                        : null,
                distance_km:
                    typeof nextCandidate.distance_km === 'number'
                        ? nextCandidate.distance_km
                        : null,
            },
        ];
    });
}


function resolveViewerEmbeddingStatus(viewerProfile: ViewerEmbeddingRow | null | undefined): ViewerEmbeddingStatus {
    if (viewerProfile?.embedding) {
        return 'ready';
    }

    const referenceTimestamp = viewerProfile?.onboarding_completed_at ?? viewerProfile?.created_at;
    if (!referenceTimestamp) {
        return 'pending';
    }

    const requestedAt = new Date(referenceTimestamp);
    if (Number.isNaN(requestedAt.getTime())) {
        return 'pending';
    }

    return Date.now() - requestedAt.getTime() >= delayedEmbeddingThresholdMs ? 'delayed' : 'pending';
}

function isMissingPartnerGenderPreferenceColumn(error: { message?: string } | null | undefined) {
    const message = error?.message ?? '';
    return /partner_gender_preference/i.test(message) && /column/i.test(message) && /does not exist/i.test(message);
}

async function fetchViewerMatchProfile(currentUserId: string) {
    const primary = await supabase
        .from('profiles')
        .select('embedding, onboarding_completed_at, created_at, gender, partner_gender_preference')
        .eq('id', currentUserId)
        .single<ViewerEmbeddingRow>();

    if (!primary.error) {
        return primary.data;
    }

    if (!isMissingPartnerGenderPreferenceColumn(primary.error)) {
        throw primary.error;
    }

    const fallback = await supabase
        .from('profiles')
        .select('embedding, onboarding_completed_at, created_at, gender')
        .eq('id', currentUserId)
        .single<LegacyViewerEmbeddingRow>();

    if (fallback.error) {
        throw fallback.error;
    }

    return {
        ...fallback.data,
        partner_gender_preference: getDefaultPartnerGenderPreference(fallback.data.gender),
    } satisfies ViewerEmbeddingRow;
}

export async function fetchSemanticMatches(limit = 50): Promise<MatchFeedResult> {
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
        throw userError;
    }

    if (!user) {
        throw new Error('You must be signed in to load matches.');
    }

    const viewerProfile = await fetchViewerMatchProfile(user.id);

    if (!viewerProfile?.embedding) {
        return {
            candidates: [],
            viewerEmbeddingReady: false,
            viewerEmbeddingStatus: resolveViewerEmbeddingStatus(viewerProfile),
            usedLegacyFunction: false,
        };
    }

    const { data: matchesData, error: matchesErr } = await supabase
        .from('matches')
        .select('user_1_id, user_2_id, status')
        .or(`user_1_id.eq.${user.id},user_2_id.eq.${user.id}`);

    if (matchesErr) {
        throw matchesErr;
    }

    const matchStatusMap = new Map<string, string>();
    if (matchesData) {
        for (const row of matchesData) {
            const otherId = row.user_1_id === user.id ? row.user_2_id : row.user_1_id;
            matchStatusMap.set(otherId, row.status);
        }
    }

    const { data, error } = await supabase.rpc('match_profiles', {
        result_limit: limit,
        p_viewer_id: user.id,
    });

    if (error) {
        throw error;
    }

    // Gender filtering is already applied inside match_profiles() on the DB.
    // We only normalize (type-safe field coercion + self-exclusion) here.
    const candidates = normalizeCandidates(data, user.id)
        .map((candidate) => {
            candidate.matchStatus = matchStatusMap.get(candidate.id) || 'none';
            return candidate;
        })
        .filter((candidate) => {
            // Keep 'rejected' (passed) and 'none' (unconnected). Filter out active matches ('accepted', 'pending')
            return candidate.matchStatus !== 'accepted' && candidate.matchStatus !== 'pending';
        });

    return {
        candidates,
        viewerEmbeddingReady: true,
        viewerEmbeddingStatus: 'ready',
        usedLegacyFunction: false,
    };
}

export async function fetchCompatibilitySnapshot(candidateProfileId: string) {
    const { data, error } = await supabase.functions.invoke('generate-compatibility-summary', {
        body: { candidateProfileId },
    });

    if (error) {
        throw error;
    }

    if (!data || typeof data.summary !== 'string' || !data.summary.trim()) {
        throw new Error('Compatibility summary response was invalid.');
    }

    return data.summary.trim();
}

export async function createPendingMatch(
    candidateProfileId: string,
    options?: { messageContent?: string },
): Promise<MatchRequestResponse> {
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
        throw userError;
    }

    if (!user) {
        throw new Error('You must be signed in to save a match.');
    }

    if (candidateProfileId === user.id) {
        return {
            action: 'noop',
            match: null,
            message: null,
        };
    }

    const { data, error } = await supabase.functions.invoke('manage-match-request', {
        body: {
            action: 'send',
            candidateProfileId,
            messageContent: options?.messageContent?.trim() || undefined,
        },
    });

    if (error) {
        throw error;
    }

    if (!data || typeof data.action !== 'string') {
        throw new Error('Match request response was invalid.');
    }

    const result = data as MatchRequestResponse;

    return result;
}

export async function recordPassedProfile(candidateProfileId: string) {
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
        throw userError;
    }

    if (!user || candidateProfileId === user.id) {
        return;
    }

    const { error } = await supabase.rpc('reject_profile', { p_candidate_id: candidateProfileId });
    if (error) {
        throw error;
    }
}

/** Clear all passed/swiped-left profile IDs for the current user from the database.
 *  Used by the "Reset feed" button so profiles the user swiped away reappear. */
export async function clearPassedProfiles(): Promise<void> {
    const { error } = await supabase.rpc('clear_rejected_profiles');
    if (error) {
        throw error;
    }
}