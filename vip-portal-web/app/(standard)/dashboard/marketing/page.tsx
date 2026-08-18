'use client'

import React, { useCallback, useEffect, useState } from 'react'

type Content = {
  id: string
  channel: string
  format: string
  status: string
  title: string | null
  body: string
  hashtags: string[]
  image_prompt: string | null
  safety_flags: string[]
  scheduled_at: string | null
  published_at: string | null
  review_note: string | null
  created_at: string
}

const STATUS_TABS = [
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'approved', label: 'Approved' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'published', label: 'Published' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'failed', label: 'Failed' },
  { key: 'all', label: 'All' },
] as const

export default function MarketingReviewPage() {
  const [status, setStatus] = useState<string>('needs_review')
  const [items, setItems] = useState<Content[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/marketing/content?status=${status}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load content.')
      setItems(json.items as Content[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  const mutate = useCallback(
    async (id: string, action: string, extra: Record<string, unknown> = {}) => {
      setBusyId(id)
      try {
        const res = await fetch(`/api/marketing/content/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...extra }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Update failed.')
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Update failed.')
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const publishNow = useCallback(async () => {
    setPublishing(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/marketing/publish', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Publish failed.')
      const parts = [
        `${json.published} published`,
        `${json.skipped} skipped`,
        `${json.failed} failed`,
      ]
      setNotice(json.note ? `${json.note}` : `Publish run complete — ${parts.join(', ')}.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed.')
    } finally {
      setPublishing(false)
    }
  }, [load])

  return (
    <div className="min-h-screen bg-[#070708] text-zinc-100 p-6 sm:p-10 font-sans">
      <div className="max-w-5xl mx-auto flex flex-col gap-8">
        <header className="border-b border-zinc-900 pb-6">
          <h1 className="text-xl font-semibold tracking-wider">Marketing Review Queue</h1>
          <p className="text-xs text-zinc-500 uppercase tracking-widest font-mono mt-1">
            Approve · reject · edit before anything publishes
          </p>
        </header>

        {/* Status tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatus(tab.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-mono tracking-wider transition-colors ${
                status === tab.key
                  ? 'bg-[#E6C687] text-black'
                  : 'bg-[#111115] text-zinc-400 border border-zinc-800 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={publishNow}
            disabled={publishing}
            title="Publish all approved + due content via the aggregator"
            className="px-4 py-1.5 rounded-full text-xs font-semibold tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          >
            {publishing ? 'Publishing…' : 'Publish now'}
          </button>
        </div>

        {notice && (
          <div className="bg-emerald-950/40 border border-emerald-900 text-emerald-300 text-sm rounded-xl px-4 py-3">
            {notice}
          </div>
        )}

        {error && (
          <div className="bg-red-950/40 border border-red-900 text-red-300 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-zinc-500 text-sm font-mono">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-zinc-500 text-sm font-mono">Nothing here.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {items.map((item) => (
              <ContentCard
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onApprove={(scheduledAt) => mutate(item.id, 'approve', { scheduled_at: scheduledAt })}
                onReject={(note) => mutate(item.id, 'reject', { review_note: note })}
                onEdit={(fields) => mutate(item.id, 'edit', fields)}
                onReset={() => mutate(item.id, 'reset')}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ContentCard({
  item,
  busy,
  onApprove,
  onReject,
  onEdit,
  onReset,
}: {
  item: Content
  busy: boolean
  onApprove: (scheduledAt: string | null) => void
  onReject: (note: string | null) => void
  onEdit: (fields: { title: string | null; body: string; hashtags: string[] }) => void
  onReset: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.title ?? '')
  const [body, setBody] = useState(item.body)
  const [hashtags, setHashtags] = useState(item.hashtags.join(', '))
  const [schedule, setSchedule] = useState('')

  const hasFlags = item.safety_flags?.length > 0

  return (
    <article
      className={`bg-[#0c0c0e] border rounded-2xl p-5 flex flex-col gap-4 ${
        hasFlags ? 'border-amber-800/60' : 'border-zinc-900'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest">
          <span className="bg-[#111115] border border-zinc-800 px-2 py-0.5 rounded-full text-zinc-300">
            {item.channel}
          </span>
          <span className="text-zinc-600">{item.format}</span>
          <span className="text-zinc-600">· {item.status}</span>
        </div>
        {hasFlags && (
          <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400">
            ⚠ {item.safety_flags.join(', ')}
          </span>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="bg-[#070708] border border-zinc-800 rounded-lg px-3 py-2 text-sm"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className="bg-[#070708] border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono"
          />
          <input
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="comma, separated, hashtags"
            className="bg-[#070708] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono"
          />
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => {
                onEdit({
                  title: title.trim() ? title.trim() : null,
                  body,
                  hashtags: hashtags
                    .split(',')
                    .map((h) => h.trim().replace(/^#/, ''))
                    .filter(Boolean),
                })
                setEditing(false)
              }}
              className="bg-[#E6C687] hover:bg-[#d4b373] text-black text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-zinc-400 hover:text-zinc-200 px-4 py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {item.title && <h3 className="text-sm font-medium text-zinc-100">{item.title}</h3>}
          <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{item.body}</p>
          {item.hashtags.length > 0 && (
            <p className="text-xs text-[#7fa7ff] font-mono">
              {item.hashtags.map((h) => `#${h}`).join(' ')}
            </p>
          )}
          {item.scheduled_at && (
            <p className="text-[10px] text-zinc-500 font-mono">
              Scheduled: {new Date(item.scheduled_at).toLocaleString()}
            </p>
          )}
          {item.review_note && (
            <p className="text-[10px] text-zinc-500 font-mono italic">Note: {item.review_note}</p>
          )}
        </div>
      )}

      {!editing && (
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-900 pt-4">
          {(item.status === 'needs_review' || item.status === 'rejected') && (
            <>
              <input
                type="datetime-local"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                className="bg-[#070708] border border-zinc-800 rounded-lg px-2 py-1.5 text-xs font-mono text-zinc-300"
                title="Optional: schedule publish time (leave empty to publish ASAP once approved)"
              />
              <button
                disabled={busy}
                onClick={() => onApprove(schedule ? new Date(schedule).toISOString() : null)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
              >
                Approve
              </button>
            </>
          )}
          {item.status !== 'rejected' && item.status !== 'published' && (
            <button
              disabled={busy}
              onClick={() => onReject(null)}
              className="bg-red-900/60 hover:bg-red-800 text-red-200 text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            >
              Reject
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => setEditing(true)}
            className="bg-[#111115] border border-zinc-800 hover:text-zinc-100 text-zinc-400 text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
          >
            Edit
          </button>
          {(item.status === 'approved' || item.status === 'failed') && (
            <button
              disabled={busy}
              onClick={onReset}
              className="text-zinc-500 hover:text-zinc-300 text-xs px-3 py-2"
            >
              ↩ Back to review
            </button>
          )}
        </div>
      )}
    </article>
  )
}
