import { supabase } from './supabase';

export type PremiumAnalyticsEventName =
    | 'premium_promo_impression'
    | 'premium_promo_cta_tap'
    | 'premium_highlight_card_open'
    | 'premium_highlight_interest_tap'
    | 'premium_popup_dismiss';

export type PremiumAnalyticsSurface = 'home_feed' | 'chat_inbox' | 'premium_tab';

export type PremiumAnalyticsPayload = {
    eventName: PremiumAnalyticsEventName;
    surface: PremiumAnalyticsSurface;
    context?: string | null;
    metadata?: Record<string, unknown>;
};

type PremiumAnalyticsRow = {
    event_name: PremiumAnalyticsEventName;
    surface: PremiumAnalyticsSurface;
    metadata: Record<string, unknown> | null;
    created_at: string;
};

type SurfaceMetrics = {
    impressions: number;
    ctaTaps: number;
    ctrPercent: number;
};

type ArmMetrics = {
    impressions: number;
    ctaTaps: number;
    ctrPercent: number;
};

export type PremiumAnalyticsSummary = {
    lookbackDays: number;
    totalEvents: number;
    totalImpressions: number;
    totalCtaTaps: number;
    totalCtrPercent: number;
    highlightOpens: number;
    highlightInterestTaps: number;
    topVariant: string | null;
    bySurface: Record<PremiumAnalyticsSurface, SurfaceMetrics>;
    byExperimentArm: Record<'A' | 'B', ArmMetrics>;
};

export async function trackPremiumEvent(payload: PremiumAnalyticsPayload) {
    try {
        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
            return;
        }

        const { error } = await supabase.from('premium_analytics_events').insert({
            profile_id: user.id,
            event_name: payload.eventName,
            surface: payload.surface,
            context: payload.context ?? null,
            metadata: payload.metadata ?? {},
        });

        if (error) {
            if (isMissingPremiumAnalyticsTable(error.message)) {
                return;
            }

            throw error;
        }
    } catch (error) {
        console.warn('Premium analytics event failed to record.', error);
    }
}

export async function fetchPremiumAnalyticsSummary(lookbackDays = 14): Promise<PremiumAnalyticsSummary | null> {
    try {
        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
            return null;
        }

        const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabase
            .from('premium_analytics_events')
            .select('event_name, surface, metadata, created_at')
            .eq('profile_id', user.id)
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(800)
            .returns<PremiumAnalyticsRow[]>();

        if (error) {
            if (isMissingPremiumAnalyticsTable(error.message)) {
                return null;
            }

            throw error;
        }

        const rows = data ?? [];
        const bySurface: Record<PremiumAnalyticsSurface, SurfaceMetrics> = {
            home_feed: { impressions: 0, ctaTaps: 0, ctrPercent: 0 },
            chat_inbox: { impressions: 0, ctaTaps: 0, ctrPercent: 0 },
            premium_tab: { impressions: 0, ctaTaps: 0, ctrPercent: 0 },
        };
        const byExperimentArm: Record<'A' | 'B', ArmMetrics> = {
            A: { impressions: 0, ctaTaps: 0, ctrPercent: 0 },
            B: { impressions: 0, ctaTaps: 0, ctrPercent: 0 },
        };

        const variantCounts = new Map<string, number>();
        let highlightOpens = 0;
        let highlightInterestTaps = 0;

        for (const row of rows) {
            if (row.event_name === 'premium_promo_impression') {
                bySurface[row.surface].impressions += 1;
                const arm = readExperimentArm(row.metadata);
                if (arm) {
                    byExperimentArm[arm].impressions += 1;
                }
            }

            if (row.event_name === 'premium_promo_cta_tap') {
                bySurface[row.surface].ctaTaps += 1;
                const arm = readExperimentArm(row.metadata);
                if (arm) {
                    byExperimentArm[arm].ctaTaps += 1;
                }
            }

            if (row.event_name === 'premium_highlight_card_open') {
                highlightOpens += 1;
            }

            if (row.event_name === 'premium_highlight_interest_tap') {
                highlightInterestTaps += 1;
            }

            const variant = readVariant(row.metadata);
            if (variant) {
                variantCounts.set(variant, (variantCounts.get(variant) ?? 0) + 1);
            }
        }

        for (const surface of Object.keys(bySurface) as PremiumAnalyticsSurface[]) {
            const metrics = bySurface[surface];
            metrics.ctrPercent = metrics.impressions > 0 ? roundPercent((metrics.ctaTaps / metrics.impressions) * 100) : 0;
        }

        for (const arm of Object.keys(byExperimentArm) as Array<'A' | 'B'>) {
            const metrics = byExperimentArm[arm];
            metrics.ctrPercent = metrics.impressions > 0 ? roundPercent((metrics.ctaTaps / metrics.impressions) * 100) : 0;
        }

        const totalImpressions = bySurface.home_feed.impressions + bySurface.chat_inbox.impressions + bySurface.premium_tab.impressions;
        const totalCtaTaps = bySurface.home_feed.ctaTaps + bySurface.chat_inbox.ctaTaps + bySurface.premium_tab.ctaTaps;

        return {
            lookbackDays,
            totalEvents: rows.length,
            totalImpressions,
            totalCtaTaps,
            totalCtrPercent: totalImpressions > 0 ? roundPercent((totalCtaTaps / totalImpressions) * 100) : 0,
            highlightOpens,
            highlightInterestTaps,
            topVariant: getTopVariant(variantCounts),
            bySurface,
            byExperimentArm,
        };
    } catch (error) {
        console.warn('Premium analytics summary unavailable.', error);
        return null;
    }
}

function getTopVariant(variantCounts: Map<string, number>) {
    let topVariant: string | null = null;
    let topCount = -1;

    for (const [variant, count] of variantCounts.entries()) {
        if (count > topCount) {
            topVariant = variant;
            topCount = count;
        }
    }

    return topVariant;
}

function readVariant(metadata: Record<string, unknown> | null) {
    if (!isRecord(metadata)) {
        return null;
    }

    const variant = metadata.variant;
    if (typeof variant !== 'string' || !variant.trim()) {
        return null;
    }

    return variant;
}

function readExperimentArm(metadata: Record<string, unknown> | null): 'A' | 'B' | null {
    if (!isRecord(metadata)) {
        return null;
    }

    const experimentArm = metadata.experimentArm;
    if (experimentArm === 'A' || experimentArm === 'B') {
        return experimentArm;
    }

    return null;
}

function roundPercent(value: number) {
    return Math.round(value * 10) / 10;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object';
}

function isMissingPremiumAnalyticsTable(message: string | undefined) {
    return /premium_analytics_events/i.test(message ?? '') && /(does not exist|relation)/i.test(message ?? '');
}
