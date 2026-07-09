import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

function parseEnvFile(text) {
    return Object.fromEntries(
        text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'))
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

function printUsage() {
    console.log(`Usage: node ./scripts/phase8BrokerCheck.mjs [--cleanup] [--help]

Runs a Retell-focused broker integration check against the deployed Supabase project.

Required:
  - openmatch/.env with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY

Optional:
  - SUPABASE_SERVICE_ROLE_KEY for webhook verification and cleanup
  - RETELL_WEBHOOK_SECRET or BROKER_WEBHOOK_SECRET for webhook verification without service-role auth

Flags:
  --cleanup   Delete the temporary users after the run (requires SUPABASE_SERVICE_ROLE_KEY)
  --help      Show this message and exit
`);
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
        .select('id, full_name')
        .single();

    if (error) {
        throw error;
    }

    return data;
}

async function upsertContactDetails(client, userId, input) {
    const payload = {
        profile_id: userId,
        phone_number: input.phone_number,
        whatsapp_number: input.whatsapp_number,
        updated_at: new Date().toISOString(),
    };

    const { data, error } = await client
        .from('profile_contact_details')
        .upsert(payload)
        .select('profile_id, phone_number, whatsapp_number')
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

async function parseResponseBody(response) {
    const text = await response.text();

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

async function invokeFunction(functionsBaseUrl, functionName, token, body, extraHeaders = {}) {
    const response = await fetch(`${functionsBaseUrl}/${functionName}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...extraHeaders,
        },
        body: JSON.stringify(body),
    });

    return {
        status: response.status,
        body: await parseResponseBody(response),
    };
}

function summarizeQuery(result) {
    return {
        error: result.error?.message ?? null,
        count: Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0,
        rows: result.data ?? null,
    };
}

function buildWebhookAuth(rawBody, env) {
    if (env.serviceRoleKey) {
        return {
            Authorization: `Bearer ${env.serviceRoleKey}`,
            'Content-Type': 'application/json',
        };
    }

    const secret = env.retellWebhookSecret || env.brokerWebhookSecret;
    if (!secret) {
        return null;
    }

    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
    return {
        'Content-Type': 'application/json',
        'x-retell-signature': signature,
    };
}

async function main() {
    const args = new Set(process.argv.slice(2));
    if (args.has('--help')) {
        printUsage();
        return;
    }

    const shouldCleanup = args.has('--cleanup');
    const env = parseEnvFile(await readFile(new URL('../.env', import.meta.url), 'utf8'));
    const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const functionsBaseUrl = supabaseUrl.replace('.supabase.co', '.functions.supabase.co');
    const password = 'Phase8Broker!234';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    const retellWebhookSecret = process.env.RETELL_WEBHOOK_SECRET ?? '';
    const brokerWebhookSecret = process.env.BROKER_WEBHOOK_SECRET ?? '';

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
        webhookVerificationMode: serviceRoleKey
            ? 'service_role'
            : retellWebhookSecret || brokerWebhookSecret
                ? 'retell_signature'
                : 'skipped',
    };

    const createdUserIds = [];
    let runError = null;

    try {
        const senderClient = buildClient(supabaseUrl, supabaseAnonKey);
        const receiverClient = buildClient(supabaseUrl, supabaseAnonKey);

        const senderAuth = await ensureSession(senderClient, makeEmail('phase8-broker-sender'), password);
        const receiverAuth = await ensureSession(receiverClient, makeEmail('phase8-broker-receiver'), password);
        createdUserIds.push(senderAuth.user.id, receiverAuth.user.id);

        report.users.sender = { id: senderAuth.user.id, email: senderAuth.user.email };
        report.users.receiver = { id: receiverAuth.user.id, email: receiverAuth.user.email };

        await upsertProfile(senderClient, senderAuth.user.id, {
            full_name: 'Phase Eight Sender',
            gender: 'male',
            dob: '1993-08-14',
            location: 'Pune',
            bio: 'Testing the broker follow-up path after an accepted request.',
            preferences: 'someone serious about marriage and calm communication',
            height_cm: 178,
            profile_owner: 'self',
        });

        await upsertProfile(receiverClient, receiverAuth.user.id, {
            full_name: 'Phase Eight Receiver',
            gender: 'female',
            dob: '1995-01-23',
            location: 'Mumbai',
            bio: 'Testing the accepted-request side of the broker flow.',
            preferences: 'someone thoughtful, respectful, and family-oriented',
            height_cm: 166,
            profile_owner: 'self',
        });

        report.checks.targetContactDetails = await upsertContactDetails(senderClient, senderAuth.user.id, {
            phone_number: '+919876543210',
            whatsapp_number: '+919876543210',
        });

        const submitRequest = await invokeFunction(
            functionsBaseUrl,
            'submit-interest-request',
            senderAuth.session.access_token,
            {
                candidateProfileId: receiverAuth.user.id,
                selectedReasonId: 'phase8-check',
                personalizedReason: 'Integration check for the Retell broker flow after an accepted request.',
                mediaType: 'none',
                mediaUrl: null,
                voiceTranscript: null,
                requestQualityScore: 78,
            },
        );
        report.checks.submitInterestRequest = submitRequest;

        const requestId = submitRequest.body?.requestId ?? null;
        const matchId = submitRequest.body?.matchId ?? null;

        if (!requestId || !matchId || submitRequest.status < 200 || submitRequest.status >= 300) {
            throw new Error('Could not create a broker verification request.');
        }

        const acceptRequest = await invokeFunction(
            functionsBaseUrl,
            'respond-interest-request',
            receiverAuth.session.access_token,
            {
                action: 'accept',
                requestId,
            },
        );
        report.checks.acceptInterestRequest = acceptRequest;

        if (acceptRequest.status < 200 || acceptRequest.status >= 300) {
            throw new Error('Could not accept the broker verification request.');
        }

        const consentResponse = await invokeFunction(
            functionsBaseUrl,
            'send-broker-consent',
            senderAuth.session.access_token,
            {
                requestId,
                consent: true,
                preferredChannel: 'voice',
                preferredProvider: 'retell',
                locale: 'en-IN',
            },
        );
        report.checks.sendBrokerConsent = consentResponse;

        if (consentResponse.status < 200 || consentResponse.status >= 300) {
            throw new Error('Could not record broker consent for the target participant.');
        }

        const consentRows = await senderClient
            .from('ai_broker_calls')
            .select('id, provider, channel, status, consent_granted, target_profile_id, created_at')
            .eq('request_id', requestId)
            .order('created_at', { ascending: false })
            .limit(5);
        report.checks.brokerConsentRows = summarizeQuery(consentRows);

        const callbackResponse = await invokeFunction(
            functionsBaseUrl,
            'trigger-intent-callback',
            receiverAuth.session.access_token,
            {
                requestId,
                mode: 'availability_check',
            },
        );
        report.checks.triggerIntentCallback = callbackResponse;

        const availabilityJobs = await senderClient
            .from('ai_followup_jobs')
            .select('id, provider, channel, status, created_at')
            .eq('request_id', requestId)
            .eq('channel', 'availability_check')
            .order('created_at', { ascending: false })
            .limit(5);
        report.checks.availabilityFollowupJobs = summarizeQuery(availabilityJobs);

        const outboundResponse = await invokeFunction(
            functionsBaseUrl,
            'trigger-outbound-broker-call',
            receiverAuth.session.access_token,
            {
                requestId,
                targetProfileId: senderAuth.user.id,
                mode: 'manual',
                channel: 'voice',
                provider: 'retell',
                dryRun: false,
            },
        );
        report.checks.triggerOutboundBrokerCall = outboundResponse;

        const brokerCallsAfterDispatch = await senderClient
            .from('ai_broker_calls')
            .select('id, provider, channel, status, provider_call_id, target_profile_id, outcome, attempt_number, created_at')
            .eq('request_id', requestId)
            .eq('channel', 'voice')
            .order('created_at', { ascending: false })
            .limit(5);
        report.checks.brokerCallsAfterDispatch = summarizeQuery(brokerCallsAfterDispatch);

        const latestBrokerCall = Array.isArray(brokerCallsAfterDispatch.data)
            ? brokerCallsAfterDispatch.data[0] ?? null
            : null;

        if (!latestBrokerCall) {
            throw new Error('No voice broker call row was created for the verification request.');
        }

        const webhookPayload = {
            event: 'call_analyzed',
            call: {
                call_id: latestBrokerCall.provider_call_id ?? `phase8-retell-${Date.now()}`,
                call_status: 'ended',
                disconnection_reason: 'user_wants_to_continue',
                transcript: 'Yes, I want to continue this match and share WhatsApp after mutual unlock.',
                metadata: {
                    requestId,
                    matchId,
                    targetProfileId: senderAuth.user.id,
                },
                retell_llm_dynamic_variables: {
                    broker_request_id: requestId,
                },
                call_analysis: {
                    call_summary: 'User wants to continue and prefers to move to WhatsApp after the unlock.',
                    user_sentiment: 'positive',
                    custom_analysis_data: {
                        intent: 'user_wants_to_continue',
                        preferredContactMode: 'whatsapp_after_unlock',
                    },
                },
            },
        };

        const rawWebhookBody = JSON.stringify(webhookPayload);
        const webhookHeaders = buildWebhookAuth(rawWebhookBody, {
            serviceRoleKey,
            retellWebhookSecret,
            brokerWebhookSecret,
        });

        if (webhookHeaders) {
            const webhookResponse = await fetch(`${functionsBaseUrl}/handle-broker-call-webhook`, {
                method: 'POST',
                headers: webhookHeaders,
                body: rawWebhookBody,
            });

            report.checks.handleBrokerWebhook = {
                status: webhookResponse.status,
                body: await parseResponseBody(webhookResponse),
            };

            const brokerCallsAfterWebhook = await senderClient
                .from('ai_broker_calls')
                .select('id, provider, channel, status, outcome, provider_call_id, transcript, created_at')
                .eq('request_id', requestId)
                .eq('channel', 'voice')
                .order('created_at', { ascending: false })
                .limit(5);
            report.checks.brokerCallsAfterWebhook = summarizeQuery(brokerCallsAfterWebhook);

            const mutualUnlockJobs = await senderClient
                .from('ai_followup_jobs')
                .select('id, provider, channel, status, payload, created_at')
                .eq('request_id', requestId)
                .eq('channel', 'broker_mutual_unlock_prompt')
                .order('created_at', { ascending: false })
                .limit(5);
            report.checks.mutualUnlockPromptJobs = summarizeQuery(mutualUnlockJobs);
        } else {
            report.notes.push('Skipped broker webhook verification because neither SUPABASE_SERVICE_ROLE_KEY nor a Retell/Broker webhook secret is available in the shell environment.');
        }
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