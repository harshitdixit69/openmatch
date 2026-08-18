import { supabase, isMissingDatabaseObject } from '../supabase.js';
import { callJson } from '../llm.js';
import { fetchBrandGuide, type BrandGuide } from '../brand.js';
import { runSafetyCheck } from '../safety.js';
import { channelFormat, channelGuidance } from '../channels.js';

export type GenerateOptions = {
    dryRun?: boolean;
    channels?: string[];
    countPerChannel?: number;
    campaignId?: string;
};

type GeneratedItem = {
    title?: string;
    body: string;
    hashtags: string[];
    image_prompt?: string;
};

type Campaign = { id: string; title: string; goal: string; channels: string[] };

export async function runGenerate(opts: GenerateOptions = {}) {
    const brand = await fetchBrandGuide();
    const campaign = await fetchActiveCampaign(opts.campaignId);

    const channels = opts.channels?.length
        ? opts.channels
        : campaign?.channels?.length
            ? campaign.channels
            : ['instagram', 'reddit', 'x'];
    const countPerChannel = clamp(opts.countPerChannel ?? 2, 1, 5);

    const rows: Array<Record<string, unknown>> = [];

    for (const channel of channels) {
        const winners = await fetchTopPerformers(channel);
        const items = await generateForChannel(brand, campaign, channel, countPerChannel, winners);
        for (const item of items) {
            const flags = runSafetyCheck(item.body, brand.banned_topics);
            rows.push({
                campaign_id: campaign?.id ?? null,
                channel,
                format: channelFormat(channel),
                status: 'needs_review', // ALWAYS human-review before publishing
                title: item.title ?? null,
                body: item.body,
                hashtags: item.hashtags ?? [],
                image_prompt: item.image_prompt ?? null,
                safety_flags: flags,
            });
        }
    }

    if (opts.dryRun) {
        console.log(JSON.stringify({ generated: rows.length, channels, drafts: rows }, null, 2));
        await logRun('generate', 'dry_run', true, campaign?.id ?? null, { generated: rows.length, channels });
        return;
    }

    if (rows.length > 0) {
        const { error } = await supabase.from('marketing_content').insert(rows);
        if (error && !isMissingDatabaseObject(error.message)) throw error;
    }

    console.log(`✅ Generated ${rows.length} draft(s) across ${channels.join(', ')} → status=needs_review`);
    await logRun('generate', 'ok', false, campaign?.id ?? null, { generated: rows.length, channels });
}

async function generateForChannel(
    brand: BrandGuide,
    campaign: Campaign | null,
    channel: string,
    count: number,
    winners: string[] = [],
): Promise<GeneratedItem[]> {
    const system = [
        `You are the head of growth marketing for ${brand.name}, a matrimonial matchmaking app.`,
        `Brand voice: ${brand.voice}`,
        `Target audience: ${brand.target_audience}`,
        `Default call to action: ${brand.cta_default}`,
        `NEVER mention or imply any of these banned topics: ${brand.banned_topics.join(', ')}.`,
        `Be culturally respectful, never discriminatory, and never promise guaranteed outcomes.`,
    ].join('\n');

    const goal = campaign
        ? `Campaign goal: ${campaign.goal}. Campaign: ${campaign.title}.`
        : 'Goal: app installs + awareness.';
    const user = [
        goal,
        `Write ${count} distinct ${channelFormat(channel)} pieces for the "${channel}" channel.`,
        channelGuidance(channel),
        winners.length
            ? `These past posts performed best on this channel — echo what made them work (hook, structure, tone) without copying them verbatim:\n- ${winners.join('\n- ')}`
            : '',
        `Return STRICT JSON: {"items":[{"title": string|null, "body": string, "hashtags": string[], "image_prompt": string}]}.`,
    ].filter(Boolean).join('\n');

    const response = await callJson<{ items?: unknown[] }>([
        { role: 'system', content: system },
        { role: 'user', content: user },
    ]);

    const items = Array.isArray(response.items) ? response.items : [];
    const out: GeneratedItem[] = [];
    for (const raw of items) {
        const obj = (raw ?? {}) as Record<string, unknown>;
        const body = typeof obj.body === 'string' ? obj.body.trim() : '';
        if (!body) continue;
        out.push({
            title: typeof obj.title === 'string' ? obj.title : undefined,
            body,
            hashtags: Array.isArray(obj.hashtags) ? obj.hashtags.filter((h): h is string => typeof h === 'string') : [],
            image_prompt: typeof obj.image_prompt === 'string' ? obj.image_prompt : undefined,
        });
    }
    return out;
}

async function fetchActiveCampaign(campaignId?: string): Promise<Campaign | null> {
    const base = supabase
        .from('marketing_campaigns')
        .select('id, title, goal, channels')
        .eq('status', 'active');

    const { data, error } = campaignId
        ? await base.eq('id', campaignId).maybeSingle<Campaign>()
        : await base.order('created_at', { ascending: true }).limit(1).maybeSingle<Campaign>();

    if (error && !isMissingDatabaseObject(error.message)) throw error;
    return data ?? null;
}

/**
 * Feedback loop: fetch the best-performing published posts for a channel so the
 * generator can echo what worked. "Best" = highest clicks, then impressions,
 * from the most recent metrics snapshot per post. Returns short body excerpts.
 */
async function fetchTopPerformers(channel: string, limit = 3): Promise<string[]> {
    const { data, error } = await supabase
        .from('marketing_content')
        .select('body, marketing_metrics(clicks, impressions, captured_at)')
        .eq('channel', channel)
        .eq('status', 'published')
        .limit(25)
        .returns<Array<{
            body: string;
            marketing_metrics: Array<{ clicks: number; impressions: number; captured_at: string }> | null;
        }>>();

    if (error || !data) return [];

    return data
        .map((row) => {
            const snapshots = row.marketing_metrics ?? [];
            if (snapshots.length === 0) return null;
            const latest = snapshots.reduce((best, current) =>
                current.captured_at > best.captured_at ? current : best,
            );
            return { body: row.body, clicks: latest.clicks ?? 0, impressions: latest.impressions ?? 0 };
        })
        .filter((row): row is { body: string; clicks: number; impressions: number } => row !== null)
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
        .slice(0, limit)
        .map((row) => row.body.replace(/\s+/g, ' ').slice(0, 240));
}

export async function logRun(
    mode: string,
    status: string,
    dryRun: boolean,
    campaignId: string | null,
    summary: Record<string, unknown>,
    error: string | null = null,
) {
    const { error: insertError } = await supabase.from('marketing_agent_runs').insert({
        mode,
        status,
        dry_run: dryRun,
        campaign_id: campaignId,
        summary,
        error,
    });
    if (insertError && !isMissingDatabaseObject(insertError.message)) {
        console.warn('Could not write marketing_agent_runs:', insertError.message);
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)));
}
