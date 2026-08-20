import {
  getRealUsers,
  getKpiMetrics,
  getActivationFunnel,
  getAuthEvents,
  getActiveUserStats,
  getVisitorFunnel,
  getRecentVisitors,
} from '@/lib/adminQueries'

import { KpiCards } from './_components/KpiCards'
import { SignupFeed } from './_components/SignupFeed'
import { ActivationFunnel } from './_components/ActivationFunnel'
import { AuthEventLog } from './_components/AuthEventLog'
import { ActiveUsersChart } from './_components/ActiveUsersChart'
import { VisitorFunnel } from './_components/VisitorFunnel'
import { RecentVisitors } from './_components/RecentVisitors'

/**
 * Admin Dashboard — Server Component
 *
 * Fetches all data server-side using the service-role key.
 * The key is never sent to the browser.
 */
export const dynamic = 'force-dynamic' // always fresh data, no caching

export default async function AdminDashboardPage() {
  // Single fetch: get all real users, then derive every metric from the same dataset
  const realUsers = await getRealUsers()
  const [kpi, funnel, authEvents, activeStats, visitorFunnel, recentVisitors] = await Promise.all([
    getKpiMetrics(realUsers),
    getActivationFunnel(realUsers),
    getAuthEvents(realUsers, 50),
    getActiveUserStats(realUsers),
    getVisitorFunnel(7),
    getRecentVisitors(30),
  ])

  return (
    <div className="space-y-8">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Monitoring Dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Beta launch metrics · Real users only (mock/test accounts filtered)
        </p>
      </div>

      {/* ── Row 1: KPI Cards ───────────────────────────────────── */}
      <KpiCards metrics={kpi} />

      {/* ── Row 2: Visitor Funnel (anonymous) + Activation Funnel ─ */}
      <div className="grid gap-6 lg:grid-cols-2">
        <VisitorFunnel data={visitorFunnel} />
        <ActivationFunnel stages={funnel} />
      </div>

      {/* ── Row 3: DAU/WAU + Recent Visitors ───────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ActiveUsersChart stats={activeStats} />
        <RecentVisitors events={recentVisitors} />
      </div>

      {/* ── Row 4: Signup Feed + Auth Events ───────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SignupFeed users={realUsers} />
        <AuthEventLog events={authEvents} />
      </div>
    </div>
  )
}
