import { supabase } from './supabase';

export type ConciergeSession = {
    id: string;
    user_id: string;
    status: 'INTAKE_IN_PROGRESS' | 'INTAKE_COMPLETE' | 'SOURCING' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'AWAITING_SHORTLIST';
    intake_notes: string | null;
    intake_completed_at: string | null;
    created_at: string;
    updated_at: string;
};

export type IntakeChatMessage = {
    role: 'user' | 'assistant';
    content: string;
};

export type IntakeChatResponse = {
    status: 'IN_PROGRESS' | 'COMPLETE';
    message: string;
    summary?: string;
    sessionId?: string;
};

/** Fetch the current user's concierge session */
export async function fetchConciergeSession(): Promise<ConciergeSession | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
        .from('assisted_concierge_sessions')
        .select('id, user_id, status, intake_notes, intake_completed_at, created_at, updated_at')
        .eq('user_id', user.id)
        .maybeSingle();

    if (error) throw error;
    return data;
}

/** Send a chat message to the intake AI RM */
export async function sendIntakeMessage(messages: IntakeChatMessage[]): Promise<IntakeChatResponse> {
    const { data, error } = await supabase.functions.invoke('concierge-intake-chat', {
        body: { messages },
    });

    if (error) throw error;
    if (!data || typeof data.status !== 'string') {
        throw new Error('Invalid response from concierge intake.');
    }

    return data as IntakeChatResponse;
}

/** Submit raw transcript to process-concierge-intake Edge Function */
export async function submitRawIntakeTranscript(transcript: string): Promise<{ success: boolean; status: string }> {
    const { data, error } = await supabase.functions.invoke('process-concierge-intake', {
        body: { transcript },
    });

    if (error) throw error;
    return data;
}

export type AssistedShortlist = {
    id: string;
    user_id: string;
    session_id: string;
    status: string;
    created_at: string;
    updated_at: string;
};

export type AssistedShortlistItem = {
    id: string;
    shortlist_id: string;
    candidate_id: string;
    match_score: number;
    match_rationale: string;
    feedback_status: 'pending' | 'liked' | 'disliked';
    created_at: string;
    candidate_profile: {
        id: string;
        full_name: string;
        gender: string;
        dob: string;
        location: string;
        bio: string | null;
        preferences: string | null;
        photo_urls: string[];
        height_cm: number | null;
        occupation: string | null;
        education: string | null;
        diet: string | null;
        smokes: boolean | null;
        drinks_alcohol: boolean | null;
    };
};

/** Fetch active shortlist items for the current session */
export async function fetchAssistedShortlist(sessionId: string): Promise<AssistedShortlistItem[]> {
    const { data: shortlist, error: shortlistError } = await supabase
        .from('assisted_shortlists')
        .select('id')
        .eq('session_id', sessionId)
        .eq('status', 'active')
        .maybeSingle();

    if (shortlistError) throw shortlistError;
    if (!shortlist) return [];

    const { data, error } = await supabase
        .from('assisted_shortlist_items')
        .select(`
            id,
            shortlist_id,
            candidate_id,
            match_score,
            match_rationale,
            feedback_status,
            created_at,
            profiles (
                id,
                full_name,
                gender,
                dob,
                location,
                bio,
                preferences,
                photo_urls,
                height_cm,
                occupation,
                education,
                diet,
                smokes,
                drinks_alcohol
            )
        `)
        .eq('shortlist_id', shortlist.id);

    if (error) throw error;

    return (data || []).map((item: any) => ({
        id: item.id,
        shortlist_id: item.shortlist_id,
        candidate_id: item.candidate_id,
        match_score: item.match_score,
        match_rationale: item.match_rationale,
        feedback_status: item.feedback_status,
        created_at: item.created_at,
        candidate_profile: item.profiles,
    })) as unknown as AssistedShortlistItem[];
}

/** Update feedback status of a shortlist item */
export async function updateShortlistFeedback(itemId: string, status: 'liked' | 'disliked'): Promise<void> {
    const { error } = await supabase
        .from('assisted_shortlist_items')
        .update({ feedback_status: status })
        .eq('id', itemId);

    if (error) throw error;
}
