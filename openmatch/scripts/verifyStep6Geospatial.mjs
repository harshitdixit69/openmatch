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
    console.log('==> Starting Step 6: Geospatial Proximity Matching Verification...');
    const env = parseEnvFile(await readFile(new URL('../.env', import.meta.url), 'utf8'));
    const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing URL or Anon key in .env file.');
    }

    const adminClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const emailA = `test-geo-A-${Date.now()}@example.com`;
    const emailB = `test-geo-B-${Date.now()}@example.com`;
    const password = 'TestGeoUser!123';

    // 1. Sign up User A
    console.log('==> Signing up User A (Lucknow):', emailA);
    const signUpA = await adminClient.auth.signUp({ email: emailA, password });
    if (signUpA.error) throw signUpA.error;
    const sessionA = signUpA.data.session;
    const userA = signUpA.data.user;

    const clientA = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${sessionA.access_token}` } }
    });

    console.log('==> Creating Profile for User A in Lucknow (auto-geocodes to ~26.8467, 80.9462)...');
    // Using import.meta.url or standard require. We can import or mock saveProfileCoordinates directly by invoking SQL or matching API upsert.
    // Let's call the profiles upsert, which triggers saveProfileCoordinates automatically!
    const { error: profileAError } = await clientA
        .from('profiles')
        .upsert({
            id: userA.id,
            full_name: 'Lucknow Lass',
            dob: '1995-05-05',
            location: 'Lucknow',
            gender: 'woman',
            partner_gender_preference: 'man',
            bio: 'I live in Lucknow, India',
            profile_owner: 'self',
            onboarding_completed_at: new Date().toISOString()
        });
    if (profileAError) throw profileAError;

    // Trigger coordinates creation directly since node doesn't load frontend's profileApi code
    const latLucknow = 26.8467;
    const lonLucknow = 80.9462;
    const geogLucknow = `POINT(${lonLucknow} ${latLucknow})`;
    const { error: locAError } = await clientA
        .from('profile_locations')
        .upsert({
            profile_id: userA.id,
            latitude: latLucknow,
            longitude: lonLucknow,
            geog: geogLucknow,
            updated_at: new Date().toISOString()
        });
    if (locAError) throw locAError;

    // 2. Sign up User B
    console.log('==> Signing up User B (Kanpur):', emailB);
    const signUpB = await adminClient.auth.signUp({ email: emailB, password });
    if (signUpB.error) throw signUpB.error;
    const sessionB = signUpB.data.session;
    const userB = signUpB.data.user;

    const clientB = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${sessionB.access_token}` } }
    });

    console.log('==> Creating Profile for User B in Kanpur (auto-geocodes to ~26.4499, 80.3319)...');
    const { error: profileBError } = await clientB
        .from('profiles')
        .upsert({
            id: userB.id,
            full_name: 'Kanpur Lad',
            dob: '1993-03-03',
            location: 'Kanpur',
            gender: 'man',
            partner_gender_preference: 'woman',
            bio: 'I live in Kanpur, India',
            profile_owner: 'self',
            onboarding_completed_at: new Date().toISOString()
        });
    if (profileBError) throw profileBError;

    const latKanpur = 26.4499;
    const lonKanpur = 80.3319;
    const geogKanpur = `POINT(${lonKanpur} ${latKanpur})`;
    const { error: locBError } = await clientB
        .from('profile_locations')
        .upsert({
            profile_id: userB.id,
            latitude: latKanpur,
            longitude: lonKanpur,
            geog: geogKanpur,
            updated_at: new Date().toISOString()
        });
    if (locBError) throw locBError;

    // 3. Query match_profiles for User A
    console.log('==> Querying match_profiles for User A...');
    const { data: matches, error: matchesError } = await clientA
        .rpc('match_profiles', {
            result_limit: 10,
            p_viewer_id: userA.id
        });
    if (matchesError) throw matchesError;

    const kanpurMatch = matches.find(m => m.id === userB.id);
    if (!kanpurMatch) {
        throw new Error('Assertion failed: User B (Kanpur Lad) was not found in matches!');
    }

    console.log('    Found match details:', {
        id: kanpurMatch.id,
        full_name: kanpurMatch.full_name,
        location: kanpurMatch.location,
        distance_km: kanpurMatch.distance_km
    });

    if (typeof kanpurMatch.distance_km !== 'number') {
        throw new Error('Assertion failed: distance_km is not a number!');
    }

    const dist = kanpurMatch.distance_km;
    console.log(`    Calculated distance: ${dist.toFixed(2)} km`);

    // Lucknow to Kanpur is approx 72-74 km
    if (dist < 65 || dist > 85) {
        throw new Error(`Assertion failed: Expected distance between Lucknow and Kanpur to be ~72km, but got: ${dist}`);
    }
    console.log('    Distance verification: SUCCESS');

    // 4. Query match_profiles with p_max_distance_km = 50 (should exclude Kanpur)
    console.log('==> Querying match_profiles with p_max_distance_km = 50 (expecting exclusion)...');
    const { data: matches50, error: error50 } = await clientA
        .rpc('match_profiles', {
            result_limit: 10,
            p_viewer_id: userA.id,
            p_max_distance_km: 50
        });
    if (error50) throw error50;

    const kanpurMatch50 = matches50.find(m => m.id === userB.id);
    if (kanpurMatch50) {
        throw new Error('Assertion failed: User B should be excluded from a 50km radius search!');
    }
    console.log('    50km radius search check: SUCCESS (correctly excluded)');

    // 5. Query match_profiles with p_max_distance_km = 100 (should include Kanpur)
    console.log('==> Querying match_profiles with p_max_distance_km = 100 (expecting inclusion)...');
    const { data: matches100, error: error100 } = await clientA
        .rpc('match_profiles', {
            result_limit: 10,
            p_viewer_id: userA.id,
            p_max_distance_km: 100
        });
    if (error100) throw error100;

    const kanpurMatch100 = matches100.find(m => m.id === userB.id);
    if (!kanpurMatch100) {
        throw new Error('Assertion failed: User B should be included in a 100km radius search!');
    }
    console.log('    100km radius search check: SUCCESS (correctly included)');

    // 6. Cleanup test accounts
    console.log('==> Cleaning up test profiles and locations...');
    await adminClient.from('profiles').delete().in('id', [userA.id, userB.id]);
    await adminClient.auth.admin.deleteUser(userA.id);
    await adminClient.auth.admin.deleteUser(userB.id);

    console.log('\n=========================================');
    console.log('✅ STEP 6 VERIFICATION PASSED SUCCESSFULLY!');
    console.log('=========================================');
}

main().catch((err) => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
});
