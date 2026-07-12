// src/lib/partnerPreferences.ts
// Types, constants, and validation for partner preference filters.
// Stored inline on public.profiles; see migration 20260713000100.

export const PREF_RELIGIONS = [
    'Any', 'Hindu', 'Muslim', 'Christian', 'Sikh', 'Jain', 'Buddhist', 'Parsi', 'Jewish', 'Other',
] as const;
export type PrefReligion = typeof PREF_RELIGIONS[number];

export const PREF_MARITAL_STATUSES = [
    'never_married', 'divorced', 'widowed', 'annulled',
] as const;
export type PrefMaritalStatus = typeof PREF_MARITAL_STATUSES[number];
export const PREF_MARITAL_STATUS_LABELS: Record<PrefMaritalStatus, string> = {
    never_married: 'Never Married',
    divorced: 'Divorced',
    widowed: 'Widowed',
    annulled: 'Annulled',
};

export const PREF_EDUCATIONS = [
    'Any', 'Diploma', 'Graduate', 'Post-Graduate', 'Doctorate',
] as const;
export type PrefEducation = typeof PREF_EDUCATIONS[number];

export const PREF_INCOME_BANDS = [
    'any', 'below_3L', '3-5L', '5-10L', '10-20L', '20-50L', '50L+',
] as const;
export type PrefIncomeBand = typeof PREF_INCOME_BANDS[number];
export const PREF_INCOME_BAND_LABELS: Record<PrefIncomeBand, string> = {
    any: 'Any',
    below_3L: 'Below ₹3L',
    '3-5L': '₹3L – 5L',
    '5-10L': '₹5L – 10L',
    '10-20L': '₹10L – 20L',
    '20-50L': '₹20L – 50L',
    '50L+': '₹50L+',
};

export const PREF_DIETS = [
    'Any', 'Vegetarian', 'Non-Vegetarian', 'Vegan', 'Jain',
] as const;
export type PrefDiet = typeof PREF_DIETS[number];

export const PREF_LOCATION_FLEXIBILITIES = [
    'anywhere', 'same_country', 'same_state', 'same_city',
] as const;
export type PrefLocationFlexibility = typeof PREF_LOCATION_FLEXIBILITIES[number];
export const PREF_LOCATION_FLEXIBILITY_LABELS: Record<PrefLocationFlexibility, string> = {
    anywhere: 'Anywhere',
    same_country: 'Same Country',
    same_state: 'Same State',
    same_city: 'Same City',
};

export interface PartnerPreferences {
    pref_age_min: number | null;
    pref_age_max: number | null;
    /** stored in cm */
    pref_height_min: number | null;
    /** stored in cm */
    pref_height_max: number | null;
    pref_religion: PrefReligion | null;
    pref_marital_status: PrefMaritalStatus[];
    pref_education: PrefEducation | null;
    pref_income_band: PrefIncomeBand | null;
    pref_diet: PrefDiet | null;
    pref_mother_tongue: string | null;
    pref_location_flexibility: PrefLocationFlexibility | null;
}

export const DEFAULT_PARTNER_PREFERENCES: PartnerPreferences = {
    pref_age_min: 21,
    pref_age_max: 35,
    pref_height_min: null,
    pref_height_max: null,
    pref_religion: 'Any',
    pref_marital_status: ['never_married'],
    pref_education: 'Any',
    pref_income_band: 'any',
    pref_diet: 'Any',
    pref_mother_tongue: null,
    pref_location_flexibility: 'anywhere',
};

export function validatePartnerPreferences(p: PartnerPreferences): string | null {
    if (p.pref_age_min !== null && (p.pref_age_min < 18 || p.pref_age_min > 99)) {
        return 'Minimum age must be between 18 and 99.';
    }
    if (p.pref_age_max !== null && (p.pref_age_max < 18 || p.pref_age_max > 99)) {
        return 'Maximum age must be between 18 and 99.';
    }
    if (p.pref_age_min !== null && p.pref_age_max !== null && p.pref_age_min > p.pref_age_max) {
        return 'Minimum age cannot exceed maximum age.';
    }
    if (p.pref_height_min !== null && p.pref_height_max !== null && p.pref_height_min > p.pref_height_max) {
        return 'Minimum height cannot exceed maximum height.';
    }
    return null;
}

/** Convert cm to feet + inches display string, e.g. 170 → "5'7\"" */
export function cmToFeetInches(cm: number): string {
    const totalInches = cm / 2.54;
    const feet = Math.floor(totalInches / 12);
    const inches = Math.round(totalInches % 12);
    return `${feet}'${inches}"`;
}

/** Convert feet + inches to cm */
export function feetInchesToCm(feet: number, inches: number): number {
    return Math.round((feet * 12 + inches) * 2.54);
}
