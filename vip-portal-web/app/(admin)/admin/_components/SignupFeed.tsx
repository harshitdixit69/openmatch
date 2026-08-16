import type { RealUser } from '@/lib/adminQueries'

export function SignupFeed({ users }: { users: RealUser[] }) {
  // Sort by signup date, newest first
  const sorted = [...users].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  }

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Signup Feed
      </h2>
      <p className="mb-4 text-xs text-zinc-600">
        {sorted.length} real users (mock accounts hidden)
      </p>

      <div className="max-h-[420px] overflow-y-auto pr-1">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-zinc-900/95 text-zinc-500">
            <tr>
              <th className="pb-2 pr-3 font-medium">Name</th>
              <th className="pb-2 pr-3 font-medium">Email / Phone</th>
              <th className="pb-2 pr-3 font-medium">Signed Up</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-zinc-600">
                  No real signups yet
                </td>
              </tr>
            )}
            {sorted.map((u) => (
              <tr
                key={u.id}
                className="transition-colors hover:bg-zinc-800/30"
              >
                <td className="py-2.5 pr-3 font-medium text-zinc-200">
                  {u.full_name || (
                    <span className="italic text-zinc-600">No profile</span>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-zinc-400">
                  {u.email || u.phone || '—'}
                </td>
                <td className="py-2.5 pr-3 tabular-nums text-zinc-500">
                  {formatTime(u.created_at)}
                </td>
                <td className="py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {/* Email confirmation badge */}
                    {u.email_confirmed_at ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-emerald-500/20">
                        Confirmed
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 ring-1 ring-amber-500/20">
                        Unconfirmed
                      </span>
                    )}

                    {/* Onboarding badge */}
                    {u.onboarding_completed_at ? (
                      <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-400 ring-1 ring-indigo-500/20">
                        Onboarded
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-700/30 px-2 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-zinc-700/30">
                        Not onboarded
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
