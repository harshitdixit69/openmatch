#!/usr/bin/env node
import { runGenerate } from './agent/generate.js';
import { runPublish } from './agent/publish.js';
import { runCollectMetrics } from './agent/metrics.js';
import { runLifecycle } from './agent/lifecycle.js';

type Flags = {
    dryRun: boolean;
    channels?: string[];
    countPerChannel?: number;
    campaignId?: string;
};

function parseFlags(argv: string[]): Flags {
    const flags: Flags = { dryRun: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--dry-run') flags.dryRun = true;
        else if (arg === '--channels') flags.channels = (argv[++i] ?? '').split(',').map((c) => c.trim()).filter(Boolean);
        else if (arg === '--count') flags.countPerChannel = Number(argv[++i]);
        else if (arg === '--campaign') flags.campaignId = argv[++i];
    }
    return flags;
}

function usage(): void {
    console.log(`
OpenMatch Marketing Agent

Usage: omkt <command> [options]

Commands:
  generate          Draft on-brand content into the review queue (needs_review)
  publish           Publish APPROVED + due content via the aggregator
  collect-metrics   Pull engagement into marketing_metrics (Phase 2 stub)
  lifecycle         Draft re-engagement push for dormant users

Options:
  --dry-run                 Don't write to DB / don't post; log only
  --channels a,b,c          Override channels (e.g. instagram,reddit,x)
  --count N                 Pieces per channel (1-5, generate only)
  --campaign <uuid>         Target a specific campaign

Examples:
  omkt generate --dry-run
  omkt generate --channels instagram,reddit --count 3
  omkt publish --dry-run
  omkt lifecycle
`);
}

async function main(): Promise<void> {
    const [command, ...rest] = process.argv.slice(2);
    const flags = parseFlags(rest);

    switch (command) {
        case 'generate':
            await runGenerate(flags);
            break;
        case 'publish':
            await runPublish({ dryRun: flags.dryRun });
            break;
        case 'collect-metrics':
            await runCollectMetrics();
            break;
        case 'lifecycle':
            await runLifecycle({ dryRun: flags.dryRun });
            break;
        case 'help':
        case undefined:
            usage();
            break;
        default:
            console.error(`Unknown command: ${command}\n`);
            usage();
            process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('Fatal:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
});
