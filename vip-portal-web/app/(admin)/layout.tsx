import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'OpenMatch Admin',
  description: 'Internal admin monitoring dashboard',
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#070708] text-zinc-100">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-zinc-800/60 bg-[#070708]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold">
              OM
            </div>
            <span className="text-sm font-semibold tracking-wide text-zinc-200">
              OpenMatch <span className="text-indigo-400">Admin</span>
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20">
              Beta
            </span>
            <span className="text-xs text-zinc-500">
              {new Date().toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          </div>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────── */}
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  )
}
