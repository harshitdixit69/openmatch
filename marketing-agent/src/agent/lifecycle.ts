import { supabase, isMissingDatabaseObject } from '../supabase.js';
import { logRun } from './generate.js';

/**
 * Owned-audience re-engagement. Finds dormant OpenMatch users and drafts a
 * re-engagement push into the review queue (never auto-sends). Approve + wire
 * to Expo push / email in a later phase.
 */
export async function runLifecycle(opts: { dryRun?: boolean } = {}) {
    const cutoffIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .lt('updated_at', cutoffIso)
        .limit(100)
        .returns<{ id: string }[]>();

    if (error && isMissingDatabaseObject(error.message)) {
        console.log('profiles table/column not found; skipping.');
        return;
    }
    if (error) throw error;

    const dormant = (data ?? []).length;
    console.log(`Found ${dormant} dormant user(s) (no activity in 14 days).`);

    if (opts.dryRun || dormant === 0) {
        await logRun('lifecycle', opts.dryRun ? 'dry_run' : 'ok', Boolean(opts.dryRun), null, {
            dormantSampled: dormant,
            drafted: 0,
        });
        return;
    }

    const { error: insertError } = await supabase.from('marketing_content').insert({
        channel: 'push',
        format: 'push',
        status: 'needs_review',
        title: 'We saved your spot 💛',
        body: 'New matches are waiting for you on OpenMatch. Open the app to see who liked you back.',
        safety_flags: [],
    });
    if (insertError && !isMissingDatabaseObject(insertError.message)) throw insertError;

    console.log('✅ Drafted 1 re-engagement push → status=needs_review');
    await logRun('lifecycle', 'ok', false, null, { dormantSampled: dormant, drafted: 1 });
}
