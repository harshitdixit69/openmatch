import { createAdminClient } from './supabaseAdmin'
import { isMock } from './isMock'

// ─── Types ──────────────────────────────────────────────────────────

export interface RealUser {
  id: string
  email: string | null
  phone: string | null
  created_at: string
  last_sign_in_at: string | null
  email_confirmed_at: string | null
  // joined from profiles
  full_name: string | null
  onboarding_completed_at: string | null
}

export interface KpiMetrics {
  totalReal: number
  newToday: number
  new7d: number
  new30d: number
  goalProgress: number // 0–100
}

export interface FunnelStage {
  label: string
  count: number
  percent: number
}

export interface AuthEvent {
  id: string
  email: string | null
  event: string
  timestamp: string
}

export interface DailyActivePoint {
  date: string // YYYY-MM-DD
  count: number
}

export interface ActiveUserStats {
  dau: number
  wau: number
  dailyHistory: DailyActivePoint[]
}

// ─── Helpers ────────────────────────────────────────────────────────

const USER_GOAL = 100

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return startOfDay(d)
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

// ─── Core: Fetch all real users ─────────────────────────────────────

/** Paginate through auth.admin.listUsers and filter out mocks */
async function fetchAllRealAuthUsers() {
  const admin = createAdminClient()
  const allUsers: any[] = []
  let page = 1

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (error) throw error
    if (!data.users || data.users.length === 0) break
    allUsers.push(...data.users)
    if (data.users.length < 1000) break
    page++
  }

  return allUsers.filter((u) => !isMock(u.email))
}

/** Fetch profiles for a set of user IDs */
async function fetchProfiles(userIds: string[]) {
  if (userIds.length === 0) return []
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, onboarding_completed_at, created_at')
    .in('id', userIds)
  if (error) throw error
  return data || []
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Get all real users with profile data joined.
 * Used by: KPI cards, signup feed, activation funnel, DAU/WAU
 */
export async function getRealUsers(): Promise<RealUser[]> {
  const authUsers = await fetchAllRealAuthUsers()
  const ids = authUsers.map((u) => u.id)
  const profiles = await fetchProfiles(ids)
  const profileMap = new Map(profiles.map((p) => [p.id, p]))

  return authUsers.map((u) => {
    const profile = profileMap.get(u.id)
    return {
      id: u.id,
      email: u.email || null,
      phone: u.phone || null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at || null,
      email_confirmed_at: u.email_confirmed_at || null,
      full_name: profile?.full_name || null,
      onboarding_completed_at: profile?.onboarding_completed_at || null,
    }
  })
}

/**
 * KPI metrics: total real users + signup velocity + progress to goal.
 */
export async function getKpiMetrics(
  realUsers: RealUser[]
): Promise<KpiMetrics> {
  const now = new Date()
  const todayStart = startOfDay(now)
  const d7 = daysAgo(7)
  const d30 = daysAgo(30)

  const totalReal = realUsers.length
  const newToday = realUsers.filter(
    (u) => new Date(u.created_at) >= todayStart
  ).length
  const new7d = realUsers.filter((u) => new Date(u.created_at) >= d7).length
  const new30d = realUsers.filter((u) => new Date(u.created_at) >= d30).length
  const goalProgress = Math.min(100, Math.round((totalReal / USER_GOAL) * 100))

  return { totalReal, newToday, new7d, new30d, goalProgress }
}

/**
 * Activation funnel: signed up → profile → onboarding → first interest → first match
 */
export async function getActivationFunnel(
  realUsers: RealUser[]
): Promise<FunnelStage[]> {
  const admin = createAdminClient()
  const total = realUsers.length
  if (total === 0) {
    return [
      { label: 'Signed Up', count: 0, percent: 0 },
      { label: 'Profile Created', count: 0, percent: 0 },
      { label: 'Onboarding Done', count: 0, percent: 0 },
      { label: 'First Interest', count: 0, percent: 0 },
      { label: 'First Match', count: 0, percent: 0 },
    ]
  }

  const realIds = realUsers.map((u) => u.id)

  // Stage 2: profile exists (onboarding_completed_at can be null but profile row exists)
  const profileCreated = realUsers.filter(
    (u) => u.full_name !== null
  ).length

  // Stage 3: onboarding complete
  const onboardingDone = realUsers.filter(
    (u) => u.onboarding_completed_at !== null
  ).length

  // Stage 4: sent at least one interest
  const { data: senders } = await admin
    .from('interest_requests')
    .select('sender_id')
    .in('sender_id', realIds)
  const uniqueSenders = new Set((senders || []).map((r: any) => r.sender_id))
  const firstInterest = uniqueSenders.size

  // Stage 5: has at least one connected match
  const { data: matches1 } = await admin
    .from('matches')
    .select('user_1_id')
    .eq('status', 'connected')
    .in('user_1_id', realIds)
  const { data: matches2 } = await admin
    .from('matches')
    .select('user_2_id')
    .eq('status', 'connected')
    .in('user_2_id', realIds)
  const matchedUsers = new Set([
    ...(matches1 || []).map((r: any) => r.user_1_id),
    ...(matches2 || []).map((r: any) => r.user_2_id),
  ])
  const firstMatch = matchedUsers.size

  const pct = (n: number) => Math.round((n / total) * 100)

  return [
    { label: 'Signed Up', count: total, percent: 100 },
    { label: 'Profile Created', count: profileCreated, percent: pct(profileCreated) },
    { label: 'Onboarding Done', count: onboardingDone, percent: pct(onboardingDone) },
    { label: 'First Interest', count: firstInterest, percent: pct(firstInterest) },
    { label: 'First Match', count: firstMatch, percent: pct(firstMatch) },
  ]
}

/**
 * Auth events derived from user metadata.
 * We derive signup / confirmation / last-login events from user objects
 * since auth.audit_log_entries isn't exposed via PostgREST by default.
 */
export async function getAuthEvents(
  realUsers: RealUser[],
  limit: number = 50
): Promise<AuthEvent[]> {
  const events: AuthEvent[] = []

  for (const u of realUsers) {
    events.push({
      id: `${u.id}-signup`,
      email: u.email,
      event: 'signup',
      timestamp: u.created_at,
    })

    if (u.email_confirmed_at) {
      events.push({
        id: `${u.id}-confirmed`,
        email: u.email,
        event: 'email_confirmed',
        timestamp: u.email_confirmed_at,
      })
    }

    if (u.last_sign_in_at && u.last_sign_in_at !== u.created_at) {
      events.push({
        id: `${u.id}-login`,
        email: u.email,
        event: 'login',
        timestamp: u.last_sign_in_at,
      })
    }
  }

  // Sort newest first, take limit
  events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
  return events.slice(0, limit)
}

/**
 * DAU / WAU + daily history for sparkline chart (last 14 days).
 */
export async function getActiveUserStats(
  realUsers: RealUser[]
): Promise<ActiveUserStats> {
  const now = new Date()
  const todayStart = startOfDay(now)
  const d1 = daysAgo(1)
  const d7 = daysAgo(7)

  const dau = realUsers.filter(
    (u) => u.last_sign_in_at && new Date(u.last_sign_in_at) >= d1
  ).length

  const wau = realUsers.filter(
    (u) => u.last_sign_in_at && new Date(u.last_sign_in_at) >= d7
  ).length

  // Build 14-day daily histogram
  const dailyHistory: DailyActivePoint[] = []
  for (let i = 13; i >= 0; i--) {
    const dayStart = daysAgo(i)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const count = realUsers.filter((u) => {
      if (!u.last_sign_in_at) return false
      const t = new Date(u.last_sign_in_at)
      return t >= dayStart && t < dayEnd
    }).length

    dailyHistory.push({ date: formatDate(dayStart), count })
  }

  return { dau, wau, dailyHistory }
}

// ─── Visitor Funnel (anonymous top-of-funnel from app_events) ────────

export interface VisitorFunnel {
  stages: FunnelStage[]
  totalOpens: number
  windowDays: number
}

/**
 * Anonymous top-of-funnel: how many devices opened the app and how far they
 * progressed toward completing a profile. Reads the `app_events` firehose using
 * the service-role key (only readable server-side).
 */
export async function getVisitorFunnel(windowDays = 7): Promise<VisitorFunnel> {
  const supabase = createAdminClient()
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('app_events')
    .select('anon_id, event_name')
    .gte('created_at', since)

  const emptyStages: FunnelStage[] = [
    { label: 'App opened', count: 0, percent: 0 },
    { label: 'Auth screen viewed', count: 0, percent: 0 },
    { label: 'Signup started', count: 0, percent: 0 },
    { label: 'OTP verified', count: 0, percent: 0 },
    { label: 'Profile completed', count: 0, percent: 0 },
  ]

  if (error || !data) {
    return { stages: emptyStages, totalOpens: 0, windowDays }
  }

  // Count UNIQUE devices per event stage.
  const stageEvents: Array<{ label: string; event: string }> = [
    { label: 'App opened', event: 'app_opened' },
    { label: 'Auth screen viewed', event: 'auth_screen_viewed' },
    { label: 'Signup started', event: 'signup_started' },
    { label: 'OTP verified', event: 'otp_verified' },
    { label: 'Profile completed', event: 'profile_completed' },
  ]

  const uniqueByEvent = new Map<string, Set<string>>()
  for (const row of data as Array<{ anon_id: string; event_name: string }>) {
    if (!uniqueByEvent.has(row.event_name)) {
      uniqueByEvent.set(row.event_name, new Set())
    }
    uniqueByEvent.get(row.event_name)!.add(row.anon_id)
  }

  const totalOpens = uniqueByEvent.get('app_opened')?.size ?? 0
  const denominator = Math.max(totalOpens, 1)

  const stages: FunnelStage[] = stageEvents.map(({ label, event }) => {
    const count = uniqueByEvent.get(event)?.size ?? 0
    return { label, count, percent: Math.round((count / denominator) * 100) }
  })

  return { stages, totalOpens, windowDays }
}

// ─── Recent Visitors (latest app_events) ─────────────────────────────

export interface RecentVisitorEvent {
  id: string
  eventName: string
  username: string | null
  anonId: string
  platform: string | null
  utmSource: string | null
  timestamp: string
}

/**
 * Latest raw app_events for a live activity feed (readable via service role).
 */
export async function getRecentVisitors(limit = 30): Promise<RecentVisitorEvent[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('app_events')
    .select('id, event_name, username, anon_id, platform, utm_source, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) return []

  return (data as Array<Record<string, any>>).map((row) => ({
    id: row.id,
    eventName: row.event_name,
    username: row.username ?? null,
    anonId: row.anon_id,
    platform: row.platform ?? null,
    utmSource: row.utm_source ?? null,
    timestamp: row.created_at,
  }))
}