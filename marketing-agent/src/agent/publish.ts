import { supabase, isMissingDatabaseObject } from '../supabase.js';
import { config } from '../config.js';
import { logRun } from './generate.js';

type ContentRow = {
    id: string;
    channel: string;
    title: string | null;
    body: string;
    hashtags: string[];
    scheduled_at: string | null;
};

export async function runPublish(opts: { dryRun?: boolean } = {}) {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
        .from('marketing_content')
        .select('id, channel, title, body, hashtags, scheduled_at')
        .eq('status', 'approved')
        .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
        .order('scheduled_at', { ascending: true, nullsFirst: true })
        .limit(25)
        .returns<ContentRow[]>();

    if (error && isMissingDatabaseObject(error.message)) {
        console.log('marketing_content table not found — run `npm run db:push` first.');
        return;
    }
    if (error) throw error;

    const due = data ?? [];
    let published = 0;
    let failed = 0;
    let skipped = 0;

    for (const content of due) {
        if (opts.dryRun) {
            console.log(`[dry-run] would publish ${content.id} → ${content.channel}`);
            published += 1;
            continue;
        }
        try {
            const ref = await publishViaAggregator(content);
            if (ref === null) {
                // No aggregator configured — leave the item 'approved' so it can
                // be published later once creds are set (do NOT mark published).
                skipped += 1;
                continue;
            }
            await supabase
                .from('marketing_content')
                .update({ status: 'published', published_at: new Date().toISOString(), external_ref: ref })
                .eq('id', content.id);
            published += 1;
            console.log(`✅ published ${content.id} → ${content.channel}`);
        } catch (err) {
            failed += 1;
            const message = err instanceof Error ? err.message : 'publish failed';
            await supabase
                .from('marketing_content')
                .update({ status: 'failed', external_ref: { error: message } })
                .eq('id', content.id);
            console.error(`❌ failed ${content.id}: ${message}`);
        }
    }

    if (skipped > 0) {
        console.log(
            `⚠️  ${skipped} approved item(s) left unpublished — set MARKETING_AGGREGATOR_URL/KEY to publish.`,
        );
    }
    console.log(`Done. candidates=${due.length} published=${published} skipped=${skipped} failed=${failed}`);
    await logRun('publish', failed ? 'partial' : opts.dryRun ? 'dry_run' : 'ok', Boolean(opts.dryRun), null, {
        candidates: due.length,
        published,
        skipped,
        failed,
    });
}

/**
 * Swap this single function to change publishing provider. Works with any
 * "one API → many channels" aggregator (Postiz self-host, Ayrshare hosted).
 * Returns null when no aggregator is configured so the caller can safely skip
 * (leaving the item 'approved') instead of marking it published.
 */
async function publishViaAggregator(content: ContentRow): Promise<Record<string, unknown> | null> {
    if (!config.aggregatorUrl || !config.aggregatorKey) {
        return null;
    }

    const text = content.hashtags.length
        ? `${content.body}\n\n${content.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}`
        : content.body;

    const response = await fetch(`${config.aggregatorUrl.replace(/\/+$/, '')}/posts`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.aggregatorKey}`,
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
