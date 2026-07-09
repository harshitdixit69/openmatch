import { MatchCandidate } from './matchmaking';
import { createPendingMatch } from './matchmakingApi';
import {
    buildFallbackRequestReasons,
    buildFallbackRequestTrustSummary,
    GenerateRequestReasonsResult,
    ProfileReliabilitySummary,
    ReviewVoiceIntroInput,
    ReviewVoiceIntroResult,
    SubmitInterestRequestInput,
    SubmitInterestRequestMessage,
    SubmitInterestRequestResult,
} from './intentEscrow';
import { ProfileRecord } from './profile';
import { supabase } from './supabase';

type GenerateRequestReasonsContext = {
    candidate: MatchCandidate;
    viewerProfile: ProfileRecord | null;
};

export async function generateRequestReasons(
    candidateProfileId: string,
    fallbackContext: GenerateRequestReasonsContext,
): Promise<GenerateRequestReasonsResult> {
    try {
        const { data, error } = await supabase.functions.invoke('generate-request-reasons', {
            body: {
                candidateProfileId,
                mode: 'sheet',
            },
        });

        if (error) {
            throw error;
        }

        const normalized = normalizeGeneratedReasonsResponse(data);
        if (!normalized) {
            throw new Error('generate-request-reasons returned an invalid payload.');
        }

        return normalized;
    } catch (error) {
        console.warn('Falling back to local request reasons.', error);
        return buildFallbackRequestReasons(fallbackContext);
    }
}

export async function submitInterestRequest(input: SubmitInterestRequestInput): Promise<SubmitInterestRequestResult> {
    const personalizedReason = input.personalizedReason.trim();
    if (!personalizedReason) {
        throw new Error('Add a short personalized reason before sending this request.');
    }

    try {
        const { data, error } = await supabase.functions.invoke('submit-interest-request', {
            body: {
                ...input,
                personalizedReason,
            },
        });

        if (error) {
            throw error;
        }

        const normalized = normalizeSubmitInterestResponse(data);
        if (!normalized) {
            throw new Error('submit-interest-request returned an invalid payload.');
        }

        return normalized;
    } catch (error) {
        if (!isCompatFallbackError(error)) {
            throw error instanceof Error ? error : new Error('Could not submit this request.');
        }

        const fallback = await createPendingMatch(input.candidateProfileId, {
            messageContent: personalizedReason,
        });

        return {
            requestId: null,
            matchId: fallback.match?.id ?? '',
            status: fallback.action === 'accepted' ? 'accepted' : fallback.action === 'already_connected' ? 'already_connected' : fallback.action === 'already_pending' ? 'already_pending' : 'sent',
            notice: fallback.notice ?? 'Request sent and chat opened.',
            requestQualityScore: input.requestQualityScore ?? null,
            ghostRiskScore: null,
            activeRequestCountRemaining: null,
            message: normalizeMessage(fallback.message),
        };
    }
}

export async function getRequestTrustSummary(
    targetProfileId: string,
    fallbackContext: Parameters<typeof buildFallbackRequestTrustSummary>[0],
): Promise<ProfileReliabilitySummary> {
    try {
        const { data, error } = await supabase.functions.invoke('get-request-trust-summary', {
            body: {
                targetProfileId,
            },
        });

        if (error) {
            throw error;
        }

        const normalized = normalizeTrustSummaryResponse(data);
        if (!normalized) {
            throw new Error('get-request-trust-summary returned an invalid payload.');
        }

        return normalized;
    } catch (error) {
        console.warn('Falling back to local trust summary.', error);
        return buildFallbackRequestTrustSummary(fallbackContext);
    }
}

export async function reviewRequestVoiceIntro(input: ReviewVoiceIntroInput): Promise<ReviewVoiceIntroResult> {
    try {
        const { data, error } = await supabase.functions.invoke('review-request-voice-intro', {
            body: {
                ...input,
                mediaUrl: input.mediaUrl.trim(),
            },
        });

        if (error) {
            throw error;
        }

        const normalized = normalizeVoiceIntroReviewResponse(data);
        if (!normalized) {
            throw new Error('review-request-voice-intro returned an invalid payload.');
        }

        return normalized;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not review voice intro.';
        throw new Error(message);
    }
}

function normalizeGeneratedReasonsResponse(value: unknown): GenerateRequestReasonsResult | null {
    if (!isRecord(value)) {
        return null;
    }

    const reasons = Array.isArray(value.reasons)
        ? value.reasons
            .map((reason, index) => normalizeReason(reason, index))
            .filter((reason): reason is GenerateRequestReasonsResult['reasons'][number] => Boolean(reason))
        : [];

    if (reasons.length === 0) {
        return null;
    }

    return {
        reasons: reasons.slice(0, 3),
        requestQualityScore: normalizeNumber(value.requestQualityScore, 75),
        requiresVoiceIntro: Boolean(value.requiresVoiceIntro),
        ghostRiskScore: normalizeNumber(value.ghostRiskScore, 18),
        activeRequestCount: normalizeNumber(value.activeRequestCount, 0),
        activeRequestLimit: normalizeNumber(value.activeRequestLimit, 10),
        source: 'edge',
    };
}

function normalizeReason(value: unknown, index: number) {
    if (!isRecord(value) || typeof value.text !== 'string' || !value.text.trim()) {
        return null;
    }

    return {
        id: typeof value.id === 'string' && value.id.trim() ? value.id : `reason-${index + 1}`,
        text: value.text.trim(),
        score: normalizeNumber(value.score, 70),
        tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())) : [],
    };
}

function normalizeSubmitInterestResponse(value: unknown): SubmitInterestRequestResult | null {
    if (!isRecord(value)) {
        return null;
    }

    const matchId = typeof value.matchId === 'string'
        ? value.matchId
        : isRecord(value.match) && typeof value.match.id === 'string'
            ? value.match.id
            : '';

    const status = typeof value.status === 'string'
        ? value.status
        : typeof value.action === 'string'
            ? value.action
            : '';

    if (!matchId || !status) {
        return null;
    }

    return {
        requestId: typeof value.requestId === 'string' ? value.requestId : null,
        matchId,
        status: status as SubmitInterestRequestResult['status'],
        notice: typeof value.notice === 'string' && value.notice.trim() ? value.notice.trim() : 'Request sent and chat opened.',
        requestQualityScore: typeof value.requestQualityScore === 'number' ? Math.round(value.requestQualityScore) : null,
        ghostRiskScore: typeof value.ghostRiskScore === 'number' ? Math.round(value.ghostRiskScore) : null,
        activeRequestCountRemaining:
            typeof value.activeRequestCountRemaining === 'number' ? Math.round(value.activeRequestCountRemaining) : null,
        message: normalizeMessage(value.message),
    };
}

function normalizeTrustSummaryResponse(value: unknown): ProfileReliabilitySummary | null {
    if (!isRecord(value)) {
        return null;
    }

    return {
        responseReliabilityScore: normalizeNumber(value.responseReliabilityScore, 80),
        ghostRiskScore: normalizeNumber(value.ghostRiskScore, 18),
        activeRequestLimit: normalizeNumber(value.activeRequestLimit, 10),
        activeRequestCount: normalizeNumber(value.activeRequestCount, 0),
        medianFirstReplyMinutes:
            typeof value.medianFirstReplyMinutes === 'number' && Number.isFinite(value.medianFirstReplyMinutes)
                ? Math.max(0, Math.round(value.medianFirstReplyMinutes))
                : null,
        managedBy: normalizeProfileOwner(value.managedBy),
        badges: Array.isArray(value.badges)
            ? value.badges.filter((badge): badge is string => typeof badge === 'string' && Boolean(badge.trim())).slice(0, 3)
            : [],
        source: 'edge',
    };
}

function normalizeVoiceIntroReviewResponse(value: unknown): ReviewVoiceIntroResult | null {
    if (!isRecord(value)) {
        return null;
    }

    const approved = Boolean(value.approved);

    return {
        approved,
        transcript: typeof value.transcript === 'string' && value.transcript.trim() ? value.transcript.trim() : null,
        summary: typeof value.summary === 'string' && value.summary.trim() ? value.summary.trim() : null,
        qualityAdjustment: normalizeNumber(value.qualityAdjustment, approved ? 10 : 0),
        rejectionReason:
            typeof value.rejectionReason === 'string' && value.rejectionReason.trim() ? value.rejectionReason.trim() : null,
    };
}

function normalizeMessage(value: unknown): SubmitInterestRequestMessage | null {
    if (!isRecord(value)) {
        return null;
    }

    if (
        typeof value.id !== 'string' ||
        typeof value.match_id !== 'string' ||
        typeof value.sender_id !== 'string' ||
        typeof value.content !== 'string' ||
        typeof value.is_flagged_by_system !== 'boolean' ||
        typeof value.created_at !== 'string'
    ) {
        return null;
    }

    return {
        id: value.id,
        match_id: value.match_id,
        sender_id: value.sender_id,
        content: value.content,
        is_flagged_by_system: value.is_flagged_by_system,
        created_at: value.created_at,
    };
}

function isCompatFallbackError(error: unknown) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();

    return (
        message.includes('submit-interest-request') ||
        message.includes('edge function returned a non-2xx status code') ||
        message.includes('failed to send a request to the edge function') ||
        message.includes('functionsfetcherror') ||
        message.includes('not found') ||
        message.includes('relation "public.interest_requests" does not exist') ||
        message.includes('relation "interest_requests" does not exist')
    );
}

function normalizeProfileOwner(value: unknown) {
    if (value === 'self' || value === 'parent' || value === 'sibling' || value === 'relative') {
        return value;
    }

    return null;
}

function normalizeNumber(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object';
}
