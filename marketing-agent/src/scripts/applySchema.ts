import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supabase } from '../supabase.js';

/**
 * Applies sql/schema.sql to the configured Supabase project via the
 * `exec_sql` RPC if present. If the RPC is not available, prints the SQL so
 * you can paste it into the Supabase SQL editor (simplest, one-time step).
 */
async function main(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    const sqlPath = join(here, '..', '..', 'sql', 'schema.sql');
    const sql = readFileSync(sqlPath, 'utf8');

    const { error } = await supabase.rpc('exec_sql', { sql });
    if (error) {
        console.log('Could not auto-apply (no exec_sql RPC). Paste this into the Supabase SQL editor:\n');
        console.log('--- copy below ---\n');
        console.log(sql);
        console.log('\n--- copy above ---');
        return;
    }
    console.log('✅ Schema applied.');
}

main().catch((err) => {
    console.error('Fatal:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
});
