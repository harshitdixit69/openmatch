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

/**
 * Retell signs each webhook with HMAC-SHA256 over the raw request body, using
 * your Retell API key as the secret, hex-encoded, in the `X-Retell-Signature`
 * header (this mirrors the official `Retell.verify()` SDK helper).
 *
 * We accept the key from RETELL_API_KEY (preferred) or RETELL_WEBHOOK_SECRET.
 */
const RETELL_SIGNING_SECRET =
    Deno.env.get('RETELL_API_KEY') || Deno.env.get('RETELL_WEBHOOK_SECRET') || '';

/** Constant-time string comparison to avoid signature timing leaks. */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
}

async function verifyRetellSignature(rawBody: string, signature: string | null): Promise<boolean> {
    if (!signature) return false;
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(RETELL_SIGNING_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const macBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    const expected = Array.from(new Uint8Array(macBuffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    // Retell sends the raw hex digest; tolerate an optional "sha256=" prefix.
    const provided = signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature;
    return timingSafeEqual(expected, provided.toLowerCase());
}

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

    // Read the raw body once — required for signature verification (re-serializing
    // parsed JSON would change bytes and break the HMAC).
    const rawBody = await req.text();

    // Fail closed: a missing signing secret is a misconfiguration, not a reason
    // to accept unauthenticated webhooks that can fake call outcomes.
    if (!RETELL_SIGNING_SECRET) {
        console.error('RETELL_API_KEY / RETELL_WEBHOOK_SECRET is not configured; rejecting webhook.');
        return new Response(JSON.stringify({ error: 'Webhook signing secret not configured' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const signature =
        req.headers.get('x-retell-signature') || req.headers.get('X-Retell-Signature');
    const signatureValid = await verifyRetellSignature(rawBody, signature);
    if (!signatureValid) {
        console.error('Unauthorized webhook request: invalid or missing Retell signature.');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        let payload: RetellWebhookPayload;
        try {
            payload = JSON.parse(rawBody) as RetellWebhookPayload;
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }
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
