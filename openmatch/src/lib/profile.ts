export type ProfileOwner = 'self' | 'parent' | 'sibling' | 'relative';

export const profileGenders = ['Woman', 'Man', 'Non-binary'] as const;
export const partnerGenderPreferences = ['Woman', 'Man', 'Non-binary', 'Everyone'] as const;

export type ProfileRecord = {
    id: string;
    full_name: string;
    gender: string;
    partner_gender_preference: string | null;
    photo_urls: string[];
    dob: string;
    location: string;
    bio: string | null;
    preferences: string | null;
    height_cm: number | null;
    profile_owner: ProfileOwner | null;
    onboarding_completed_at: string | null;
};

export type ProfileContactDetails = {
    phone_number: string | null;
    whatsapp_number: string | null;
};

export type ProfileContactInput = {
    phone_number: string;
    whatsapp_number: string;
};

export type ProfileInput = {
    full_name: string;
    gender: string;
    partner_gender_preference: string;
    photo_urls: string[];
    dob: string;
    location: string;
    bio: string;
    preferences: string;
    height_cm: number;
    profile_owner: ProfileOwner;
};

export type OnboardingCopilotResult = {
    bio: string;
    preferences: string;
    summary: string;
    missingTopics: string[];
};

function normalizeGenderToken(value: string | null | undefined) {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (normalized === 'man' || normalized === 'male') {
        return 'man';
    }

    if (normalized === 'woman' || normalized === 'female') {
        return 'woman';
    }

    if (normalized === 'non-binary' || normalized === 'non binary' || normalized === 'nonbinary') {
        return 'non-binary';
    }

    if (
        normalized === 'everyone' ||
        normalized === 'all' ||
        normalized === 'any' ||
        normalized === 'anyone' ||
        normalized === 'open to all' ||
        normalized === 'no preference'
    ) {
        return 'everyone';
    }

    return normalized;
}

export function getDefaultPartnerGenderPreference(gender: string | null | undefined) {
    const normalizedGender = normalizeGenderToken(gender);

    if (normalizedGender === 'man') {
        return 'Woman';
    }

    if (normalizedGender === 'woman') {
        return 'Man';
    }

    return 'Everyone';
}

export function matchesPartnerGenderPreference(
    candidateGender: string | null | undefined,
    partnerGenderPreference: string | null | undefined,
) {
    const normalizedPreference = normalizeGenderToken(partnerGenderPreference);
    if (!normalizedPreference || normalizedPreference === 'everyone') {
        return true;
    }

    return normalizeGenderToken(candidateGender) === normalizedPreference;
}

export function getDisplayFirstName(fullName: string | null | undefined) {
    const normalized = fullName?.trim();
    if (!normalized) {
        return '';
    }

    const [firstName] = normalized.split(/\s+/);
    return firstName ?? '';
}
