'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'

type SourcingStatus = 'sourcing' | 'target_selection' | 'call_active' | 'handshake'

interface CuratedCandidate {
  id: string
  initials: string
  location: string
  compatibility: number
  status: string
  statusColor?: string
}

export default function VipDashboardPage() {
  const [sessionUser, setSessionUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [currentStatus, setCurrentStatus] = useState<SourcingStatus>('sourcing')
  const [candidates, setCandidates] = useState<CuratedCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch session, profile and telemetry on mount
  async function loadData() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('No active session. Please log in.')
        setLoading(false)
        return
      }
      setSessionUser(session.user)

      // Fetch profile with full name and credits
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, user_tier, unlock_credits_remaining')
        .eq('id', session.user.id)
        .single()
      setProfile(prof)

      // Fetch bot session status
      const { data: botSession } = await supabase
        .from('vip_bot_sessions')
        .select('status')
        .eq('vip_id', session.user.id)
        .maybeSingle()
      if (botSession) {
        setCurrentStatus(botSession.status as SourcingStatus)
      }

      // Fetch dynamic VIP matchmaking queue matching mobile logic
      const viewerProfileId = session.user.id

      // 1. Fetch active matches (pending or connected)
      const { data: matches } = await supabase
        .from('matches')
        .select('*')
        .or(`user_1_id.eq.${viewerProfileId},user_2_id.eq.${viewerProfileId}`)
        .in('status', ['pending', 'connected'])

      const activeCandidateIds = matches 
        ? matches.map((m: any) => m.user_1_id === viewerProfileId ? m.user_2_id : m.user_1_id) 
        : []

      let activeProfiles: any[] = []
      if (activeCandidateIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('*')
          .in('id', activeCandidateIds)
        if (profs) activeProfiles = profs
      }

      // Fetch interest requests
      const { data: reqs } = await supabase
        .from('interest_requests')
        .select('*')
        .or(`sender_id.eq.${viewerProfileId},receiver_id.eq.${viewerProfileId}`)

      const activeCandidatesMapped: CuratedCandidate[] = activeProfiles.map((p: any) => {
        const req = reqs?.find((r: any) => 
          (r.sender_id === viewerProfileId && r.receiver_id === p.id) ||
          (r.sender_id === p.id && r.receiver_id === viewerProfileId)
        )
        
        const matchRow = matches?.find((m: any) => 
          (m.user_1_id === viewerProfileId && m.user_2_id === p.id) ||
          (m.user_1_id === p.id && m.user_2_id === viewerProfileId)
        )

        let statusText = 'Reviewing Profile'
        let statusColor = 'text-zinc-500'
        if (req) {
          if (req.status === 'accepted') {
            statusText = 'Connection Active'
            statusColor = 'text-emerald-400'
          } else if (req.status === 'sent') {
            if (req.sender_id === viewerProfileId) {
              statusText = 'Awaiting Handshake'
              statusColor = 'text-[#E6C687]'
            } else {
              statusText = 'Request Received'
              statusColor = 'text-emerald-400'
            }
          }
        } else if (matchRow && matchRow.status === 'connected') {
          statusText = 'Connection Active'
          statusColor = 'text-emerald-400'
        } else {
          statusText = 'Awaiting Handshake'
          statusColor = 'text-[#E6C687]'
        }

        const nameParts = p.full_name ? p.full_name.split(' ') : ['Candidate']
        const maskedName = nameParts[0] + (nameParts[1] ? ` ${nameParts[1].charAt(0)}.` : '')

        return {
          id: p.id,
          initials: maskedName,
          location: p.location || 'Unknown location',
          compatibility: 90,
          status: statusText,
          statusColor: statusColor,
        }
      })

      // 2. Fetch fresh recommended matches
      const { data: recData } = await supabase.rpc('match_profiles', {
        result_limit: 5,
        p_viewer_id: viewerProfileId
      })

      const recMapped: CuratedCandidate[] = []
      if (recData && Array.isArray(recData)) {
        recData.forEach((c: any) => {
          if (activeCandidateIds.includes(c.id)) return

          const nameParts = c.full_name ? c.full_name.split(' ') : ['Candidate']
          const maskedName = nameParts[0] + (nameParts[1] ? ` ${nameParts[1].charAt(0)}.` : '')

          recMapped.push({
            id: c.id,
            initials: maskedName,
            location: c.location || 'Unknown location',
            compatibility: Math.round((c.similarity || 0.85) * 100),
            status: 'Ready to Pitch',
            statusColor: 'text-[#E6C687]',
          })
        })
      }

      let combined = [...activeCandidatesMapped]
      for (const rec of recMapped) {
        if (combined.length >= 3) break
        if (!combined.some(x => x.id === rec.id)) {
          combined.push(rec)
        }
      }
      setCandidates(combined)

    } catch (err: any) {
      console.error('Error loading data:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // Poll every 4 seconds to sync status transitions
    const interval = setInterval(loadData, 4000)
    return () => clearInterval(interval)
  }, [])

  // Trigger outbound AI pitch
  const triggerOutreach = async (candidateId: string) => {
    if (!sessionUser || actionLoading) return
    setActionLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Session expired. Please log in again.')
        setActionLoading(false)
        return
      }

      const res = await fetch('/api/vip/trigger-pitch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ candidateId })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to trigger outreach')
      }

      setCurrentStatus('call_active')
      await loadData()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  // Handle Decline/Swap candidate
  const handleDeclineCandidate = async (candidateId: string) => {
    if (!sessionUser || actioningId) return
    setActioningId(candidateId)
    setError(null)
    try {
      const viewerId = sessionUser.id
      const [user1, user2] = viewerId < candidateId ? [viewerId, candidateId] : [candidateId, viewerId]

      const { error: passErr } = await supabase
        .from('matches')
        .upsert({
          user_1_id: user1,
          user_2_id: user2,
          status: 'rejected',
          passed_at: new Date().toISOString()
        }, { onConflict: 'user_1_id,user_2_id' })

      if (passErr) throw passErr
      await loadData()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActioningId(null)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  if (loading && candidates.length === 0) {
    return (
      <div className="min-h-screen bg-black text-[#E6C687] flex flex-col items-center justify-center font-mono">
        <div className="w-8 h-8 border border-[#E6C687] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-xs uppercase tracking-widest opacity-60">Initializing Autonomous Engine...</p>
      </div>
    )
  }

  const firstName = profile?.full_name?.split(' ')[0] || 'Member'
  const activeFocus = candidates[0]
  const upcomingQueue = candidates.slice(1)

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col justify-between p-6 sm:p-12 font-sans relative">
      
      {/* Golden radial background overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#0d0a07] via-black to-black pointer-events-none opacity-90 z-0" />

      <div className="max-w-5xl w-full mx-auto flex flex-col gap-12 z-10">
        
        {/* Header */}
        <header className="flex justify-between items-start">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-[#E6C687] tracking-[0.2em] uppercase block font-mono">
              Autonomous Sourcing Engine
            </span>
            <h1 className="text-3xl text-zinc-100 font-serif font-semibold">
              Welcome, {firstName.toLowerCase()}.
            </h1>
          </div>
          
          <div className="flex items-center gap-2 bg-[#0a0a0c] border border-[#272118] px-3.5 py-1.5 rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-[#E6C687] animate-pulse" />
            <span className="text-[9px] text-[#E6C687] font-bold uppercase tracking-wider font-mono">
              Isolated Mode Active
            </span>
          </div>
        </header>

        {error && (
          <div className="bg-red-950/40 border border-red-900/60 p-4 rounded-xl text-xs text-red-400 font-mono">
            {error}
          </div>
        )}

        {/* Theater Columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 items-start">
          
          {/* Left/Center Column: Live Outreach Focus */}
          <div className="md:col-span-2 space-y-4">
            <h2 className="text-[10px] font-extrabold text-zinc-500 tracking-[0.2em] uppercase font-mono">
              Live Outreach Focus
            </h2>

            {activeFocus ? (
              <div className="bg-[#09090b] border border-zinc-900 rounded-3xl p-8 flex flex-col items-center gap-6 shadow-2xl">
                
                {/* Silhouette circle */}
                <div className="w-24 h-24 rounded-full bg-[#11100e] border border-[#E6C687]/30 flex items-center justify-center shadow-lg">
                  <span className="text-2xl text-[#E6C687] font-serif opacity-75">
                    {activeFocus.initials.charAt(0).toUpperCase()}
                  </span>
                </div>

                <div className="text-center space-y-1">
                  <h3 className="text-2xl text-zinc-100 font-serif font-medium">
                    {activeFocus.initials}
                  </h3>
                  <p className="text-xs text-zinc-500">
                    {activeFocus.location}
                  </p>
                </div>

                {/* Status Telemetry */}
                <div className="w-full flex justify-between items-center bg-[#030303] border border-zinc-900 px-5 py-3 rounded-2xl">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${activeFocus.status === 'Awaiting Handshake' ? 'bg-[#10b981]' : 'bg-[#E6C687]'} animate-pulse`} />
                    <span className={`text-[10px] font-bold uppercase tracking-wider font-mono ${activeFocus.status === 'Awaiting Handshake' ? 'text-[#10b981]' : 'text-[#E6C687]'}`}>
                      {activeFocus.status}
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400 font-bold uppercase font-mono">
                    {activeFocus.compatibility}% Aligned
                  </span>
                </div>

                <p className="text-sm text-zinc-300 italic font-light leading-relaxed text-center px-4">
                  {activeFocus.status === 'Ready to Pitch'
                    ? '"Vector parameters match lifestyle metrics. Dedicated AI voice broker Elizabeth is ready to initiate active value alignment pitching."'
                    : '"Vector parameters match lifestyle metrics. Dedicated AI voice broker Elizabeth has initiated active value alignment pitching."'}
                </p>

                {activeFocus.status === 'Ready to Pitch' && (
                  <div className="w-full flex gap-4 pt-4 border-t border-zinc-900">
                    <button
                      onClick={() => handleDeclineCandidate(activeFocus.id)}
                      disabled={actioningId === activeFocus.id}
                      className="flex-1 border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-xs font-bold py-3.5 rounded-xl transition duration-300"
                    >
                      Decline / Swap
                    </button>
                    <button
                      onClick={() => triggerOutreach(activeFocus.id)}
                      disabled={actionLoading}
                      className="flex-[1.2] bg-[#E6C687]/5 border border-[#E6C687] text-[#E6C687] hover:bg-[#E6C687]/15 text-xs font-bold py-3.5 rounded-xl transition duration-300 shadow-[0_0_15px_rgba(230,198,135,0.1)]"
                    >
                      {actionLoading ? 'Approving...' : 'Approve Outreach'}
                    </button>
                  </div>
                )}

              </div>
            ) : (
              <div className="bg-[#09090b] border border-zinc-900 rounded-3xl p-12 text-center text-zinc-500 text-xs font-mono">
                No active target in pipeline focus.
              </div>
            )}
          </div>

          {/* Right Column: Pipeline Queue & Escrow */}
          <div className="space-y-6">
            <h2 className="text-[10px] font-extrabold text-zinc-500 tracking-[0.2em] uppercase font-mono">
              Upcoming Pipeline
            </h2>

            <div className="space-y-3">
              {upcomingQueue.length > 0 ? (
                upcomingQueue.map((item, idx) => {
                  const label = idx === 0 ? 'Vetted & Locked' : 'Pipeline Queued'
                  return (
                    <div
                      key={item.id}
                      className="bg-[#050506] border border-zinc-900 rounded-2xl p-4 flex items-center gap-4 hover:border-zinc-800 transition duration-300"
                    >
                      <div className="w-10 h-10 rounded-full bg-[#0a0a0c] border border-zinc-800 flex items-center justify-center text-xs text-zinc-400 font-semibold uppercase">
                        {item.initials.charAt(0)}
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <div className="flex justify-between items-center">
                          <h4 className="text-xs text-zinc-200 font-serif font-bold">
                            {item.initials}
                          </h4>
                          <span className="text-[9px] text-[#E6C687]/80 font-mono">
                            {item.compatibility}% Fit
                          </span>
                        </div>
                        <p className="text-[10px] text-zinc-500">
                          {item.location}
                        </p>
                        <div className={`text-[9px] font-bold uppercase tracking-wider font-mono ${item.statusColor || 'text-zinc-500'}`}>
                          {item.status}
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="bg-[#050506] border border-zinc-900 rounded-2xl p-6 text-center text-zinc-600 text-xs font-mono">
                  Queue empty.
                </div>
              )}
            </div>

            {/* Escrow card */}
            <div className="bg-[#050403] border border-[#1c150c] rounded-2xl p-5 space-y-2">
              <h3 className="text-xs font-bold text-[#E6C687] uppercase tracking-wider font-mono flex items-center gap-2">
                <span>🛡️</span> Sovereign Escrow
              </h3>
              <p className="text-[10px] text-zinc-400 leading-relaxed">
                {profile?.unlock_credits_remaining || 0} Sourcing Credits locked. Any unanswered call instantly reverts to your ledger.
              </p>
            </div>

          </div>

        </div>

        {/* Footer */}
        <footer className="border-t border-zinc-900 pt-8 pb-4 flex flex-col gap-6 items-center">
          <button
            onClick={handleSignOut}
            className="w-full bg-[#050505] hover:bg-[#0c0c0c] border border-zinc-800 hover:border-zinc-700 text-zinc-400 text-xs font-bold py-3.5 rounded-xl transition duration-300"
          >
            Sign Out VIP Session
          </button>
          <p className="text-[10px] text-zinc-600 font-mono">
            © 2026 OpenMatch Sovereign. All Rights Reserved.
          </p>
        </footer>

      </div>
    </div>
  )
}
