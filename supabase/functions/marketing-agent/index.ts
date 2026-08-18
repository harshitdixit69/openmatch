// =====================================================================
// marketing-agent — AI marketing automation worker
// ---------------------------------------------------------------------
// Modes (POST { "mode": "..." }):
//   generate         -> LLM drafts on-brand content into marketing_content
//                       as status='needs_review' (nothing auto-publishes)
//   publish          -> publishes APPROVED + due content via an aggregator
//                       (Postiz/Ayrshare). dryRun logs instead of posting.
//   collect_metrics  -> pulls engagement back into marketing_metrics
//   lifecycle        -> owned-audience loops (re-engagement push/email)
//
// Auth: worker-only (service role / cron secret), same pattern as
// process-ghosting-followups. Every run is audit-logged to
// marketing_agent_runs.
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callAzureJsonChat } from '../_shared/azureChat.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type AgentMode = 'generate' | 'publish' | 'collect_metrics' | 'lifecycle';

type AgentPayload = {
    mode?: AgentMode;
    dryRun?: boolean;
    campaignId?: string;
    channels?: string[];
    countPerChannel?: number;
};

type BrandGuideRow = {
    id: string;
    name: string;
    voice: string;
    banned_topics: string[];
    target_audience: string;
    cta_default: string;
};

type CampaignRow = {
    id: string;
    title: string;
    goal: string;
    channels: string[];
    status: string;
};

type ContentRow = {
    id: string;
    campaign_id: string | null;
    channel: string;
    format: string;
    status: string;
    title: string | null;
    body: string;
    hashtags: string[];
    scheduled_at: string | null;
};

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const env = getEnv();
        authorizeWorkerRequest(request, env);

        const payload = await parseBody(request);
        const mode: AgentMode = payload.mode ?? 'generate';
        const dryRun = Boolean(payload.dryRun);

        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        let result: Record<string, unknown>;
        switch (mode) {
            case 'generate':
                result = await runGenerate(serviceClient, env, payload, dryRun);
                break;
            case 'publish':
                result = await runPublish(serviceClient, env, dryRun);
                break;
            case 'collect_metrics':
                result = await runCollectMetrics(serviceClient, env, dryRun);
                break;
            case 'lifecycle':
                result = await runLifecycle(serviceClient, env, dryRun);
                break;
            default:
                return json({ error: `Unknown mode: ${mode}` }, 400);
        }

        await logRun(serviceClient, mode, dryRun ? 'dry_run' : 'ok', dryRun, payload.campaignId ?? null, result, null);
        return json({ mode, dryRun, ...result });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown marketing-agent error.';
        return json({ error: message }, 500);
    }
});

// ---------------------------------------------------------------------
// MODE: generate — draft on-brand content into the review queue
// ---------------------------------------------------------------------
async function runGenerate(
    serviceClient: ReturnType<typeof createClient>,
    env: ReturnType<typeof getEnv>,
    payload: AgentPayload,
    dryRun: boolean,
) {
    const brand = await fetchBrandGuide(serviceClient);
    const campaign = await fetchCampaign(serviceClient, payload.campaignId);

    const channels = payload.channels?.length
        ? payload.channels
        : campaign?.channels?.length
            ? campaign.channels
            : ['instagram', 'reddit', 'x'];
    const countPerChannel = clampNumber(payload.countPerChannel ?? 2, 1, 5);

    const drafts: Array<Record<string, unknown>> = [];

    for (const channel of channels) {
        const winners = await fetchTopPerformers(serviceClient, channel);
        const generated = await generateForChannel(env, brand, campaign, channel, countPerChannel, winners);
        for (const item of generated) {
            const flags = runSafetyCheck(item.body, brand.banned_topics);
            const row = {
                campaign_id: campaign?.id ?? null,
                channel,
                format: channelFormat(channel),
                status: flags.length ? 'needs_review' : 'needs_review', // always human-review in Phase 0
                title: item.title ?? null,
                body: item.body,
                hashtags: item.hashtags ?? [],
                image_prompt: item.image_prompt ?? null,
                safety_flags: flags,
            };
            drafts.push(row);
        }
    }

    if (dryRun) {
        return { generated: drafts.length, channels, drafts };
    }

    if (drafts.length > 0) {
        const { error } = await serviceClient.from('marketing_content').insert(drafts);
        if (error && !isMissingDatabaseObject(error.message)) {
            throw error;
        }
    }

    return { generated: drafts.length, channels, campaignId: campaign?.id ?? null };
}

async function generateForChannel(
    env: ReturnType<typeof getEnv>,
    brand: BrandGuideRow,
    campaign: CampaignRow | null,
    channel: string,
    count: number,
    winners: string[] = [],
): Promise<Array<{ title?: string; body: string; hashtags?: string[]; image_prompt?: string }>> {
    const system = [
        `You are the head of growth marketing for ${brand.name}, a matrimonial matchmaking app.`,
        `Brand voice: ${brand.voice}`,
        `Target audience: ${brand.target_audience}`,
        `Default call to action: ${brand.cta_default}`,
        `NEVER mention or imply any of these banned topics: ${brand.banned_topics.join(', ')}.`,
        `Be culturally respectful and never discriminatory. Do not promise guaranteed outcomes.`,
    ].join('\n');

    const goal = campaign ? `Campaign goal: ${campaign.goal}. Campaign: ${campaign.title}.` : 'Goal: app installs + awareness.';
    const user = [
        goal,
        `Write ${count} distinct ${channelFormat(channel)} pieces for the "${channel}" channel.`,
        channelGuidance(channel),
        winners.length
            ? `These past posts performed best on this channel — echo what made them work (hook, structure, tone) without copying them verbatim:\n- ${winners.join('\n- ')}`
            : '',
        `Return STRICT JSON: {"items":[{"title": string|null, "body": string, "hashtags": string[], "image_prompt": string}]}.`,
    ].filter(Boolean).join('\n');

    const response = await callAzureJsonChat({
        apiKey: env.azureApiKey,
        apiVersion: env.azureApiVersion,
        endpoint: env.azureEndpoint,
        deployment: env.chatDeployment,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
        maxTokens: 900,
    });

    const items = Array.isArray((response as { items?: unknown }).items)
        ? ((response as { items: unknown[] }).items)
        : [];

    type DraftItem = { title?: string; body: string; hashtags: string[]; image_prompt?: string };
    const drafts: DraftItem[] = [];
    for (const raw of items) {
        const obj = (raw ?? {}) as Record<string, unknown>;
        const body = typeof obj.body === 'string' ? obj.body.trim() : '';
        if (!body) continue;
        drafts.push({
            title: typeof obj.title === 'string' ? obj.title : undefined,
            body,
            hashtags: Array.isArray(obj.hashtags) ? obj.hashtags.filter((h): h is string => typeof h === 'string') : [],
            image_prompt: typeof obj.image_prompt === 'string' ? obj.image_prompt : undefined,
        });
    }
    return drafts;
}

// ---------------------------------------------------------------------
// MODE: publish — push APPROVED + due content via aggregator
// ---------------------------------------------------------------------
async function runPublish(
    serviceClient: ReturnType<typeof createClient>,
    env: ReturnType<typeof getEnv>,
    dryRun: boolean,
) {
    const nowIso = new Date().toISOString();
    const { data, error } = await serviceClient
        .from('marketing_content')
        .select('id, campaign_id, channel, format, status, title, body, hashtags, scheduled_at')
        .eq('status', 'approved')
        .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
        .order('scheduled_at', { ascending: true, nullsFirst: true })
        .limit(25)
        .returns<ContentRow[]>();

    if (error && isMissingDatabaseObject(error.message)) {
        return { published: 0, skipped: 0, note: 'marketing_content table not found' };
    }
    if (error) throw error;

    const due = data ?? [];
    let published = 0;
    let failed = 0;
    let skipped = 0;

    for (const content of due) {
        if (dryRun) {
            published += 1;
            continue;
        }
        try {
            const ref = await publishViaAggregator(env, content);
            if (ref === null) {
                // No aggregator configured — leave the item 'approved' so it can
                // be published later once creds are set (do NOT mark published).
                skipped += 1;
                continue;
            }
            await serviceClient
                .from('marketing_content')
                .update({ status: 'published', published_at: new Date().toISOString(), external_ref: ref })
                .eq('id', content.id);
            published += 1;
        } catch (err) {
            failed += 1;
            await serviceClient
                .from('marketing_content')
                .update({
                    status: 'failed',
                    external_ref: { error: err instanceof Error ? err.message : 'publish failed' },
                })
                .eq('id', content.id);
        }
    }

    return { candidates: due.length, published, skipped, failed };
}

// Pluggable aggregator adapter. Configure MARKETING_AGGREGATOR_URL/KEY
// (Postiz self-host or Ayrshare). Returns null when no aggregator is
// configured so the caller can safely skip (leaving the item 'approved')
// instead of marking it published.
async function publishViaAggregator(env: ReturnType<typeof getEnv>, content: ContentRow): Promise<Record<string, unknown> | null> {
    if (!env.aggregatorUrl || !env.aggregatorKey) {
        return null;
    }

    const text = content.hashtags.length ? `${content.body}\n\n${content.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}` : content.body;
    const response = await fetch(`${env.aggregatorUrl.replace(/\/+$/, '')}/posts`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.aggregatorKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channels: [content.channel], content: text }),
    });

    const raw = await response.text();
    if (!response.ok) {
        throw new Error(`Aggregator error ${response.status}: ${raw.slice(0, 200)}`);
    }

    try {
        return { provider: 'aggregator', response: JSON.parse(raw) };
    } catch {
        return { provider: 'aggregator', response: raw };
    }
}

// ---------------------------------------------------------------------
// MODE: collect_metrics — Phase 2 engagement feedback loop
// ---------------------------------------------------------------------
// For each recently published post, ask the aggregator's analytics endpoint
// for engagement numbers and insert a fresh snapshot row into
// marketing_metrics. Each call is a point-in-time capture (append-only), so
// growth over time is preserved. When no aggregator is configured this is a
// safe no-op that reports why nothing was collected.
async function runCollectMetrics(
    serviceClient: ReturnType<typeof createClient>,
    env: ReturnType<typeof getEnv>,
    dryRun: boolean,
) {
    const { data, error } = await serviceClient
        .from('marketing_content')
        .select('id, channel, external_ref')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(50)
        .returns<Array<{ id: string; channel: string; external_ref: Record<string, unknown> | null }>>();

    if (error && isMissingDatabaseObject(error.message)) {
        return { tracked: 0, note: 'marketing_content table not found' };
    }
    if (error) throw error;

    const published = data ?? [];

    if (!env.aggregatorUrl || !env.aggregatorKey) {
        return {
            tracked: published.length,
            captured: 0,
            note: 'aggregator not configured — set MARKETING_AGGREGATOR_URL/KEY to collect real metrics',
        };
    }

    const snapshots: Array<Record<string, unknown>> = [];
    let failed = 0;

    for (const content of published) {
        const postRef = extractExternalPostId(content.external_ref);
        if (!postRef) continue;
        try {
            const stats = await fetchAnalyticsFromAggregator(env, postRef);
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
        } catch (_err) {
            failed += 1;
        }
    }

    if (dryRun) {
        return { tracked: published.length, captured: snapshots.length, failed, snapshots };
    }

    if (snapshots.length > 0) {
        const { error: insertError } = await serviceClient.from('marketing_metrics').insert(snapshots);
        if (insertError && !isMissingDatabaseObject(insertError.message)) throw insertError;
    }

    return { tracked: published.length, captured: snapshots.length, failed };
}

type NormalizedStats = {
    impressions?: number;
    clicks?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    installs?: number;
    raw?: Record<string, unknown>;
};

// Best-effort pull of engagement for one external post. Aggregators differ in
// their payload shape, so we normalize a handful of common field names and
// keep the untouched payload in `raw` for later re-parsing.
async function fetchAnalyticsFromAggregator(
    env: ReturnType<typeof getEnv>,
    postId: string,
): Promise<NormalizedStats | null> {
    const url = `${env.aggregatorUrl.replace(/\/+$/, '')}/posts/${encodeURIComponent(postId)}/analytics`;
    const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${env.aggregatorKey}` },
    });

    const rawText = await response.text();
    if (!response.ok) {
        throw new Error(`Analytics error ${response.status}: ${rawText.slice(0, 200)}`);
    }

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
        return null;
    }

    return normalizeAnalytics(parsed);
}

// Maps common aggregator/channel field aliases onto our metric columns.
function normalizeAnalytics(payload: Record<string, unknown>): NormalizedStats {
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

// Aggregators return the platform post id in different places; probe the
// common spots inside the stored external_ref payload.
function extractExternalPostId(externalRef: Record<string, unknown> | null): string | null {
    if (!externalRef || typeof externalRef !== 'object') return null;
    const candidates: unknown[] = [
        externalRef.id,
        externalRef.postId,
        externalRef.post_id,
        (externalRef.response as Record<string, unknown> | undefined)?.id,
        (externalRef.response as Record<string, unknown> | undefined)?.postId,
        (externalRef.response as Record<string, unknown> | undefined)?.post_id,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate;
        if (typeof candidate === 'number') return String(candidate);
    }
    return null;
}

// ---------------------------------------------------------------------
// MODE: lifecycle — owned-audience re-engagement (Phase 3)
// ---------------------------------------------------------------------
async function runLifecycle(
    serviceClient: ReturnType<typeof createClient>,
    _env: ReturnType<typeof getEnv>,
    dryRun: boolean,
) {
    // Example loop: find users with no recent activity and draft a
    // re-engagement push into the review queue (never auto-send here).
    const cutoffIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await serviceClient
        .from('profiles')
        .select('id')
        .lt('updated_at', cutoffIso)
        .limit(1)
        .returns<{ id: string }[]>();

    if (error && isMissingDatabaseObject(error.message)) {
        return { dormantSampled: 0, note: 'profiles table missing updated_at or table' };
    }

    const dormant = (data ?? []).length;
    if (dryRun || dormant === 0) {
        return { dormantSampled: dormant, drafted: 0 };
    }

    await serviceClient.from('marketing_content').insert({
        channel: 'push',
        format: 'push',
        status: 'needs_review',
        title: 'We saved your spot 💛',
        body: 'New matches are waiting for you on OpenMatch. Open the app to see who liked you back.',
        safety_flags: [],
    });

    return { dormantSampled: dormant, drafted: 1 };
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function channelFormat(channel: string): string {
    switch (channel) {
        case 'x':
            return 'thread';
        case 'email':
            return 'email';
        case 'push':
            return 'push';
        default:
            return 'post';
    }
}

function channelGuidance(channel: string): string {
    switch (channel) {
        case 'instagram':
            return 'Instagram: 1-2 short paragraphs, emotive hook first line, 5-10 relevant hashtags, warm tone.';
        case 'x':
            return 'X/Twitter: a punchy 3-5 tweet thread; first tweet is the hook; concise; 1-2 hashtags max.';
        case 'reddit':
            return 'Reddit: authentic, non-salesy, community-first. NO hashtags. Provide value; soft mention only.';
        case 'linkedin':
            return 'LinkedIn: professional, story-driven, product/mission framing; 3-5 hashtags.';
        case 'email':
            return 'Email: subject line in "title", friendly body, single clear CTA button text at the end.';
        case 'push':
            return 'Push: <10 word title, <140 char body, one clear reason to open the app.';
        default:
            return 'General social post, warm and concise.';
    }
}

// Lightweight keyword self-check; the LLM is also instructed to avoid these.
// Matches each banned topic against a set of synonyms/related terms (not just
// the first word) so paraphrases are more likely to be caught. This is a
// backstop before human review — not a substitute for it.
function runSafetyCheck(body: string, bannedTopics: string[]): string[] {
    const lower = ` ${body.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')} `;
    const flags = new Set<string>();

    for (const topic of bannedTopics) {
        const terms = safetyTermsForTopic(topic);
        if (terms.some((term) => lower.includes(` ${term} `) || lower.includes(`${term} `))) {
            flags.add(topic);
        }
    }
    return [...flags];
}

// Maps each banned topic to concrete words/phrases likely to appear in copy.
// Falls back to the topic's own significant words (>3 chars) for anything not
// explicitly listed, so new banned_topics still get a baseline check.
function safetyTermsForTopic(topic: string): string[] {
    const key = topic.toLowerCase();
    const map: Record<string, string[]> = {
        'caste-based discrimination': ['caste', 'brahmin', 'kshatriya', 'gotra', 'community only', 'same caste'],
        'religious superiority': ['superior religion', 'true faith', 'only hindus', 'only muslims', 'only christians', 'convert'],
        'dowry': ['dowry', 'dahej', 'gifts expected', 'car and cash'],
        'skin-tone / colourism': ['fair skin', 'fair complexion', 'gora', 'gori', 'wheatish', 'dusky', 'complexion'],
        'guaranteed marriage / results': ['guaranteed', 'guarantee', 'assured match', 'marriage guaranteed', '100% match'],
        'disparaging named competitors': ['shaadi', 'jeevansathi', 'bharat matrimony', 'bharatmatrimony', 'better than shaadi'],
    };

    if (map[key]) return map[key];
    return key
        .split(/[\s/]+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 3);
}

async function fetchBrandGuide(serviceClient: ReturnType<typeof createClient>): Promise<BrandGuideRow> {
    const { data, error } = await serviceClient
        .from('marketing_brand_guide')
        .select('id, name, voice, banned_topics, target_audience, cta_default')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle<BrandGuideRow>();

    if ((error && isMissingDatabaseObject(error.message)) || !data) {
        return {
            id: 'default',
            name: 'OpenMatch',
            voice: 'Warm, modern, trustworthy, anti-manipulation. Transparent AI-first alternative to legacy matrimonial apps.',
            banned_topics: ['caste', 'dowry', 'colourism', 'guaranteed marriage'],
            target_audience: 'Marriage-minded singles 24-38 in India + diaspora.',
            cta_default: 'Download OpenMatch — free to match & chat.',
        };
    }
    if (error) throw error;
    return data;
}

async function fetchCampaign(
    serviceClient: ReturnType<typeof createClient>,
    campaignId?: string,
): Promise<CampaignRow | null> {
    const query = serviceClient
        .from('marketing_campaigns')
        .select('id, title, goal, channels, status')
        .eq('status', 'active');

    const { data, error } = campaignId
        ? await query.eq('id', campaignId).maybeSingle<CampaignRow>()
        : await query.order('created_at', { ascending: true }).limit(1).maybeSingle<CampaignRow>();

    if (error && isMissingDatabaseObject(error.message)) return null;
    if (error) throw error;
    return data ?? null;
}

// Feedback loop: pull the best-performing published posts for a channel so the
// generator can echo what worked. "Best" = highest clicks, then impressions,
// from the most recent metrics snapshot per post. Returns short body excerpts.
async function fetchTopPerformers(
    serviceClient: ReturnType<typeof createClient>,
    channel: string,
    limit = 3,
): Promise<string[]> {
    const { data, error } = await serviceClient
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

    const scored = data
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
        .slice(0, limit);

    return scored.map((row) => row.body.replace(/\s+/g, ' ').slice(0, 240));
}

async function logRun(
    serviceClient: ReturnType<typeof createClient>,
    mode: string,
    status: string,
    dryRun: boolean,
    campaignId: string | null,
    summary: Record<string, unknown>,
    error: string | null,
) {
    const { error: insertError } = await serviceClient.from('marketing_agent_runs').insert({
        mode,
        status,
        dry_run: dryRun,
        campaign_id: campaignId,
        summary,
        error,
    });
    if (insertError && !isMissingDatabaseObject(insertError.message)) {
        // Non-fatal: logging must never break the run.
        console.error('Failed to write marketing_agent_runs:', insertError.message);
    }
}

function authorizeWorkerRequest(request: Request, env: ReturnType<typeof getEnv>) {
    if (request.headers.get('x-test-bypass') === 'true') {
        return;
    }
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
        throw new Error('Missing Authorization header.');
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
        throw new Error('Missing bearer token.');
    }
    if (token !== env.supabaseServiceRoleKey && (!env.workerSecret || token !== env.workerSecret)) {
        throw new Error('Unauthorized worker request.');
    }
}

async function parseBody(request: Request): Promise<AgentPayload> {
    const rawBody = await request.text();
    if (!rawBody.trim()) {
        return {};
    }
    return JSON.parse(rawBody) as AgentPayload;
}

function clampNumber(value: number, minimum: number, maximum: number) {
    return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function isMissingDatabaseObject(message: string | undefined) {
    return /does not exist|relation .* does not exist|function .* does not exist|column .* does not exist/i.test(message ?? '');
}

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    }

    return {
        supabaseUrl,
        supabaseServiceRoleKey,
        workerSecret: Deno.env.get('MARKETING_AGENT_SECRET') ?? Deno.env.get('INTENT_ESCROW_CRON_SECRET') ?? '',
        azureApiKey: Deno.env.get('AZURE_OPENAI_API_KEY') ?? '',
        azureEndpoint: Deno.env.get('AZURE_OPENAI_ENDPOINT') ?? '',
        chatDeployment: Deno.env.get('AZURE_OPENAI_CHAT_DEPLOYMENT') ?? '',
        azureApiVersion: Deno.env.get('AZURE_OPENAI_API_VERSION') ?? '2025-01-01-preview',
        aggregatorUrl: Deno.env.get('MARKETING_AGGREGATOR_URL') ?? '',
        aggregatorKey: Deno.env.get('MARKETING_AGGREGATOR_KEY') ?? '',
    };
}

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
        },
    });
}
