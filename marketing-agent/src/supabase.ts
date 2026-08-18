import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';

let _client: SupabaseClient | null = null;

/**
 * Service-role Supabase client (lazy). Runs server-side only (never ship the
 * service-role key to a client). Bypasses RLS so the agent can manage the
 * marketing_* tables and read `profiles` for lifecycle re-engagement.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
    get(_target, prop) {
        if (!_client) {
            _client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
                auth: { persistSession: false },
            });
        }
        return Reflect.get(_client as object, prop);
    },
});

export function isMissingDatabaseObject(message: string | undefined): boolean {
    return /does not exist|relation .* does not exist|column .* does not exist/i.test(message ?? '');
}
