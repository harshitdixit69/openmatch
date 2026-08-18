import { supabase, isMissingDatabaseObject } from '../supabase.js';
import { config } from '../config.js';
import { logRun } from './generate.js';

type PublishedRow = { id: string; channel: string; external_ref: Record<string, unknown> | null };

type NormalizedStats = {
    impressions?: number;
    clicks?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    installs?: number;
    raw?: Record<string, unknown>;
};

/**
 * Phase 2 feedback loop. For each recently published post, pull engagement
 * from the aggregator's analytics endpoint and append a point-in-time snapshot
 * to `marketing_metrics`. `generate` then biases new drafts toward the
 * top-performing bodies. Safe no-op when no aggregator is configured.
 */
export async function runCollectMetrics() {
    const { data, error } = await supabase
        .from('marketing_content')
        .select('id, channel, external_ref')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(50)
        .returns<PublishedRow[]>();

    if (error && isMissingDatabaseObject(error.message)) {
        console.log('marketing_content table not found — run `npm run db:push` first.');
        return;
    }
    if (error) throw error;

    const published = data ?? [];

    if (!config.aggregatorUrl || !config.aggregatorKey) {
        console.log(
            `Tracked ${published.length} published post(s). Set MARKETING_AGGREGATOR_URL/KEY to collect real metrics.`,
        );
        await logRun('collect_metrics', 'ok', false, null, {
            tracked: published.length,
            captured: 0,
            note: 'aggregator not configured',
        });
        return;
    }

    const snapshots: Array<Record<string, unknown>> = [];
    let failed = 0;

    for (const content of published) {
        const postRef = extractExternalPostId(content.external_ref);
        if (!postRef) continue;
        try {
            const stats = await fetchAnalyticsFromAggregator(postRef);
            if (!stats) continue;
            snapshots.push({
                content_id: content.id,
                impressions: stats.impressions ?? 0,
                clicks: stats.clicks ?? 0,
                likes: stats.likes ?? 0,
                comments: stats.comments ?? 0,
                shares: stats.shares ?? 0,
                installs: stats.installs ?? 0,
                raw: stats.raw ?? {},
            });
        } catch (err) {
            failed += 1;
            console.error(`❌ analytics failed for ${content.id}:`, err instanceof Error ? err.message : err);
        }
    }

    if (snapshots.length > 0) {
        const { error: insertError } = await supabase.from('marketing_metrics').insert(snapshots);
        if (insertError && !isMissingDatabaseObject(insertError.message)) throw insertError;
    }

    console.log(`✅ Captured ${snapshots.length} metric snapshot(s) (failed=${failed}).`);
    await logRun('collect_metrics', failed ? 'partial' : 'ok', false, null, {
        tracked: published.length,
        captured: snapshots.length,
        failed,
    });
}

async function fetchAnalyticsFromAggregator(postId: string): Promise<NormalizedStats | null> {
    const url = `${config.aggregatorUrl.replace(/\/+$/, '')}/posts/${encodeURIComponent(postId)}/analytics`;
    const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.aggregatorKey}` },
    });

    const rawText = await response.text();
    if (!response.ok) {
        throw new Error(`Analytics error ${response.status}: ${rawText.slice(0, 200)}`);
    }

    try {
        return normalizeAnalytics(JSON.parse(rawText) as Record<string, unknown>);
    } catch {
        return null;
    }
}

export function normalizeAnalytics(payload: Record<string, unknown>): NormalizedStats {
    const source = (payload.analytics ?? payload.metrics ?? payload.data ?? payload) as Record<string, unknown>;
    const pick = (...keys: string[]): number => {
        for (const key of keys) {
            const value = source[key];
            if (typeof value === 'number' && Number.isFinite(value)) return value;
            if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
        }
        return 0;
    };

    return {
        impressions: pick('impressions', 'views', 'reach', 'impression_count'),
        clicks: pick('clicks', 'link_clicks', 'url_clicks', 'click_count'),
        likes: pick('likes', 'favorites', 'reactions', 'like_count'),
        comments: pick('comments', 'replies', 'comment_count'),
        shares: pick('shares', 'retweets', 'reposts', 'share_count'),
        installs: pick('installs', 'conversions', 'app_installs'),
        raw: payload,
    };
}

export function extractExternalPostId(externalRef: Record<string, unknown> | null): string | null {
    if (!externalRef || typeof externalRef !== 'object') return null;
    const response = externalRef.response as Record<string, unknown> | undefined;
    const candidates: unknown[] = [
        externalRef.id,
        externalRef.postId,
        externalRef.post_id,
        response?.id,
        response?.postId,
        response?.post_id,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate;
        if (typeof candidate === 'number') return String(candidate);
    }
    return null;
}
