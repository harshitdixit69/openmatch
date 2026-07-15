import AsyncStorage from '@react-native-async-storage/async-storage';

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

type ExistingMatchRow = {
    user_1_id: string;
    user_2_id: string;
};

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
const passedProfilesStorageKeyPrefix = 'openmatch:passedProfiles:';

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

function getPassedProfilesStorageKey(userId: string) {
    return `${passedProfilesStorageKeyPrefix}${userId}`;
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

export async function fetchPassedProfileIds(currentUserId: string) {
    const storedValue = await AsyncStorage.getItem(getPassedProfilesStorageKey(currentUserId));
    if (!storedValue) {
        return new Set<string>();
    }

    try {
        const parsed = JSON.parse(storedValue);
        if (!Array.isArray(parsed)) {
            return new Set<string>();
        }

        return new Set(parsed.filter((profileId): profileId is string => typeof profileId === 'string'));
    } catch {
        return new Set<string>();
    }
}

async function savePassedProfileIds(currentUserId: string, profileIds: Set<string>) {
    await AsyncStorage.setItem(getPassedProfilesStorageKey(currentUserId), JSON.stringify([...profileIds]));
}

async function fetchExistingMatchedProfileIds(currentUserId: string) {
    const { data, error } = await supabase
        .from('matches')
        .select('user_1_id, user_2_id')
        .or(`user_1_id.eq.${currentUserId},user_2_id.eq.${currentUserId}`)
        .returns<ExistingMatchRow[]>();

    if (error) {
        throw error;
    }

    return new Set(
        (data ?? []).map((match) =>
            match.user_1_id === currentUserId ? match.user_2_id : match.user_1_id,
        ),
    );
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

    const [existingMatchedProfileIds] = await Promise.all([
        fetchExistingMatchedProfileIds(user.id),
    ]);

    const excludedProfileIds = new Set<string>([...existingMatchedProfileIds]);

    const { data, error } = await supabase.rpc('match_profiles', {
        result_limit: limit,
        p_viewer_id: user.id,
    });

    if (error) {
        throw error;
    }

    // Gender filtering is already applied inside match_profiles() on the DB.
    // We only normalize (type-safe field coercion + self-exclusion) here.
    const candidates = normalizeCandidates(data, user.id).filter(
        (candidate) => !excludedProfileIds.has(candidate.id),
    );

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

    const passedProfileIds = await fetchPassedProfileIds(user.id);
    if (!passedProfileIds.has(candidateProfileId)) {
        return result;
    }

    passedProfileIds.delete(candidateProfileId);
    await savePassedProfileIds(user.id, passedProfileIds);

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

    const passedProfileIds = await fetchPassedProfileIds(user.id);
    passedProfileIds.add(candidateProfileId);
    await savePassedProfileIds(user.id, passedProfileIds);
}

/** Clear all locally-stored passed/swiped-left profile IDs for the current user.
 *  Used by the "Reset feed" button so profiles the user swiped away reappear. */
export async function clearPassedProfiles(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await AsyncStorage.removeItem(getPassedProfilesStorageKey(user.id));
}