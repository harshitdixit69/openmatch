import type { ActiveUserStats } from '@/lib/adminQueries'

export function ActiveUsersChart({ stats }: { stats: ActiveUserStats }) {
  const maxCount = Math.max(...stats.dailyHistory.map((d) => d.count), 1)

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Active Users
      </h2>
      <p className="mb-4 text-xs text-zinc-600">
        Based on last sign-in timestamp
      </p>

      {/* DAU / WAU summary */}
      <div className="mb-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-zinc-800/40 px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            DAU (24h)
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-indigo-400">
            {stats.dau}
          </p>
        </div>
        <div className="rounded-lg bg-zinc-800/40 px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            WAU (7d)
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-sky-400">
            {stats.wau}
          </p>
        </div>
      </div>

      {/* 14-day bar chart (pure CSS, no external deps) */}
      <div className="flex items-end gap-[3px]" style={{ height: 120 }}>
        {stats.dailyHistory.map((day) => {
          const barHeight =
            maxCount > 0 ? Math.max((day.count / maxCount) * 100, 3) : 3
          const isToday =
            day.date === new Date().toISOString().split('T')[0]

          return (
            <div
              key={day.date}
              className="group relative flex flex-1 flex-col items-center"
              style={{ height: '100%' }}
            >
              {/* Tooltip */}
              <div className="pointer-events-none absolute -top-8 z-10 hidden rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 shadow-lg group-hover:block">
                {day.date}: {day.count}
              </div>

              {/* Bar */}
              <div className="flex flex-1 items-end w-full">
                <div
                  className={`w-full rounded-t transition-all duration-300 ${
                    isToday
                      ? 'bg-indigo-500'
                      : 'bg-indigo-500/40 group-hover:bg-indigo-500/70'
                  }`}
                  style={{ height: `${barHeight}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* X-axis labels (first, middle, last) */}
      <div className="mt-1 flex justify-between text-[9px] tabular-nums text-zinc-600">
        {stats.dailyHistory.length > 0 && (
          <>
            <span>
              {new Date(stats.dailyHistory[0].date).toLocaleDateString(
                'en-IN',
                { day: '2-digit', month: 'short' }
              )}
            </span>
            <span>
              {new Date(
                stats.dailyHistory[Math.floor(stats.dailyHistory.length / 2)]
                  .date
              ).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
              })}
            </span>
            <span>Today</span>
          </>
        )}
      </div>
    </div>
  )
}
