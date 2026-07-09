import { readFile } from 'node:fs/promises';

import { createClient } from '@supabase/supabase-js';

function parseEnvFile(text) {
    return Object.fromEntries(
        text
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => {
                const separatorIndex = line.indexOf('=');
                return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
            }),
    );
}

function buildClient(url, key) {
    return createClient(url, key, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}

function makeEmail(prefix) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return `${prefix}-${suffix}@example.com`;
}

function formatError(error) {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

async function ensureSession(client, email, password) {
    const signUpResult = await client.auth.signUp({ email, password });
    if (signUpResult.error) {
        throw signUpResult.error;
    }

    if (signUpResult.data.session && signUpResult.data.user) {
        return {
            session: signUpResult.data.session,
            user: signUpResult.data.user,
        };
    }

    const signInResult = await client.auth.signInWithPassword({ email, password });
    if (signInResult.error || !signInResult.data.session || !signInResult.data.user) {
        throw signInResult.error ?? new Error(`Could not sign in ${email}.`);
    }

    return {
        session: signInResult.data.session,
        user: signInResult.data.user,
    };
}

async function upsertProfile(client, userId, payload) {
    const { data, error } = await client
        .from('profiles')
        .upsert(
            {
                id: userId,
                ...payload,
                onboarding_completed_at: new Date().toISOString(),
            },
            { onConflict: 'id' },
        )
        .select('id')
        .single();

    if (error) {
        throw error;
    }

    return data;
}

async function cleanupCreatedUsers(supabaseUrl, serviceRoleKey, userIds) {
    const adminClient = buildClient(supabaseUrl, serviceRoleKey);
    const uniqueUserIds = [...new Set(userIds)];

    const results = [];
    for (const userId of uniqueUserIds) {
        const { error } = await adminClient.auth.admin.deleteUser(userId);
        results.push({
            userId,
            deleted: !error,
            error: error?.message ?? null,
        });
    }

    return results;
}

async function invokeEscrowSend(functionsBaseUrl, accessToken, matchId, content) {
    const response = await fetch(`${functionsBaseUrl}/send-escrow-message`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ matchId, content }),
    });

    return {
        status: response.status,
        body: await response.json(),
    };
}

function waitForRealtimeMessage(client, matchId, timeoutMs = 15000) {
    let channel;

    const ready = new Promise((resolve, reject) => {
        channel = client
            .channel(`phase4-check:${matchId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `match_id=eq.${matchId}`,
                },
                async (payload) => {
                    clearTimeout(timeoutId);
                    await client.removeChannel(channel);
                    messageResolver({
                        received: true,
                        messageId: typeof payload.new?.id === 'string' ? payload.new.id : null,
                    });
                },
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    resolve(undefined);
                }

                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    reject(new Error(`Realtime subscription failed with status ${status}.`));
                }
            });
    });

    let messageResolver;
    const result = new Promise((resolve) => {
        messageResolver = resolve;
    });

    const timeoutId = setTimeout(async () => {
        await client.removeChannel(channel);
        messageResolver({ received: false, messageId: null });
    }, timeoutMs);

    return {
        ready,
        result,
    };
}

async function main() {
    const env = parseEnvFile(await readFile(new URL('../.env', import.meta.url), 'utf8'));
    const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const functionsBaseUrl = supabaseUrl.replace('.supabase.co', '.functions.supabase.co');
    const password = 'Phase4Test!234';
    const shouldCleanup = process.argv.includes('--cleanup');
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in openmatch/.env.');
    }

    if (shouldCleanup && !serviceRoleKey) {
        throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in the shell environment. Export it before using --cleanup.');
    }

    const report = {
        users: {},
        checks: {},
        notes: [],
        cleanupRequested: shouldCleanup,
    };

    const createdUserIds = [];
    let runError = null;

    try {
        const senderClient = buildClient(supabaseUrl, supabaseAnonKey);
        const recipientClient = buildClient(supabaseUrl, supabaseAnonKey);
        const outsiderClient = buildClient(supabaseUrl, supabaseAnonKey);

        const senderAuth = await ensureSession(senderClient, makeEmail('phase4-sender'), password);
        const recipientAuth = await ensureSession(recipientClient, makeEmail('phase4-recipient'), password);
        const outsiderAuth = await ensureSession(outsiderClient, makeEmail('phase4-outsider'), password);
        createdUserIds.push(senderAuth.user.id, recipientAuth.user.id, outsiderAuth.user.id);

        report.users.sender = { id: senderAuth.user.id, email: senderAuth.user.email };
        report.users.recipient = { id: recipientAuth.user.id, email: recipientAuth.user.email };
        report.users.outsider = { id: outsiderAuth.user.id, email: outsiderAuth.user.email };

        await upsertProfile(senderClient, senderAuth.user.id, {
            full_name: 'Phase Four Sender',
            gender: 'male',
            dob: '1994-11-08',
            location: 'Pune',
            bio: 'Enjoys meaningful conversations and building calm routines.',
            preferences: 'someone thoughtful and serious about marriage',
            height_cm: 176,
            profile_owner: 'self',
        });
        await upsertProfile(recipientClient, recipientAuth.user.id, {
            full_name: 'Phase Four Recipient',
            gender: 'female',
            dob: '1996-04-12',
            location: 'Mumbai',
            bio: 'Values family, design, and long walks after work.',
            preferences: 'a patient partner who communicates clearly',
            height_cm: 166,
            profile_owner: 'self',
        });
        await upsertProfile(outsiderClient, outsiderAuth.user.id, {
            full_name: 'Phase Four Outsider',
            gender: 'male',
            dob: '1993-02-21',
            location: 'Delhi',
            bio: 'Present for RLS verification only.',
            preferences: 'n/a',
            height_cm: 180,
            profile_owner: 'self',
        });

        const [user1Id, user2Id] = [senderAuth.user.id, recipientAuth.user.id].sort();
        const { data: matchRow, error: matchError } = await senderClient
            .from('matches')
            .upsert(
                {
                    user_1_id: user1Id,
                    user_2_id: user2Id,
                    status: 'pending',
                },
                {
                    onConflict: 'user_1_id,user_2_id',
                },
            )
            .select('id, is_unlocked')
            .single();

        if (matchError || !matchRow) {
            throw matchError ?? new Error('Could not create Phase 4 test match.');
        }

        report.checks.lockedMatchCreated = {
            matchId: matchRow.id,
            isUnlocked: matchRow.is_unlocked,
        };

        const directInsertAttempt = await senderClient.from('messages').insert({
            match_id: matchRow.id,
            sender_id: senderAuth.user.id,
            content: 'Direct insert should fail while escrow is active.',
        });

        report.checks.directInsertWhileLocked = {
            error: directInsertAttempt.error?.message ?? null,
            succeeded: !directInsertAttempt.error,
        };

        const safeSend = await invokeEscrowSend(
            functionsBaseUrl,
            senderAuth.session.access_token,
            matchRow.id,
            'Hello, I enjoyed reading your profile and would like to know more about your family values.',
        );
        report.checks.safeEscrowSend = safeSend;

        const piiSend = await invokeEscrowSend(
            functionsBaseUrl,
            senderAuth.session.access_token,
            matchRow.id,
            'You can call me on 9876543210 or email me at phase4@example.com tonight.',
        );
        report.checks.piiEscrowSend = piiSend;

        const realtimeWait = waitForRealtimeMessage(recipientClient, matchRow.id);
        await realtimeWait.ready;
        const realtimeSend = await invokeEscrowSend(
            functionsBaseUrl,
            senderAuth.session.access_token,
            matchRow.id,
            'Checking realtime delivery for the escrow chat thread.',
        );
        report.checks.realtimeEscrowSend = realtimeSend;
        report.checks.realtimeDelivery = await realtimeWait.result;

        const recipientMessages = await recipientClient
            .from('messages')
            .select('id, content, is_flagged_by_system')
            .eq('match_id', matchRow.id)
            .order('created_at', { ascending: true });

        const outsiderMessages = await outsiderClient
            .from('messages')
            .select('id, content, is_flagged_by_system')
            .eq('match_id', matchRow.id)
            .order('created_at', { ascending: true });

        report.checks.recipientMessageView = {
            error: recipientMessages.error?.message ?? null,
            count: recipientMessages.data?.length ?? 0,
            lastMessage: recipientMessages.data?.at(-1) ?? null,
        };
        report.checks.outsiderMessageView = {
            error: outsiderMessages.error?.message ?? null,
            count: outsiderMessages.data?.length ?? 0,
        };
    } catch (error) {
        runError = error;
        report.error = formatError(error);
    } finally {
        if (shouldCleanup && serviceRoleKey && createdUserIds.length > 0) {
            report.cleanup = await cleanupCreatedUsers(supabaseUrl, serviceRoleKey, createdUserIds);
        }

        console.log(JSON.stringify(report, null, 2));
    }

    if (runError) {
        throw runError;
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});