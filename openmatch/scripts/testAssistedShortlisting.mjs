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
    console.log('==> Starting Assisted Concierge Shortlisting E2E Verification...');
    const env = parseEnvFile(await readFile(new URL('../.env', import.meta.url), 'utf8'));
    const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const functionsBaseUrl = supabaseUrl.replace('.supabase.co', '.functions.supabase.co');

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing URL or Anon key in .env file.');
    }

    const client = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const timestamp = Date.now();
    const emailA = `test-concierge-a-${timestamp}@example.com`;
    const emailB = `test-concierge-b-${timestamp}@example.com`;
    const password = 'TestConcierge!123';

    // 1. Sign up user A (intake candidate)
    console.log('==> Signing up User A (Seeker):', emailA);
    const signUpA = await client.auth.signUp({ email: emailA, password });
    if (signUpA.error) throw signUpA.error;
    const sessionA = signUpA.data.session;
    const userA = signUpA.data.user;

    const userClientA = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${sessionA.access_token}` } }
    });

    console.log('==> Setting profile details for User A...');
    const { error: profileErrorA } = await userClientA
        .from('profiles')
        .upsert({
            id: userA.id,
            full_name: 'Seeker Alice',
            dob: '1995-05-05',
            location: 'Mumbai',
            gender: 'woman',
            partner_gender_preference: 'man',
            pref_age_min: 25,
            pref_age_max: 35,
            bio: 'Looking for a serious partner.',
            preferences: 'Caring and career-oriented.',
            occupation: 'Software Engineer',
            education: 'B.Tech',
            diet: 'Vegetarian',
            smokes: false,
            drinks_alcohol: false,
            profile_owner: 'self',
            onboarding_completed_at: new Date().toISOString()
        });
    if (profileErrorA) throw profileErrorA;

    console.log('==> Initializing Seeker session...');
    const { data: sessionIdA, error: rpcErrorA } = await userClientA.rpc('initialize_assisted_session', {
        p_user_id: userA.id
    });
    if (rpcErrorA) throw rpcErrorA;

    // 2. Sign up user B (match candidate)
    console.log('==> Signing up User B (Candidate):', emailB);
    const signUpB = await client.auth.signUp({ email: emailB, password });
    if (signUpB.error) throw signUpB.error;
    const sessionB = signUpB.data.session;
    const userB = signUpB.data.user;

    const userClientB = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${sessionB.access_token}` } }
    });

    console.log('==> Setting profile details for User B...');
    const { error: profileErrorB } = await userClientB
        .from('profiles')
        .upsert({
            id: userB.id,
            full_name: 'Match Bob',
            dob: '1993-08-15',
            location: 'Mumbai',
            gender: 'man',
            partner_gender_preference: 'woman',
            pref_age_min: 22,
            pref_age_max: 30,
            bio: 'Outgoing, love outdoor games.',
            preferences: 'Independent and intelligent.',
            occupation: 'Product Manager',
            education: 'MBA',
            diet: 'Vegetarian',
            smokes: false,
            drinks_alcohol: false,
            profile_owner: 'self',
            onboarding_completed_at: new Date().toISOString()
        });
    if (profileErrorB) throw profileErrorB;

    console.log('==> Initializing Candidate session...');
    const { data: sessionIdB, error: rpcErrorB } = await userClientB.rpc('initialize_assisted_session', {
        p_user_id: userB.id
    });
    if (rpcErrorB) throw rpcErrorB;

    // 3. Generate embedding for Bob (Candidate)
    console.log('==> Running intake for Candidate Bob to generate embedding...');
    const responseB = await fetch(`${functionsBaseUrl}/process-concierge-intake`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionB.access_token}`
        },
        body: JSON.stringify({
            transcript: 'Bob: I am a vegetarian Product Manager based in Mumbai. I enjoy sports and outdoor activities. I want a partner who values work-life balance.'
        })
    });
    if (!responseB.ok) {
        const errText = await responseB.text();
        throw new Error(`Candidate intake failed: ${errText}`);
    }
    const resJsonB = await responseB.json();
    console.log('    Candidate Bob status:', resJsonB.status);

    // 4. Run intake for Seeker Alice
    console.log('==> Running intake for Seeker Alice...');
    const responseA = await fetch(`${functionsBaseUrl}/process-concierge-intake`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionA.access_token}`
        },
        body: JSON.stringify({
            transcript: 'Alice: I am a vegetarian Software Engineer in Mumbai. I am looking for a partner in Mumbai who loves outdoor activities and values career balance.'
        })
    });
    if (!responseA.ok) {
        const errText = await responseA.text();
        throw new Error(`Seeker intake failed: ${errText}`);
    }
    const resJsonA = await responseA.json();
    console.log('    Seeker Alice status:', resJsonA.status);

    // Verify session status is now AWAITING_SHORTLIST
    const { data: sessionRecordA, error: fetchSessionError } = await userClientA
        .from('assisted_concierge_sessions')
        .select('status')
        .eq('id', sessionIdA)
        .single();
    if (fetchSessionError) throw fetchSessionError;
    console.log('    Seeker Alice session status in DB:', sessionRecordA.status);
    if (sessionRecordA.status !== 'AWAITING_SHORTLIST') {
        throw new Error(`Expected session status AWAITING_SHORTLIST, got ${sessionRecordA.status}`);
    }

    // 5. Invoke generate-assisted-shortlist Edge Function
    console.log('==> Invoking generate-assisted-shortlist Edge Function for Seeker Alice...');
    const responseShortlist = await fetch(`${functionsBaseUrl}/generate-assisted-shortlist`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionA.access_token}`
        }
    });

    if (!responseShortlist.ok) {
        const errText = await responseShortlist.text();
        throw new Error(`Shortlist generation failed: ${errText}`);
    }
    const shortlistJson = await responseShortlist.json();
    console.log('    Shortlist generated successfully:', shortlistJson);

    // Verify session status is now SHORTLIST_READY
    const { data: sessionRecordReady, error: fetchSessionReadyError } = await userClientA
        .from('assisted_concierge_sessions')
        .select('status')
        .eq('id', sessionIdA)
        .single();
    if (fetchSessionReadyError) throw fetchSessionReadyError;
    console.log('    Seeker Alice session status after shortlisting:', sessionRecordReady.status);
    if (sessionRecordReady.status !== 'SHORTLIST_READY') {
        throw new Error(`Expected session status SHORTLIST_READY, got ${sessionRecordReady.status}`);
    }

    // 6. Fetch shortlist items & verify candidate Bob is in the list
    console.log('==> Querying shortlist items from DB...');
    const { data: shortlist, error: fetchShortlistError } = await userClientA
        .from('assisted_shortlists')
        .select('id')
        .eq('session_id', sessionIdA)
        .single();
    if (fetchShortlistError) throw fetchShortlistError;

    const { data: items, error: fetchItemsError } = await userClientA
        .from('assisted_shortlist_items')
        .select(`
            id,
            candidate_id,
            match_score,
            match_rationale,
            feedback_status,
            profiles (
                id,
                full_name,
                location
            )
        `)
        .eq('shortlist_id', shortlist.id);
    if (fetchItemsError) throw fetchItemsError;

    console.log(`    Found ${items.length} candidates in the shortlist:`);
    let foundBob = false;
    let targetItemId = '';
    for (const item of items) {
        console.log(`    - Name: ${item.profiles.full_name}, Location: ${item.profiles.location}, Score: ${item.match_score?.toFixed(4)}, Pitch: "${item.match_rationale}"`);
        if (item.candidate_id === userB.id) {
            foundBob = true;
            targetItemId = item.id;
        }
    }

    if (!foundBob) {
        throw new Error('E2E Fail: Candidate Bob was not recommended in the curated shortlist.');
    }
    console.log('    E2E Success: Candidate Bob successfully matched and curated!');

    // 7. Update feedback status on the item
    console.log('==> Simulating Seeker Alice Liking Candidate Bob...');
    const { error: feedbackError } = await userClientA
        .from('assisted_shortlist_items')
        .update({ feedback_status: 'liked' })
        .eq('id', targetItemId);
    if (feedbackError) throw feedbackError;

    // Verify feedback updated in DB
    const { data: updatedItem, error: fetchUpdatedItemError } = await userClientA
        .from('assisted_shortlist_items')
        .select('feedback_status')
        .eq('id', targetItemId)
        .single();
    if (fetchUpdatedItemError) throw fetchUpdatedItemError;
    console.log('    Feedback status in DB:', updatedItem.feedback_status);
    if (updatedItem.feedback_status !== 'liked') {
        throw new Error(`Expected feedback status "liked", got ${updatedItem.feedback_status}`);
    }

    console.log('==> ALL E2E VERIFICATIONS PASSED SUCCESSFULLY!');
}

main().catch((err) => {
    console.error('E2E Verification Failed:', err);
    process.exit(1);
});
