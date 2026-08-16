import type { FunnelStage } from '@/lib/adminQueries'

const STAGE_COLORS = [
  'bg-indigo-500',
  'bg-sky-500',
  'bg-teal-500',
  'bg-amber-500',
  'bg-rose-500',
]

const STAGE_TEXT_COLORS = [
  'text-indigo-400',
  'text-sky-400',
  'text-teal-400',
  'text-amber-400',
  'text-rose-400',
]

export function ActivationFunnel({ stages }: { stages: FunnelStage[] }) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1)

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Activation Funnel
      </h2>
      <p className="mb-5 text-xs text-zinc-600">
        Where users drop off after signup
      </p>

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
              {/* Label row */}
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

              {/* Bar */}
              <div className="h-5 w-full overflow-hidden rounded-md bg-zinc-800/60">
                <div
                  className={`h-full rounded-md ${STAGE_COLORS[i]} transition-all duration-700`}
                  style={{
                    width: `${Math.max(barWidth, 2)}%`,
                    opacity: 0.8 + (i === 0 ? 0.2 : 0),
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 rounded-lg bg-zinc-800/30 px-3 py-2">
        <p className="text-[10px] leading-relaxed text-zinc-600">
          Signed Up → Profile Created → Onboarding Done → First Interest Sent →
          First Match Connected
        </p>
      </div>
    </div>
  )
}
