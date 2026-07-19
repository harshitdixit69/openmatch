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

    const { vipId, logId, status } = await request.json()

    // Enforce that a user can only update their own telemetry logs
    if (user.id !== vipId) {
      return NextResponse.json({ error: 'Forbidden update' }, { status: 403 })
    }

    // Fetch the outreach log to retrieve target candidate_id
    const { data: outreachLog } = await supabase
      .from('vip_outreach_logs')
      .select('candidate_id')
      .eq('id', logId)
      .maybeSingle()

    if (status === 'completed') {
      // Successful outreach -> advance bot state to handshake
      await supabase
        .from('vip_bot_sessions')
        .update({
          status: 'handshake',
          updated_at: new Date().toISOString()
        })
        .eq('vip_id', vipId)

      // Conclude log status
      await supabase
        .from('vip_outreach_logs')
        .update({
          status: 'Retell Voice Call Concluded (Accepted)'
        })
        .eq('id', logId)
    } else {
      // Failed outreach -> reset bot state to sourcing so they can try again
      await supabase
        .from('vip_bot_sessions')
        .update({
          status: 'sourcing',
          updated_at: new Date().toISOString()
        })
        .eq('vip_id', vipId)

      // Delete the pending interest request so it disappears from queues/inboxes
      if (outreachLog?.candidate_id) {
        await supabase
          .from('interest_requests')
          .delete()
          .eq('sender_id', vipId)
          .eq('receiver_id', outreachLog.candidate_id)
      }

      // Mark log status as failed. This updates the database row status, which
      // automatically triggers the refund of +1 credit in profiles!
      await supabase
        .from('vip_outreach_logs')
        .update({
          status: 'failed'
        })
        .eq('id', logId)
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
