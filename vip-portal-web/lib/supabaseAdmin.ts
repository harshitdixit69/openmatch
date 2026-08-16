import { createClient } from '@supabase/supabase-js'

/**
 * Server-only Supabase client using the service-role key.
 * This bypasses RLS and has full access to all tables + auth.admin API.
 *
 * ⚠️  NEVER import this file from a Client Component ('use client').
 *     It must only be used in Server Components, Server Actions, and Route Handlers.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL. ' +
      'Add them to vip-portal-web/.env.local'
    )
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
