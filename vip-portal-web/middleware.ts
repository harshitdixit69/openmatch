import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // Initialize Supabase Server Client
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Retrieve authenticated user session info
  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isAdminRoute = pathname.startsWith('/admin')
  const isDashboardRoute = pathname.startsWith('/dashboard')

  if (!user) {
    // Unauthenticated → redirect to login for protected routes
    if (isDashboardRoute || isAdminRoute) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return response
  }

  // ── Admin route gate ──────────────────────────────────────────────
  if (isAdminRoute) {
    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!adminProfile?.is_admin) {
      // Non-admin attempting admin route → kick to standard dashboard
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    // Admin user → allow through
    return response
  }

  // ── Dashboard route gate (existing VIP/Standard isolation) ────────
  if (isDashboardRoute) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_tier')
      .eq('id', user.id)
      .single()

    const userTier = profile?.user_tier || 'BASIC'
    const isVipRoute = pathname.startsWith('/dashboard/vip')

    // Enforce dynamic, path-based route isolation
    if (userTier === 'VIP' && !isVipRoute) {
      // VIP user attempting standard route -> auto-redirect to premium portal
      return NextResponse.redirect(new URL('/dashboard/vip', request.url))
    }

    if (userTier !== 'VIP' && isVipRoute) {
      // Non-VIP attempting VIP route -> kick back to standard dashboard
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
}
