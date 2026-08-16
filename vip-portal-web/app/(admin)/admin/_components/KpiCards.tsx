import type { KpiMetrics } from '@/lib/adminQueries'

export function KpiCards({ metrics }: { metrics: KpiMetrics }) {
  const cards = [
    {
      label: 'Total Real Users',
      value: metrics.totalReal,
      accent: 'indigo',
      sub: `${metrics.goalProgress}% of 100 goal`,
    },
    {
      label: 'New Today',
      value: metrics.newToday,
      accent: 'emerald',
      sub: 'Signups today',
    },
    {
      label: 'Last 7 Days',
      value: metrics.new7d,
      accent: 'sky',
      sub: 'Weekly signups',
    },
    {
      label: 'Last 30 Days',
      value: metrics.new30d,
      accent: 'amber',
      sub: 'Monthly signups',
    },
  ]

  const accentMap: Record<string, { ring: string; text: string; bar: string }> = {
    indigo: {
      ring: 'ring-indigo-500/20',
      text: 'text-indigo-400',
      bar: 'bg-indigo-500',
    },
    emerald: {
      ring: 'ring-emerald-500/20',
      text: 'text-emerald-400',
      bar: 'bg-emerald-500',
    },
    sky: {
      ring: 'ring-sky-500/20',
      text: 'text-sky-400',
      bar: 'bg-sky-500',
    },
    amber: {
      ring: 'ring-amber-500/20',
      text: 'text-amber-400',
      bar: 'bg-amber-500',
    },
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const a = accentMap[c.accent]
        return (
          <div
            key={c.label}
            className={`rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5 ring-1 ${a.ring}`}
          >
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              {c.label}
            </p>
            <p className={`mt-2 text-3xl font-bold tabular-nums ${a.text}`}>
              {c.value.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-zinc-600">{c.sub}</p>

            {/* Goal progress bar (only on total real users card) */}
            {c.label === 'Total Real Users' && (
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full ${a.bar} transition-all duration-700`}
                  style={{ width: `${metrics.goalProgress}%` }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
