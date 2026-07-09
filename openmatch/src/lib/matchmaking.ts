import { ProfileOwner } from './profile';

export type MatchCandidate = {
    id: string;
    full_name: string;
    gender: string;
    dob: string;
    location: string;
    bio: string | null;
    preferences: string | null;
    photo_urls: string[];
    height_cm: number | null;
    profile_owner: ProfileOwner | null;
    partner_gender_preference: string | null;
    similarity: number;
};

export type ViewerEmbeddingStatus = 'ready' | 'pending' | 'delayed';

export type MatchFeedResult = {
    candidates: MatchCandidate[];
    viewerEmbeddingReady: boolean;
    viewerEmbeddingStatus: ViewerEmbeddingStatus;
    usedLegacyFunction: boolean;
};

export type MatchFitBreakdown = {
    summary: string;
    fitPoints: string[];
    frictionPoints: string[];
};