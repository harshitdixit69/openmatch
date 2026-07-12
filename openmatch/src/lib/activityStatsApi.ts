// src/lib/activityStatsApi.ts
// F9 – Dashboard / Activity Stats
import { supabase } from './supabase';

export type ActivityStats = {
    totalMatches: number;
    connectedMatches: number;
    unlockedMatches: number;
    requestsReceived: number;
    requestsSent: number;
    requestsAccepted: number;
    requestsGhosted: number;
    messagesSent: number;
    messagesReceived: number;
    profileViews7d: number;
    unreadMessages: number;
    reliabilityScore: number;
    ghostRiskScore: number;
    activeRequestLimit: number;
};

export async function fetchActivityStats(): Promise<ActivityStats> {
    const { data, error } = await supabase.rpc('get_activity_stats') as { data: ActivityStats | null; error: any };

    if (error) throw error;
    if (!data) throw new Error('No stats returned');
    return data;
}
