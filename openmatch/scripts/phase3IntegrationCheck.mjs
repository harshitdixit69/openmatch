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

function buildClient(url, anonKey) {
    return createClient(url, anonKey, {
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
            {
                onConflict: 'id',
            },
        )
        .select('id, full_name, bio, preferences, location, profile_owner')
        .single();

    if (error) {
        throw error;
    }

    return data;
}

async function readProfileEmbedding(client, userId) {
    const { data, error } = await client.from('profiles').select('embedding').eq('id', userId).single();
    if (error) {
        throw error;
    }

    return data.embedding;
}

async function invokeEmbedding(functionsBaseUrl, profile) {
    const response = await fetch(`${functionsBaseUrl}/generate-profile-embedding`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            type: 'INSERT',
            record: {
                id: profile.id,
                bio: profile.bio,
                preferences: profile.preferences,
                location: profile.location,
                profile_owner: profile.profile_owner,
            },
        }),
    });

    return {
        status: response.status,
        body: await response.json(),
    };
}

async function invokeCompatibility(functionsBaseUrl, accessToken, candidateProfileId) {
    const response = await fetch(`${functionsBaseUrl}/generate-compatibility-summary`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ candidateProfileId }),
    });

    return {
        status: response.status,
        body: await response.json(),
    };
}

async function cleanupCreatedUsers(supabaseUrl, serviceRoleKey, userIds) {
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });

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

async function main() {
    const env = parseEnvFile(await readFile(new URL('../.env', import.meta.url), 'utf8'));
    const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const functionsBaseUrl = supabaseUrl.replace('.supabase.co', '.functions.supabase.co');
    const password = 'Phase3Test!234';
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
        const viewerClient = buildClient(supabaseUrl, supabaseAnonKey);
        const outsiderClient = buildClient(supabaseUrl, supabaseAnonKey);

        const viewerAuth = await ensureSession(viewerClient, makeEmail('phase3-viewer'), password);
        const outsiderAuth = await ensureSession(outsiderClient, makeEmail('phase3-outsider'), password);
        createdUserIds.push(viewerAuth.user.id, outsiderAuth.user.id);

        report.users.viewer = {
            email: viewerAuth.user.email,
            id: viewerAuth.user.id,
        };
        report.users.outsider = {
            email: outsiderAuth.user.email,
            id: outsiderAuth.user.id,
        };

        const viewerProfile = await upsertProfile(viewerClient, viewerAuth.user.id, {
            full_name: 'Phase Three Viewer',
            gender: 'male',
            dob: '1995-06-10',
            location: 'Pune',
            bio: 'Product-minded engineer who likes long walks, Indian classical music, and building useful consumer apps.',
            preferences: 'someone thoughtful, family-oriented, curious, and open to settling in Pune or Bangalore',
            height_cm: 178,
            profile_owner: 'self',
        });

        await upsertProfile(outsiderClient, outsiderAuth.user.id, {
            full_name: 'Phase Three Outsider',
            gender: 'female',
            dob: '1997-03-18',
            location: 'Bangalore',
            bio: 'Designer who enjoys reading, calm travel, and thoughtful conversations over coffee.',
            preferences: 'a patient partner who values family and a balanced lifestyle',
            height_cm: 165,
            profile_owner: 'self',
        });

        report.checks.viewerEmbeddingImmediatelyPresent = Boolean(
            await readProfileEmbedding(viewerClient, viewerAuth.user.id),
        );
        report.checks.outsiderEmbeddingImmediatelyPresent = Boolean(
            await readProfileEmbedding(outsiderClient, outsiderAuth.user.id),
        );

        report.checks.manualEmbeddingInvocation = await invokeEmbedding(functionsBaseUrl, viewerProfile);
        report.checks.viewerEmbeddingAfterManualInvoke = Boolean(
            await readProfileEmbedding(viewerClient, viewerAuth.user.id),
        );

        const existingCandidates = await viewerClient
            .from('profiles')
            .select('id, full_name')
            .not('embedding', 'is', null)
            .neq('id', viewerAuth.user.id)
            .limit(5);

        if (existingCandidates.error) {
            throw existingCandidates.error;
        }

        let candidate = existingCandidates.data?.[0] ?? null;
        if (candidate) {
            report.notes.push(`Used existing embedded candidate ${candidate.full_name} (${candidate.id}).`);
        }

        if (!candidate) {
            const candidateClient = buildClient(supabaseUrl, supabaseAnonKey);
            const candidateAuth = await ensureSession(candidateClient, makeEmail('phase3-candidate'), password);
            createdUserIds.push(candidateAuth.user.id);
            report.users.candidate = {
                email: candidateAuth.user.email,
                id: candidateAuth.user.id,
            };
            const candidateProfile = await upsertProfile(candidateClient, candidateAuth.user.id, {
                full_name: 'Phase Three Candidate',
                gender: 'female',
                dob: '1996-02-14',
                location: 'Pune',
                bio: 'Consultant who likes reading, classical dance performances, and weekend cooking with family.',
                preferences: 'someone warm, ambitious, and serious about marriage within a supportive family setup',
                height_cm: 168,
                profile_owner: 'self',
            });
            report.checks.candidateManualEmbeddingInvocation = await invokeEmbedding(functionsBaseUrl, candidateProfile);
            candidate = {
                id: candidateAuth.user.id,
                full_name: candidateProfile.full_name,
            };
        }

        const matchProfilesLimitThree = await viewerClient.rpc('match_profiles', { result_limit: 3 });
        const matchProfilesLimitOne = await viewerClient.rpc('match_profiles', { result_limit: 1 });

        report.checks.matchProfilesLimitThree = {
            error: matchProfilesLimitThree.error?.message ?? null,
            count: Array.isArray(matchProfilesLimitThree.data) ? matchProfilesLimitThree.data.length : null,
            includesSelf: Array.isArray(matchProfilesLimitThree.data)
                ? matchProfilesLimitThree.data.some((row) => row.id === viewerAuth.user.id)
                : null,
            topIds: Array.isArray(matchProfilesLimitThree.data)
                ? matchProfilesLimitThree.data.map((row) => row.id)
                : null,
        };

        report.checks.matchProfilesLimitOne = {
            error: matchProfilesLimitOne.error?.message ?? null,
            count: Array.isArray(matchProfilesLimitOne.data) ? matchProfilesLimitOne.data.length : null,
        };

        report.checks.compatibilityFirstCall = await invokeCompatibility(
            functionsBaseUrl,
            viewerAuth.session.access_token,
            candidate.id,
        );
        report.checks.compatibilitySecondCall = await invokeCompatibility(
            functionsBaseUrl,
            viewerAuth.session.access_token,
            candidate.id,
        );
        report.checks.compatibilitySameProfile = await invokeCompatibility(
            functionsBaseUrl,
            viewerAuth.session.access_token,
            viewerAuth.user.id,
        );
        report.checks.compatibilityMissingProfile = await invokeCompatibility(
            functionsBaseUrl,
            viewerAuth.session.access_token,
            '11111111-1111-1111-1111-111111111111',
        );

        const [user1Id, user2Id] = [viewerAuth.user.id, candidate.id].sort();

        const matchUpsertFirst = await viewerClient
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
            .select('id, user_1_id, user_2_id, status, is_unlocked')
            .single();

        const matchUpsertSecond = await viewerClient
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
            .select('id, user_1_id, user_2_id, status, is_unlocked')
            .single();

        const participantMatchView = await viewerClient
            .from('matches')
            .select('id, user_1_id, user_2_id, status, is_unlocked')
            .eq('user_1_id', user1Id)
            .eq('user_2_id', user2Id);

        const outsiderMatchView = await outsiderClient
            .from('matches')
            .select('id, user_1_id, user_2_id, status, is_unlocked')
            .eq('user_1_id', user1Id)
            .eq('user_2_id', user2Id);

        report.checks.matchUpsertFirst = {
            error: matchUpsertFirst.error?.message ?? null,
            row: matchUpsertFirst.data ?? null,
        };
        report.checks.matchUpsertSecond = {
            error: matchUpsertSecond.error?.message ?? null,
            row: matchUpsertSecond.data ?? null,
        };
        report.checks.matchViewParticipant = {
            error: participantMatchView.error?.message ?? null,
            count: participantMatchView.data?.length ?? 0,
        };
        report.checks.matchViewOutsider = {
            error: outsiderMatchView.error?.message ?? null,
            count: outsiderMatchView.data?.length ?? 0,
        };

        const participantSnapshotView = await viewerClient
            .from('compatibility_snapshots')
            .select('user_1_id, user_2_id, summary, updated_at')
            .eq('user_1_id', user1Id)
            .eq('user_2_id', user2Id);

        const outsiderSnapshotView = await outsiderClient
            .from('compatibility_snapshots')
            .select('user_1_id, user_2_id, summary, updated_at')
            .eq('user_1_id', user1Id)
            .eq('user_2_id', user2Id);

        report.checks.snapshotViewParticipant = {
            error: participantSnapshotView.error?.message ?? null,
            count: participantSnapshotView.data?.length ?? 0,
        };
        report.checks.snapshotViewOutsider = {
            error: outsiderSnapshotView.error?.message ?? null,
            count: outsiderSnapshotView.data?.length ?? 0,
        };

        report.checks.outsiderEmbeddingEventuallyPresent = Boolean(
            await readProfileEmbedding(outsiderClient, outsiderAuth.user.id),
        );
        report.notes.push('Outsider profile relied on the automatic profile->embedding path only; no manual embedding invoke was used for that user.');
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