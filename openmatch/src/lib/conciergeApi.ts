import { supabase } from './supabase';

export type ConciergeSession = {
    id: string;
    user_id: string;
    status: 'INTAKE_IN_PROGRESS' | 'INTAKE_COMPLETE' | 'SOURCING' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
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
