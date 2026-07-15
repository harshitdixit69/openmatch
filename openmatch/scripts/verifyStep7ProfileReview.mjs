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

async function main() {
    console.log('==> Starting Step 7: Profile Re-viewing Logic Verification...');
    const env = parseEnvFile(await readFile(new URL('../.env', import.meta.url), 'utf8'));
    const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing URL or Anon key in .env file.');
    }

    const adminClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const emailA = `test-review-A-${Date.now()}@example.com`;
    const emailB = `test-review-B-${Date.now()}@example.com`;
    const password = 'TestReviewUser!123';

    // 1. Sign up User A
    console.log('==> Signing up User A:', emailA);
    const signUpA = await adminClient.auth.signUp({ email: emailA, password });
    if (signUpA.error) throw signUpA.error;
    const sessionA = signUpA.data.session;
    const userA = signUpA.data.user;

    const clientA = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${sessionA.access_token}` } }
    });

    console.log('==> Creating Profile for User A...');
    const { error: profileAError } = await clientA
        .from('profiles')
        .upsert({
            id: userA.id,
            full_name: 'Reviewer Alice',
            dob: '1995-05-05',
            location: 'Lucknow',
            gender: 'woman',
            partner_gender_preference: 'man',
            bio: 'I am Reviewer Alice',
            profile_owner: 'self',
            onboarding_completed_at: new Date().toISOString()
        });
    if (profileAError) throw profileAError;

    // 2. Sign up User B
    console.log('==> Signing up User B:', emailB);
    const signUpB = await adminClient.auth.signUp({ email: emailB, password });
    if (signUpB.error) throw signUpB.error;
    const sessionB = signUpB.data.session;
    const userB = signUpB.data.user;

    const clientB = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${sessionB.access_token}` } }
    });

    console.log('==> Creating Profile for User B...');
    const { error: profileBError } = await clientB
        .from('profiles')
        .upsert({
            id: userB.id,
            full_name: 'Reviewee Bob',
            dob: '1993-03-03',
            location: 'Lucknow',
            gender: 'man',
            partner_gender_preference: 'woman',
            bio: 'I am Reviewee Bob',
            profile_owner: 'self',
            onboarding_completed_at: new Date().toISOString()
        });
    if (profileBError) throw profileBError;

    // Helper functions to retrieve relationship status (exactly as matched in screen query)
    async function checkRelationship(client, viewerId, targetId) {
        // Query interest_requests
        const { data: reqs, error: reqsErr } = await client
            .from('interest_requests')
            .select('*')
            .or(`and(sender_id.eq.${viewerId},receiver_id.eq.${targetId}),and(sender_id.eq.${targetId},receiver_id.eq.${viewerId})`)
            .order('created_at', { ascending: false });

        if (reqsErr) throw reqsErr;

        if (reqs && reqs.length > 0) {
            const activeReq = reqs[0];
            if (activeReq.status === 'accepted') {
                return { status: 'accepted', req: activeReq };
            } else if (activeReq.status === 'sent') {
                if (activeReq.sender_id === viewerId) {
                    return { status: 'sent', req: activeReq };
                } else {
                    return { status: 'received', req: activeReq };
                }
            } else {
                return { status: 'none', req: activeReq };
            }
        }

        // Query matches table
        const { data: matches, error: matchesErr } = await client
            .from('matches')
            .select('*')
            .or(`and(user_1_id.eq.${viewerId},user_2_id.eq.${targetId}),and(user_1_id.eq.${targetId},user_2_id.eq.${viewerId})`);

        if (matchesErr) throw matchesErr;

        if (matches && matches.length > 0) {
            return { status: 'accepted', req: null };
        }
        return { status: 'none', req: null };
    }

    // 3. Status Check 'none'
    console.log('==> Checking initial relationship status (should be "none")...');
    const statusInitA = await checkRelationship(clientA, userA.id, userB.id);
    if (statusInitA.status !== 'none') {
        throw new Error(`Expected initial status "none", got "${statusInitA.status}"`);
    }
    console.log('    Initial check: SUCCESS');

    // 4. Send interest request from A to B via Edge Function
    console.log('==> User A sending interest request to User B via Edge Function...');
    const { data: reqResult, error: reqErr } = await clientA.functions.invoke('submit-interest-request', {
        body: {
            candidateProfileId: userB.id,
            selectedReasonId: 'test-review-reason',
            personalizedReason: 'Hello, let us connect!',
            mediaType: 'none',
            mediaUrl: null,
            voiceTranscript: null,
            requestQualityScore: 85
        }
    });
    if (reqErr) throw reqErr;
    console.log('    Interest request submitted. Result:', reqResult);

    const requestId = reqResult.requestId;
    if (!requestId) {
        throw new Error('No requestId returned by submit-interest-request!');
    }

    // 5. Status Check 'sent' (for User A) & 'received' (for User B)
    console.log('==> Checking status from User A (sender)...');
    const statusAAfterSend = await checkRelationship(clientA, userA.id, userB.id);
    if (statusAAfterSend.status !== 'sent') {
        throw new Error(`Expected status "sent", got "${statusAAfterSend.status}"`);
    }
    console.log('    User A check: SUCCESS (sent)');

    console.log('==> Checking status from User B (receiver)...');
    const statusBAfterSend = await checkRelationship(clientB, userB.id, userA.id);
    if (statusBAfterSend.status !== 'received') {
        throw new Error(`Expected status "received", got "${statusBAfterSend.status}"`);
    }
    console.log('    User B check: SUCCESS (received)');

    // 6. User B accepts the request via Edge Function
    console.log('==> User B accepting interest request via Edge Function...');
    const { data: responseFunc, error: funcErr } = await clientB.functions.invoke('respond-interest-request', {
        body: { requestId, action: 'accept' }
    });
    if (funcErr) throw funcErr;
    console.log('    Edge function respond-interest-request response:', responseFunc);

    // 7. Status Check 'accepted' (both sides)
    console.log('==> Verifying accepted status for User A...');
    const statusAAfterAccept = await checkRelationship(clientA, userA.id, userB.id);
    if (statusAAfterAccept.status !== 'accepted') {
        throw new Error(`Expected status "accepted", got "${statusAAfterAccept.status}"`);
    }
    console.log('    User A accepted check: SUCCESS');

    console.log('==> Verifying accepted status for User B...');
    const statusBAfterAccept = await checkRelationship(clientB, userB.id, userA.id);
    if (statusBAfterAccept.status !== 'accepted') {
        throw new Error(`Expected status "accepted", got "${statusBAfterAccept.status}"`);
    }
    console.log('    User B accepted check: SUCCESS');

    // 8. Cleanup test accounts
    console.log('==> Cleaning up test profiles and auth records...');
    await adminClient.from('profiles').delete().in('id', [userA.id, userB.id]);
    const { error: authDelA } = await adminClient.auth.admin.deleteUser(userA.id);
    const { error: authDelB } = await adminClient.auth.admin.deleteUser(userB.id);
    if (authDelA) console.warn('Failed to delete auth user A:', authDelA.message);
    if (authDelB) console.warn('Failed to delete auth user B:', authDelB.message);

    console.log('\n=========================================');
    console.log('✅ STEP 7 VERIFICATION PASSED SUCCESSFULLY!');
    console.log('=========================================');
}

main().catch((err) => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
});
