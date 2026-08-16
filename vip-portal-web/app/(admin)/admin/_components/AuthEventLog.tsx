import type { AuthEvent } from '@/lib/adminQueries'

const EVENT_CONFIG: Record<
  string,
  { label: string; dot: string; text: string }
> = {
  signup: {
    label: 'Signed up',
    dot: 'bg-emerald-500',
    text: 'text-emerald-400',
  },
  email_confirmed: {
    label: 'Email confirmed',
    dot: 'bg-sky-500',
    text: 'text-sky-400',
  },
  login: {
    label: 'Logged in',
    dot: 'bg-indigo-500',
    text: 'text-indigo-400',
  },
}

export function AuthEventLog({ events }: { events: AuthEvent[] }) {
  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHrs = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHrs < 24) return `${diffHrs}h ago`
    if (diffDays < 7) return `${diffDays}d ago`

    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
    })
  }

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Auth Events
      </h2>
      <p className="mb-4 text-xs text-zinc-600">
        Recent signup, confirmation &amp; login activity
      </p>

      <div className="max-h-[420px] overflow-y-auto pr-1">
        <div className="relative space-y-0">
          {events.length === 0 && (
            <p className="py-8 text-center text-xs text-zinc-600">
              No events yet
            </p>
          )}

          {events.map((ev, i) => {
            const cfg = EVENT_CONFIG[ev.event] || {
              label: ev.event,
              dot: 'bg-zinc-500',
              text: 'text-zinc-400',
            }
            return (
              <div key={ev.id} className="flex items-start gap-3 py-2">
                {/* Timeline line + dot */}
                <div className="relative flex flex-col items-center">
                  <div
                    className={`h-2 w-2 rounded-full ${cfg.dot} ring-2 ring-zinc-900 mt-1.5`}
                  />
                  {i < events.length - 1 && (
                    <div className="w-px flex-1 bg-zinc-800/60" />
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1 pb-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-xs font-medium ${cfg.text}`}>
                      {cfg.label}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                      {formatTime(ev.timestamp)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {ev.email || 'Phone user'}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
