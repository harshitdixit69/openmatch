import { createClient } from '@supabase/supabase-js';
import { fakerEN_IN as faker } from '@faker-js/faker';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
    process.exit(1);
}

const TOTAL_USERS = Number(process.env.TOTAL_USERS ?? 5000);
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 50);

const GENDERS = ['Woman', 'Man', 'Non-binary'];
const PARTNER_PREFERENCES = ['Woman', 'Man', 'Non-binary', 'Everyone'];

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

function pickPartnerPreference(gender) {
    if (gender === 'Man') return 'Woman';
    if (gender === 'Woman') return 'Man';
    return faker.helpers.arrayElement(PARTNER_PREFERENCES);
}

async function createMockUser() {
    const email = faker.internet
        .email({ provider: `mock.${faker.string.alphanumeric(6)}.test` })
        .toLowerCase();
    const password = faker.internet.password({ length: 16 });

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });

    if (authError || !authData?.user) {
        return { ok: false, reason: 'auth', error: authError?.message ?? 'no user returned' };
    }

    const uid = authData.user.id;
    const gender = faker.helpers.arrayElement(GENDERS);
    const dob = faker.date.birthdate({ min: 22, max: 45, mode: 'age' });

    const profile = {
        id: uid,
        full_name: faker.person.fullName(),
        gender,
        partner_gender_preference: pickPartnerPreference(gender),
        photo_urls: [faker.image.avatarGitHub()],
        dob: dob.toISOString().slice(0, 10),
        location: `${faker.location.city()}, ${faker.location.state()}`,
        bio: faker.lorem.sentences({ min: 1, max: 3 }),
        preferences: faker.lorem.sentence(),
        height_cm: faker.number.int({ min: 150, max: 195 }),
        profile_owner: 'self',
        onboarding_completed_at: new Date().toISOString(),
    };

    const { error: profileError } = await supabase.from('profiles').insert(profile);

    if (profileError) {
        await supabase.auth.admin.deleteUser(uid);
        return { ok: false, reason: 'profile', error: profileError.message };
    }

    const { error: scoreError } = await supabase.from('profile_reliability_scores').insert({
        profile_id: uid,
        response_reliability_score: faker.number.int({ min: 60, max: 100 }),
        ghost_risk_score: faker.number.int({ min: 0, max: 40 }),
    });

    if (scoreError) {
        await supabase.auth.admin.deleteUser(uid);
        return { ok: false, reason: 'reliability_scores', error: scoreError.message };
    }

    return { ok: true, uid };
}

async function main() {
    console.log(`Seeding ${TOTAL_USERS} users in batches of ${BATCH_SIZE}...`);
    let success = 0;
    let failed = 0;

    for (let start = 0; start < TOTAL_USERS; start += BATCH_SIZE) {
        const size = Math.min(BATCH_SIZE, TOTAL_USERS - start);
        const results = await Promise.all(Array.from({ length: size }, () => createMockUser()));

        for (const result of results) {
            if (result.ok) {
                success += 1;
            } else {
                failed += 1;
                console.error(`Failed (${result.reason}): ${result.error}`);
            }
        }

        console.log(`Progress: ${Math.min(start + size, TOTAL_USERS)}/${TOTAL_USERS} (ok: ${success}, failed: ${failed})`);
    }

    console.log(`Done. Created ${success} users, ${failed} failures.`);
}

main().catch((error) => {
    console.error('Seeder crashed:', error);
    process.exit(1);
});
