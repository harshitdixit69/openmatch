import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    // Create client using the user's JWT
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    })

    // Retrieve user session info
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized session' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { candidateId } = body

    if (!candidateId) {
      return NextResponse.json({ error: 'Missing candidateId parameter' }, { status: 400 })
    }

    // Check user_tier in profiles
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('user_tier, unlock_credits_remaining')
      .eq('id', user.id)
      .single()

    if (profileErr || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    if (profile.user_tier !== 'VIP') {
      return NextResponse.json({ error: 'VIP tier required' }, { status: 403 })
    }

    // Fetch target candidate profile details
    const { data: candidateProfile, error: candidateErr } = await supabase
      .from('profiles')
      .select('full_name, location')
      .eq('id', candidateId)
      .single()

    if (candidateErr || !candidateProfile) {
      return NextResponse.json({ error: 'Candidate profile not found' }, { status: 404 })
    }

    const nameParts = candidateProfile.full_name ? candidateProfile.full_name.split(' ') : ['Candidate']
    const maskedName = nameParts[0] + (nameParts[1] ? ` ${nameParts[1].charAt(0)}.` : '')

    // Check if there is an active session already running
    const { data: existingSession } = await supabase
      .from('vip_bot_sessions')
      .select('status')
      .eq('vip_id', user.id)
      .maybeSingle()

    if (existingSession && (existingSession.status === 'call_active' || existingSession.status === 'handshake')) {
      return NextResponse.json({ error: 'An outreach call or handshake is already in progress' }, { status: 409 })
    }

    if (profile.unlock_credits_remaining <= 0) {
      return NextResponse.json({ error: 'No outreach credits available' }, { status: 402 })
    }

    // Invoke the submit-interest-request edge function
    const { error: invokeErr } = await supabase.functions.invoke('submit-interest-request', {
      body: {
        candidateProfileId: candidateId,
        selectedReasonId: 'custom',
        personalizedReason: 'Highly aligned lifestyle values, pitched by Concierge Elizabeth.',
        mediaType: 'none',
        mediaUrl: null,
        voiceTranscript: null,
      }
    })

    if (invokeErr) {
      return NextResponse.json({ error: invokeErr.message || 'Failed to submit interest request' }, { status: 500 })
    }

    // Decrement credit atomically via RPC
    const { data: creditConsumed, error: decErr } = await supabase
      .rpc('consume_vip_outreach_credit')

    if (decErr || !creditConsumed) {
      return NextResponse.json({ error: 'Failed to consume credit or no credits available' }, { status: 402 })
    }

    // Update session state to 'call_active'
    const { error: sessionErr } = await supabase
      .from('vip_bot_sessions')
      .upsert({
        vip_id: user.id,
        status: 'call_active',
        updated_at: new Date().toISOString()
      })

    if (sessionErr) {
      return NextResponse.json({ error: 'Failed to update bot session' }, { status: 500 })
    }

    // Log the outreach attempt as initiated
    const newLog = {
      vip_id: user.id,
      candidate_id: candidateId,
      mask: maskedName,
      compatibility: Math.floor(80 + Math.random() * 19),
      location: candidateProfile.location || 'Unknown location',
      status: 'Outreach Initiated',
      timestamp: new Date().toISOString()
    }

    const { data: insertedLog, error: logErr } = await supabase
      .from('vip_outreach_logs')
      .insert(newLog)
      .select()
      .single()

    if (logErr) {
      return NextResponse.json({ error: 'Failed to write outreach log' }, { status: 500 })
    }

    // Simulate Retell AI outbound voice pitch call in background
    // In a real app, this would call Retell AI. Here, we simulate a status callback.
    // We fetch our own callback endpoint in the background after a delay!
    setTimeout(async () => {
      try {
        const callbackUrl = `${new URL(request.url).origin}/api/vip/retell-webhook`
        const finalStatus = Math.random() > 0.3 ? 'completed' : 'failed' // 70% success, 30% failure rate
        
        await fetch(callbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader
          },
          body: JSON.stringify({
            vipId: user.id,
            logId: insertedLog.id,
            status: finalStatus
          })
        })
      } catch (err) {
        console.error('Simulated callback error:', err)
      }
    }, 6000) // 6 seconds delay

    return NextResponse.json({ success: true, log: insertedLog })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
