import { NextResponse } from 'next/server'
import { requireAdmin, getServiceClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

const ALLOWED_STATUSES = [
  'draft',
  'needs_review',
  'approved',
  'rejected',
  'scheduled',
  'published',
  'failed',
] as const

/**
 * GET /api/marketing/content?status=needs_review
 * Lists marketing content for the review queue. Admin-only. Uses the service
 * role because marketing_* tables have RLS on with no public policies.
 */
export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') ?? 'needs_review'

  const service = getServiceClient()
  let query = service
    .from('marketing_content')
    .select(
      'id, campaign_id, channel, format, status, title, body, hashtags, image_prompt, image_url, safety_flags, scheduled_at, published_at, review_note, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (status !== 'all') {
    if (!ALLOWED_STATUSES.includes(status as (typeof ALLOWED_STATUSES)[number])) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 })
    }
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ items: data ?? [] })
}
