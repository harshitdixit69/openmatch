import { MatchCandidate } from './matchmaking';
import { ProfileOwner, ProfileRecord } from './profile';

export type InterestRequestStatus = 'sent' | 'accepted' | 'declined' | 'expired' | 'ghosted' | 'closed';
export type RequestMediaType = 'none' | 'voice' | 'video';

export type RequestReasonSuggestion = {
    id: string;
    text: string;
    score: number;
    tags: string[];
};

export type GenerateRequestReasonsResult = {
    reasons: RequestReasonSuggestion[];
    requestQualityScore: number;
    requiresVoiceIntro: boolean;
    ghostRiskScore: number;
    activeRequestCount: number;
    activeRequestLimit: number;
    source: 'edge' | 'fallback';
};

export type SubmitInterestRequestInput = {
    candidateProfileId: string;
    selectedReasonId: string;
    personalizedReason: string;
    mediaType: RequestMediaType;
    mediaUrl: string | null;
    voiceTranscript: string | null;
    requestQualityScore?: number | null;
    isSuper?: boolean;
};

export type SubmitInterestRequestMessage = {
    id: string;
    match_id: string;
    sender_id: string;
    content: string;
    is_flagged_by_system: boolean;
    created_at: string;
};

export type SubmitInterestRequestResult = {
    requestId: string | null;
    matchId: string;
    status: InterestRequestStatus | 'already_pending' | 'already_connected';
    notice: string;
    requestQualityScore: number | null;
    ghostRiskScore: number | null;
    activeRequestCountRemaining: number | null;
    message: SubmitInterestRequestMessage | null;
};

export type ReviewVoiceIntroInput = {
    requestId?: string | null;
    mediaUrl: string;
    durationSeconds: number;
    transcript?: string | null;
};

export type ReviewVoiceIntroResult = {
    approved: boolean;
    transcript: string | null;
    summary: string | null;
    qualityAdjustment: number;
    rejectionReason: string | null;
};

export type ProfileReliabilitySummary = {
    responseReliabilityScore: number;
    ghostRiskScore: number;
    activeRequestLimit: number;
    activeRequestCount: number;
    medianFirstReplyMinutes: number | null;
    managedBy: ProfileOwner | null;
    badges: string[];
    source: 'edge' | 'fallback';
};

type BuildFallbackRequestReasonsContext = {
    candidate: MatchCandidate;
    viewerProfile: ProfileRecord | null;
};

export type BuildFallbackRequestTrustSummaryContext = {
    managedBy: ProfileOwner | null;
    ghostRiskScore?: number | null;
    activeRequestCount?: number | null;
    activeRequestLimit?: number | null;
    responseReliabilityScore?: number | null;
    medianFirstReplyMinutes?: number | null;
};

export function buildFallbackRequestReasons({
    candidate,
    viewerProfile,
}: BuildFallbackRequestReasonsContext): GenerateRequestReasonsResult {
    const suggestions: RequestReasonSuggestion[] = [];
    const viewerLocation = normalizeText(viewerProfile?.location);
    const candidateLocation = normalizeText(candidate.location);

    if (viewerLocation && candidateLocation && viewerLocation === candidateLocation) {
        suggestions.push({
            id: 'city-alignment',
            text: `You are both based in ${candidate.location}, which makes early conversations and family logistics much easier to explore seriously.`,
            score: 84,
            tags: ['city'],
        });
    }

    if (viewerProfile?.preferences && candidate.preferences) {
        suggestions.push({
            id: 'preferences-alignment',
            text: 'Both profiles are explicit about long-term preferences, which makes this feel more intentional than a generic request.',
            score: 81,
            tags: ['values', 'preferences'],
        });
    }

    if (viewerProfile?.bio && candidate.bio) {
        suggestions.push({
            id: 'profile-depth',
            text: 'Both of you have added enough profile depth to start with a meaningful conversation instead of a generic intro.',
            score: 78,
            tags: ['profile-depth'],
        });
    }

    if (viewerProfile?.profile_owner && candidate.profile_owner && viewerProfile.profile_owner === candidate.profile_owner) {
        suggestions.push({
            id: 'manager-match',
            text: `Both profiles appear to be ${viewerProfile.profile_owner}-managed, which can help keep expectations and decision-making pace aligned.`,
            score: 74,
            tags: ['manager-type'],
        });
    }

    if (suggestions.length === 0) {
        suggestions.push({
            id: 'location-intent',
            text: `Your profile and ${getDisplayFirstName(candidate.full_name) || 'this profile'} both show enough detail to justify a respectful first conversation.`,
            score: 72,
            tags: ['intent'],
        });
    }

    if (suggestions.length < 3 && candidate.preferences) {
        suggestions.push({
            id: 'candidate-preferences',
            text: 'This profile already includes partner expectations, so the conversation can start with something specific instead of broad small talk.',
            score: 76,
            tags: ['preferences'],
        });
    }

    if (suggestions.length < 3) {
        suggestions.push({
            id: 'serious-first-step',
            text: 'This looks like a reasonable first step if you want to send a short, profile-specific note instead of a bulk interest.',
            score: 70,
            tags: ['intent'],
        });
    }

    const profileCompletenessSignals = [
        viewerProfile?.bio,
        viewerProfile?.preferences,
        viewerProfile?.photo_urls?.length ? 'viewer-photos' : null,
        candidate.bio,
        candidate.preferences,
        candidate.photo_urls.length ? 'candidate-photos' : null,
    ].filter(Boolean).length;

    return {
        reasons: suggestions.slice(0, 3),
        requestQualityScore: clampNumber(66 + profileCompletenessSignals * 3, 62, 88),
        requiresVoiceIntro: false,
        ghostRiskScore: 18,
        activeRequestCount: 0,
        activeRequestLimit: 10,
        source: 'fallback',
    };
}

export function buildFallbackRequestTrustSummary({
    managedBy,
    ghostRiskScore,
    activeRequestCount,
    activeRequestLimit,
    responseReliabilityScore,
    medianFirstReplyMinutes,
}: BuildFallbackRequestTrustSummaryContext): ProfileReliabilitySummary {
    const normalizedGhostRisk = clampNumber(ghostRiskScore ?? 18, 0, 100);
    const normalizedActiveRequestCount = clampNumber(activeRequestCount ?? 0, 0, 50);
    const normalizedActiveRequestLimit = clampNumber(activeRequestLimit ?? 10, 0, 50);
    const normalizedResponseReliabilityScore = clampNumber(
        responseReliabilityScore ?? 88 - normalizedGhostRisk * 0.45,
        56,
        94,
    );

    return {
        responseReliabilityScore: normalizedResponseReliabilityScore,
        ghostRiskScore: normalizedGhostRisk,
        activeRequestLimit: normalizedActiveRequestLimit,
        activeRequestCount: normalizedActiveRequestCount,
        medianFirstReplyMinutes:
            typeof medianFirstReplyMinutes === 'number' && Number.isFinite(medianFirstReplyMinutes)
                ? Math.max(0, Math.round(medianFirstReplyMinutes))
                : null,
        managedBy,
        badges: buildTrustBadges({
            managedBy,
            ghostRiskScore: normalizedGhostRisk,
            responseReliabilityScore: normalizedResponseReliabilityScore,
            activeRequestCount: normalizedActiveRequestCount,
            activeRequestLimit: normalizedActiveRequestLimit,
            medianFirstReplyMinutes,
        }),
        source: 'fallback',
    };
}

function buildTrustBadges({
    managedBy,
    ghostRiskScore,
    responseReliabilityScore,
    activeRequestCount,
    activeRequestLimit,
    medianFirstReplyMinutes,
}: {
    managedBy: ProfileOwner | null;
    ghostRiskScore: number;
    responseReliabilityScore: number;
    activeRequestCount: number;
    activeRequestLimit: number;
    medianFirstReplyMinutes: number | null | undefined;
}) {
    const badges: string[] = [];

    if (responseReliabilityScore >= 85) {
        badges.push('Replies consistently');
    } else if (typeof medianFirstReplyMinutes === 'number' && medianFirstReplyMinutes > 0 && medianFirstReplyMinutes <= 90) {
        badges.push('Replies quickly');
    } else {
        badges.push('Trust history still forming');
    }

    if (ghostRiskScore <= 24) {
        badges.push('Low ghost risk');
    } else if (ghostRiskScore <= 49) {
        badges.push('Moderate ghost risk');
    } else {
        badges.push('Follow-through needs proof');
    }

    if (managedBy === 'self') {
        badges.push('Self-managed');
    } else if (managedBy) {
        badges.push(`${managedBy.charAt(0).toUpperCase()}${managedBy.slice(1)}-managed`);
    }

    if (activeRequestCount <= Math.max(2, Math.round(activeRequestLimit / 3))) {
        badges.push('Open requests under control');
    } else if (activeRequestCount >= Math.max(1, activeRequestLimit - 1)) {
        badges.push('Near outgoing request cap');
    }

    return badges.slice(0, 3);
}

function normalizeText(value: string | null | undefined) {
    return value?.trim().toLowerCase() ?? '';
}

function getDisplayFirstName(fullName: string | null | undefined) {
    const normalized = fullName?.trim();
    if (!normalized) {
        return '';
    }

    const [firstName] = normalized.split(/\s+/);
    return firstName ?? '';
}

function clampNumber(value: number, minimum: number, maximum: number) {
    return Math.max(minimum, Math.min(maximum, Math.round(value)));
}