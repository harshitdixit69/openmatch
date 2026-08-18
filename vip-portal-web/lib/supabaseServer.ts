import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

/**
 * Cookie-bound server client (respects the signed-in user's session + RLS).
 * Use this to identify who is calling a route handler / server component.
 */
export function getServerClient(): SupabaseClient {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        // Route handlers may be read-only; swallow write attempts safely.
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            /* called from a context where cookies can't be set — ignore */
          }
        },
      },
    },
  )
}

/**
 * Service-role client. Bypasses RLS, so it can read/write the marketing_*
 * tables (which have RLS on with no public policies). NEVER expose this to the
 * browser — only construct it inside server-only code after an admin check.
 */
export function getServiceClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.')
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export type AdminGateResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string }

/**
 * Ensures the current request comes from a signed-in admin. Returns the user id
 * on success, or a structured failure the caller can turn into an HTTP status.
 */
export async function requireAdmin(): Promise<AdminGateResult> {
  const supabase = getServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, status: 401, error: 'Not authenticated.' }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle<{ is_admin: boolean | null }>()

  if (error || !profile?.is_admin) {
    return { ok: false, status: 403, error: 'Admin access required.' }
  }

  return { ok: true, userId: user.id }
}
