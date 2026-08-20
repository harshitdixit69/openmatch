import type { VisitorFunnel as VisitorFunnelData } from '@/lib/adminQueries'

const STAGE_COLORS = [
  'bg-fuchsia-500',
  'bg-indigo-500',
  'bg-sky-500',
  'bg-teal-500',
  'bg-emerald-500',
]

const STAGE_TEXT_COLORS = [
  'text-fuchsia-400',
  'text-indigo-400',
  'text-sky-400',
  'text-teal-400',
  'text-emerald-400',
]

export function VisitorFunnel({ data }: { data: VisitorFunnelData }) {
  const { stages, windowDays } = data
  const maxCount = Math.max(...stages.map((s) => s.count), 1)

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Visitor Funnel
      </h2>
      <p className="mb-5 text-xs text-zinc-600">
        Anonymous — includes people who never signed up · last {windowDays} days
      </p>

      {data.totalOpens === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-600">
          No visits recorded yet. Data appears once someone opens the app.
        </p>
      ) : (
        <div className="space-y-3">
          {stages.map((stage, i) => {
            const barWidth = maxCount > 0 ? (stage.count / maxCount) * 100 : 0
            const dropOff =
              i > 0 && stages[i - 1].count > 0
                ? Math.round(
                    ((stages[i - 1].count - stage.count) / stages[i - 1].count) *
                      100
                  )
                : null

            return (
              <div key={stage.label}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-xs font-medium text-zinc-300">
                    {stage.label}
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-sm font-bold tabular-nums ${STAGE_TEXT_COLORS[i]}`}
                    >
                      {stage.count.toLocaleString()}
                    </span>
                    <span className="text-[10px] tabular-nums text-zinc-600">
                      {stage.percent}%
                    </span>
                    {dropOff !== null && dropOff > 0 && (
                      <span className="text-[10px] font-medium tabular-nums text-rose-500">
                        −{dropOff}%
                      </span>
                    )}
                  </div>
                </div>

                <div className="h-5 w-full overflow-hidden rounded-md bg-zinc-800/60">
                  <div
                    className={`h-full rounded-md ${STAGE_COLORS[i]} transition-all duration-700`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
