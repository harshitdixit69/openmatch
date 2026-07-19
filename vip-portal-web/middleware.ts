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

  if (!user) {
    // If attempting to access dashboard, redirect to sign-in page
    if (request.nextUrl.pathname.startsWith('/dashboard')) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return response
  }

  // Query authenticated profile's user_tier value
  const { data: profile } = await supabase
    .from('profiles')
    .select('user_tier')
    .eq('id', user.id)
    .single()

  const userTier = profile?.user_tier || 'BASIC'
  const isVipRoute = request.nextUrl.pathname.startsWith('/dashboard/vip')

  // Enforce dynamic, path-based route isolation
  if (userTier === 'VIP' && !isVipRoute) {
    // VIP user attempting standard route -> auto-redirect to premium portal
    return NextResponse.redirect(new URL('/dashboard/vip', request.url))
  }

  if (userTier !== 'VIP' && isVipRoute) {
    // Non-VIP attempting VIP route -> kick back to standard dashboard
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
