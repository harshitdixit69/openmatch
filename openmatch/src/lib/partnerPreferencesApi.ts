// src/lib/partnerPreferencesApi.ts
import { supabase } from './supabase';
import type { PartnerPreferences } from './partnerPreferences';

const PREF_SELECT_COLUMNS = [
    'pref_age_min',
    'pref_age_max',
    'pref_height_min',
    'pref_height_max',
    'pref_religion',
    'pref_marital_status',
    'pref_education',
    'pref_income_band',
    'pref_diet',
    'pref_mother_tongue',
    'pref_location_flexibility',
].join(', ');

export async function fetchPartnerPreferences(): Promise<PartnerPreferences | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
        .from('profiles')
        .select(PREF_SELECT_COLUMNS)
        .eq('id', user.id)
        .single();

    if (error || !data) return null;
    return {
        pref_age_min: (data as any).pref_age_min ?? null,
        pref_age_max: (data as any).pref_age_max ?? null,
        pref_height_min: (data as any).pref_height_min ?? null,
        pref_height_max: (data as any).pref_height_max ?? null,
        pref_religion: (data as any).pref_religion ?? null,
        pref_marital_status: (data as any).pref_marital_status ?? [],
        pref_education: (data as any).pref_education ?? null,
        pref_income_band: (data as any).pref_income_band ?? null,
        pref_diet: (data as any).pref_diet ?? null,
        pref_mother_tongue: (data as any).pref_mother_tongue ?? null,
        pref_location_flexibility: (data as any).pref_location_flexibility ?? null,
    };
}

export async function upsertPartnerPreferences(prefs: PartnerPreferences): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
        .from('profiles')
        .update(prefs as any)
        .eq('id', user.id);

    if (error) throw error;
}

/** Fetch candidates with ad-hoc preference overrides (used by Search screen).
 *  Null params fall back to the viewer's stored prefs inside match_profiles(). */
export async function fetchFilteredMatches(
    overrides: Partial<PartnerPreferences> & { result_limit?: number },
) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.rpc('match_profiles', {
        result_limit: overrides.result_limit ?? 40,
        p_viewer_id: user?.id ?? null,
        p_age_min: overrides.pref_age_min ?? null,
        p_age_max: overrides.pref_age_max ?? null,
        p_height_min: overrides.pref_height_min ?? null,
        p_height_max: overrides.pref_height_max ?? null,
        p_religion: overrides.pref_religion ?? null,
        p_marital_status: overrides.pref_marital_status ?? null,
        p_education: overrides.pref_education ?? null,
        p_income_band: overrides.pref_income_band ?? null,
        p_diet: overrides.pref_diet ?? null,
        p_mother_tongue: overrides.pref_mother_tongue ?? null,
        p_location_flexibility: overrides.pref_location_flexibility ?? null,
    });
    if (error) throw error;
    return data;
}
