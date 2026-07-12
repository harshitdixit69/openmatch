import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { buildViewerUnlockState, getParticipantColumns, MatchRow, MatchUnlockRow } from '../_shared/unlockState.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type UpdateMatchUnlockRequest = {
    matchId?: string;
    action?: 'request' | 'accept' | 'decline';
};

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const env = getEnv();
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            return json({ error: 'Missing Authorization header.' }, 401);
        }

        const userClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
            auth: { persistSession: false },
            global: {
                headers: {
                    Authorization: authHeader,
                },
            },
        });

        const {
            data: { user },
            error: userError,
        } = await userClient.auth.getUser();

        if (userError || !user) {
            return json({ error: 'Unauthorized request.' }, 401);
        }

        const payload = (await request.json()) as UpdateMatchUnlockRequest;
        const matchId = typeof payload.matchId === 'string' ? payload.matchId.trim() : '';
        const action = payload.action;

        if (!matchId || !action || !['request', 'accept', 'decline'].includes(action)) {
            return json({ error: 'matchId and a valid action are required.' }, 400);
        }

        const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { persistSession: false },
        });

        const match = await fetchMatch(serviceClient, matchId, user.id);
        const unlock = await fetchMatchUnlock(serviceClient, matchId);
        const participantColumns = getParticipantColumns(match, user.id);
        const now = new Date().toISOString();

        if (match.is_unlocked) {
            return json({
                state: buildViewerUnlockState(match, unlock, user.id),
                message: 'This conversation is already unlocked.',
            });
        }

        let nextUnlock: MatchUnlockRow | null = unlock;

        if (action === 'request') {
            if (unlock && unlock.status !== 'declined') {
                return json({
                    state: buildViewerUnlockState(match, unlock, user.id),
                    message: 'An unlock request is already active for this match.',
                });
            }

            const payloadForUpsert = {
                match_id: match.id,
                requested_by: user.id,
                status: 'awaiting_response',
                user_1_accepted_at: participantColumns.currentAcceptedAt === 'user_1_accepted_at' ? now : null,
                user_2_accepted_at: participantColumns.currentAcceptedAt === 'user_2_accepted_at' ? now : null,
                user_1_paid_at: null,
                user_2_paid_at: null,
                declined_by: null,
                declined_at: null,
                updated_at: now,
            };

            const { data, error } = await serviceClient
                .from('match_unlocks')
                .upsert(payloadForUpsert)
                .select('*')
                .single<MatchUnlockRow>();

            if (error) {
                throw error;
            }

            nextUnlock = data;
        }

        if (action === 'accept') {
            if (!unlock) {
                return json({ error: 'No unlock request exists for this conversation yet.' }, 409);
            }

            if (unlock.status === 'declined') {
                return json({ error: 'This unlock request was declined. Start a new request instead.' }, 409);
            }

            const updatedUnlock = {
                ...unlock,
                [participantColumns.currentAcceptedAt]: unlock[participantColumns.currentAcceptedAt] ?? now,
                status:
                    unlock[participantColumns.otherAcceptedAt] || unlock[participantColumns.currentAcceptedAt]
                        ? 'awaiting_payment'
                        : 'awaiting_response',
                declined_by: null,
                declined_at: null,
                updated_at: now,
            };

            if (!updatedUnlock[participantColumns.otherAcceptedAt]) {
                updatedUnlock.status = 'awaiting_response';
            }

            if (updatedUnlock.user_1_accepted_at && updatedUnlock.user_2_accepted_at) {
                updatedUnlock.status = 'awaiting_payment';
            }

            const { data, error } = await serviceClient
                .from('match_unlocks')
                .update(updatedUnlock)
                .eq('match_id', match.id)
                .select('*')
                .single<MatchUnlockRow>();

            if (error) {
                throw error;
            }

            nextUnlock = data;
        }

        if (action === 'decline') {
            if (!unlock) {
                return json({ error: 'No unlock request exists for this conversation yet.' }, 409);
            }

            if (unlock.user_1_paid_at || unlock.user_2_paid_at) {
                return json({ error: 'This unlock flow already has a payment. Decline is no longer available.' }, 409);
            }

            const { data, error } = await serviceClient
                .from('match_unlocks')
                .update({
                    status: 'declined',
                    declined_by: user.id,
                    declined_at: now,
                    updated_at: now,
                })
                .eq('match_id', match.id)
                .select('*')
                .single<MatchUnlockRow>();

            if (error) {
                throw error;
            }

            nextUnlock = data;
        }

        const state = buildViewerUnlockState(match, nextUnlock, user.id);
        const message =
            action === 'request'
                ? 'Unlock request sent. The other person needs to accept before either of you can pay.'
                : action === 'accept'
                    ? state.canPay
                        ? 'Both of you agreed. You can now pay your share.'
                        : 'You accepted the unlock request.'
                    : 'Unlock request declined.';

        // Notify the other participant of the action they need to respond to.
        const otherUserId = match.user_1_id === user.id ? match.user_2_id : match.user_1_id;
        if (action === 'request') {
            await safeInsertNotification(serviceClient, otherUserId, 'contact_unlocked', {
                title: 'Contact unlock requested',
                body: 'Someone wants to share contact details with you.',
                metadata: { matchId: match.id },
            });
        } else if (action === 'accept' && state.canPay) {
            // Both accepted — notify both to proceed with payment.
            await Promise.all([
                safeInsertNotification(serviceClient, user.id, 'contact_unlocked', {
                    title: 'Both accepted — pay to unlock',
                    body: 'Both of you agreed. Pay your share to share contact details.',
                    metadata: { matchId: match.id },
                }),
                safeInsertNotification(serviceClient, otherUserId, 'contact_unlocked', {
                    title: 'Both accepted — pay to unlock',
                    body: 'Both of you agreed. Pay your share to share contact details.',
                    metadata: { matchId: match.id },
                }),
            ]);
        } else if (action === 'decline') {
            await safeInsertNotification(serviceClient, otherUserId, 'contact_unlocked', {
                title: 'Unlock request declined',
                body: 'The contact unlock request was declined.',
                metadata: { matchId: match.id },
            });
        }

        return json({ state, message });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown mutual unlock error.';
        return json({ error: message }, 500);
    }
});

async function fetchMatch(serviceClient: ReturnType<typeof createClient>, matchId: string, userId: string) {
    const { data, error } = await serviceClient
        .from('matches')
        .select('id, user_1_id, user_2_id, status, is_unlocked')
        .eq('id', matchId)
        .single<MatchRow>();

    if (error) {
        throw error;
    }

    if (data.user_1_id !== userId && data.user_2_id !== userId) {
        throw new Error('You are not a participant in this match.');
    }

    return data;
}

async function fetchMatchUnlock(serviceClient: ReturnType<typeof createClient>, matchId: string) {
    const { data, error } = await serviceClient
        .from('match_unlocks')
        .select('*')
        .eq('match_id', matchId)
        .maybeSingle<MatchUnlockRow>();

    if (error) {
        throw error;
    }

    return data;
}

async function safeInsertNotification(
    serviceClient: ReturnType<typeof createClient>,
    userId: string,
    type: string,
    opts: { title: string; body: string; metadata: Record<string, string> },
) {
    const { error } = await serviceClient.from('notifications').insert({
        user_id: userId,
        type,
        title: opts.title,
        body: opts.body,
        metadata: opts.metadata,
        is_read: false,
    });

    if (error && !/does not exist/i.test(error.message ?? '')) {
        console.warn('safeInsertNotification failed:', error.message);
    }
}

function getEnv() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
        throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.');
    }

    return {
        supabaseUrl,
        supabaseAnonKey,
        supabaseServiceRoleKey,
    };
}

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
        },
    });
}