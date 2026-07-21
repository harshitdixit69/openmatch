import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface RetellWebhookPayload {
    event: 'call_started' | 'call_ended' | 'call_analyzed';
    call: {
        call_id: string;
        call_status?: string;
        start_timestamp?: number;
        end_timestamp?: number;
        duration_ms?: number;
        disconnection_reason?: string;
        recording_url?: string;
        transcript?: string;
        metadata?: {
            brokerCallId?: string;
            requestId?: string;
            retellCallId?: string;
            targetProfileId?: string;
        };
        call_analysis?: {
            call_summary?: string | string[];
            user_sentiment?: string;
            call_successful?: boolean;
            custom_analysis_data?: {
                accepted_pitch?: boolean;
                requested_unlock?: boolean;
                voicemail_detected?: boolean;
            };
        };
    };
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function updateOutreachLogs(callId: string, metadata: any, updateFields: Record<string, any>) {
    // 1. Try updating by retell_call_id = call_id
    const { data: updatedById } = await supabase
        .from('ai_outreach_logs')
        .update(updateFields)
        .eq('retell_call_id', callId)
        .select('id');

    if (updatedById && updatedById.length > 0) return;

    // 2. Fallback: Try updating by metadata.retellCallId
    if (metadata?.retellCallId) {
        await supabase
            .from('ai_outreach_logs')
            .update({ ...updateFields, retell_call_id: callId })
            .eq('retell_call_id', metadata.retellCallId);
    }
}

serve(async (req: Request) => {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const payload: RetellWebhookPayload = await req.json();
        const { event, call } = payload;

        if (!call || !call.call_id) {
            return new Response(JSON.stringify({ error: 'Invalid call payload' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const callId = call.call_id;
        const metadata = call.metadata || {};

        if (event === 'call_started') {
            await updateOutreachLogs(callId, metadata, {
                call_status: 'calling',
                updated_at: new Date().toISOString(),
            });

            return new Response(JSON.stringify({ success: true, status: 'calling' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (event === 'call_ended') {
            const isVoicemail = call.disconnection_reason === 'voicemail_reached' ||
                call.call_analysis?.custom_analysis_data?.voicemail_detected === true;

            const fields: Record<string, any> = {
                disconnection_reason: call.disconnection_reason || null,
                call_duration_ms: call.duration_ms || null,
                recording_url: call.recording_url || null,
                transcript: call.transcript || null,
                updated_at: new Date().toISOString(),
            };

            if (isVoicemail) {
                fields.call_status = 'voicemail';
            }

            await updateOutreachLogs(callId, metadata, fields);

            return new Response(JSON.stringify({ success: true, status: isVoicemail ? 'voicemail' : 'ended' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (event === 'call_analyzed') {
            const analysis = call.call_analysis || {};
            const rawSummary = analysis.call_summary;

            let summaryBullets: string[] = [];
            if (Array.isArray(rawSummary)) {
                summaryBullets = rawSummary.map((s) => String(s).trim());
            } else if (typeof rawSummary === 'string') {
                summaryBullets = rawSummary
                    .split(/\.\s+|\n+/)
                    .map((s) => s.replace(/^[•\-\*]\s*/, '').trim())
                    .filter(Boolean);
            }

            const sentiment = analysis.user_sentiment || 'Neutral';
            const custom = analysis.custom_analysis_data || {};

            let finalStatus: 'completed_accepted' | 'completed_declined' | 'voicemail' | 'failed' = 'completed_declined';
            if (custom.voicemail_detected || call.disconnection_reason === 'voicemail_reached') {
                finalStatus = 'voicemail';
            } else if (analysis.call_successful || custom.accepted_pitch || custom.requested_unlock) {
                finalStatus = 'completed_accepted';
            } else if (call.disconnection_reason === 'dial_failed' || call.disconnection_reason === 'user_hangup_early') {
                finalStatus = 'failed';
            }

            await updateOutreachLogs(callId, metadata, {
                call_status: finalStatus,
                call_summary: summaryBullets,
                candidate_sentiment: sentiment,
                call_analysis_data: analysis,
                recording_url: call.recording_url || null,
                disconnection_reason: call.disconnection_reason || null,
                call_duration_ms: call.duration_ms || null,
                transcript: call.transcript || null,
                updated_at: new Date().toISOString(),
            });

            return new Response(JSON.stringify({ success: true, status: finalStatus }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response(JSON.stringify({ success: true, message: 'Event ignored' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err: any) {
        console.error('retell-webhook-handler error:', err);
        return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
});
