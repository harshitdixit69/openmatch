import { NextResponse } from 'next/server'
import { requireAdmin, getServiceClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

type UpdateBody = {
  action: 'approve' | 'reject' | 'edit' | 'reset'
  // edit fields (optional)
  title?: string | null
  body?: string
  hashtags?: string[]
  review_note?: string | null
  // approve scheduling (optional). ISO string, or null = publish ASAP.
  scheduled_at?: string | null
}

/**
 * PATCH /api/marketing/content/[id]
 * Approve / reject / edit / reset a piece of marketing content. Admin-only.
 * Nothing here publishes — the publish worker only picks up `approved` rows.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireAdmin()
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  let payload: UpdateBody
  try {
    payload = (await request.json()) as UpdateBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const service = getServiceClient()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  switch (payload.action) {
    case 'approve': {
      updates.status = 'approved'
      updates.reviewer_id = gate.userId
      // If a schedule time is provided, honour it; otherwise publish ASAP.
      if (payload.scheduled_at !== undefined) {
        updates.scheduled_at = payload.scheduled_at
      }
      if (payload.review_note !== undefined) updates.review_note = payload.review_note
      break
    }
    case 'reject': {
      updates.status = 'rejected'
      updates.reviewer_id = gate.userId
      if (payload.review_note !== undefined) updates.review_note = payload.review_note
      break
    }
    case 'edit': {
      if (typeof payload.body === 'string') updates.body = payload.body
      if (payload.title !== undefined) updates.title = payload.title
      if (Array.isArray(payload.hashtags)) updates.hashtags = payload.hashtags
      if (payload.review_note !== undefined) updates.review_note = payload.review_note
      break
    }
    case 'reset': {
      // Send an item back to the review queue.
      updates.status = 'needs_review'
      updates.reviewer_id = null
      break
    }
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }

  const { data, error } = await service
    .from('marketing_content')
    .update(updates)
    .eq('id', params.id)
    .select(
      'id, channel, status, title, body, hashtags, safety_flags, scheduled_at, review_note',
    )
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Content not found.' }, { status: 404 })
  }

  return NextResponse.json({ item: data })
}
