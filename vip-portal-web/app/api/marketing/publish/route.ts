import { NextResponse } from 'next/server'
import { requireAdmin, getServiceClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

type ContentRow = {
  id: string
  channel: string
  title: string | null
  body: string
  hashtags: string[]
  scheduled_at: string | null
}

/**
 * POST /api/marketing/publish
 * Publishes APPROVED + due content via the configured aggregator. Admin-only.
 * Self-contained (mirrors the edge function) so the review UI can trigger a
 * publish run directly. Safe no-op that skips (leaves items 'approved') when
 * MARKETING_AGGREGATOR_URL/KEY are not set.
 */
export async function POST() {
  const gate = await requireAdmin()
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  const aggregatorUrl = process.env.MARKETING_AGGREGATOR_URL ?? ''
  const aggregatorKey = process.env.MARKETING_AGGREGATOR_KEY ?? ''

  const service = getServiceClient()
  const nowIso = new Date().toISOString()

  const { data, error } = await service
    .from('marketing_content')
    .select('id, channel, title, body, hashtags, scheduled_at')
    .eq('status', 'approved')
    .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
    .order('scheduled_at', { ascending: true, nullsFirst: true })
    .limit(25)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const due = (data ?? []) as ContentRow[]

  if (!aggregatorUrl || !aggregatorKey) {
    return NextResponse.json({
      candidates: due.length,
      published: 0,
      skipped: due.length,
      failed: 0,
      note: 'Aggregator not configured. Set MARKETING_AGGREGATOR_URL/KEY to publish.',
    })
  }

  let published = 0
  let failed = 0

  for (const content of due) {
    try {
      const text = content.hashtags.length
        ? `${content.body}\n\n${content.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}`
        : content.body

      const res = await fetch(`${aggregatorUrl.replace(/\/+$/, '')}/posts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${aggregatorKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channels: [content.channel], content: text }),
      })

      const raw = await res.text()
      if (!res.ok) {
        throw new Error(`Aggregator error ${res.status}: ${raw.slice(0, 200)}`)
      }

      let ref: Record<string, unknown>
      try {
        ref = { provider: 'aggregator', response: JSON.parse(raw) }
      } catch {
        ref = { provider: 'aggregator', response: raw }
      }

      await service
        .from('marketing_content')
        .update({ status: 'published', published_at: new Date().toISOString(), external_ref: ref })
        .eq('id', content.id)
      published += 1
    } catch (err) {
      failed += 1
      await service
        .from('marketing_content')
        .update({
          status: 'failed',
          external_ref: { error: err instanceof Error ? err.message : 'publish failed' },
        })
        .eq('id', content.id)
    }
  }

  return NextResponse.json({ candidates: due.length, published, skipped: 0, failed })
}
