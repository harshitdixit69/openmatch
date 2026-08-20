import type { RecentVisitorEvent } from '@/lib/adminQueries'

const EVENT_LABELS: Record<string, string> = {
  app_opened: 'Opened app',
  auth_screen_viewed: 'Viewed sign-in',
  signup_started: 'Started signup',
  otp_sent: 'OTP sent',
  otp_verified: 'OTP verified',
  onboarding_step_viewed: 'Onboarding step',
  profile_completed: 'Completed profile',
}

const EVENT_DOT: Record<string, string> = {
  app_opened: 'bg-fuchsia-500',
  auth_screen_viewed: 'bg-indigo-500',
  signup_started: 'bg-sky-500',
  otp_sent: 'bg-cyan-500',
  otp_verified: 'bg-teal-500',
  onboarding_step_viewed: 'bg-amber-500',
  profile_completed: 'bg-emerald-500',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function RecentVisitors({ events }: { events: RecentVisitorEvent[] }) {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Recent Visitors
      </h2>
      <p className="mb-4 text-xs text-zinc-600">
        Live activity — anonymous devices &amp; signed-in users
      </p>

      {events.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-600">
          No activity yet. Events appear as people use the app.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800/60">
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  EVENT_DOT[e.eventName] ?? 'bg-zinc-500'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-zinc-200">
                    {e.username ?? (
                      <span className="text-zinc-500">
                        anon · {e.anonId.slice(0, 8)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                    {timeAgo(e.timestamp)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>{EVENT_LABELS[e.eventName] ?? e.eventName}</span>
                  {e.platform && (
                    <span className="text-[10px] text-zinc-600">· {e.platform}</span>
                  )}
                  {e.utmSource && (
                    <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      {e.utmSource}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
