import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Parse .env file manually to avoid third-party dotenv dependency
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
        const match = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
            const key = match[1];
            let value = match[2] || '';
            // Remove wrapping quotes if any
            if (value.length > 0 && value.startsWith('"') && value.endsWith('"')) {
                value = value.substring(1, value.length - 1);
            } else if (value.length > 0 && value.startsWith("'") && value.endsWith("'")) {
                value = value.substring(1, value.length - 1);
            }
            process.env[key] = value.trim();
        }
    });
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Error: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be defined in the .env file.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testPagination() {
    console.log('--------------------------------------------------');
    console.log('STARTING IN-DEPTH MATCHMAKING PAGINATION TEST');
    console.log('--------------------------------------------------');

    const viewerId = '53ac538b-9231-4357-ad00-9f5940300916'; // Harshit
    console.log(`Running test as Viewer: ${viewerId}`);

    // 1. Fetch Page 1 (limit 3, offset 0)
    console.log('\n--- FETCHING PAGE 1 (Limit: 3, Offset: 0) ---');
    const { data: page1, error: err1 } = await supabase.rpc('match_profiles', {
        result_limit: 3,
        p_viewer_id: viewerId,
        p_offset: 0,
    });

    if (err1) {
        console.error('Failed to fetch page 1:', err1);
        process.exit(1);
    }

    console.log(`Returned count: ${page1.length}`);
    page1.forEach((p: any, idx: number) => {
        console.log(`  [${idx + 1}] Name: ${p.full_name}, ID: ${p.id}, Similarity: ${p.similarity}`);
    });

    if (page1.length === 0) {
        console.log('No profiles returned. Cannot test pagination further. Add more test profiles first.');
        process.exit(0);
    }

    // 2. Fetch Page 2 (limit 3, offset 3)
    console.log('\n--- FETCHING PAGE 2 (Limit: 3, Offset: 3) ---');
    const { data: page2, error: err2 } = await supabase.rpc('match_profiles', {
        result_limit: 3,
        p_viewer_id: viewerId,
        p_offset: 3,
    });

    if (err2) {
        console.error('Failed to fetch page 2:', err2);
        process.exit(1);
    }

    console.log(`Returned count: ${page2.length}`);
    page2.forEach((p: any, idx: number) => {
        console.log(`  [${idx + 1}] Name: ${p.full_name}, ID: ${p.id}, Similarity: ${p.similarity}`);
    });

    // 3. Verify No Overlap between Page 1 and Page 2
    console.log('\n--- VERIFYING PAGINATION UNIQUENESS & OVERLAP ---');
    const page1Ids = new Set(page1.map((p: any) => p.id));
    const overlapIds: string[] = [];

    page2.forEach((p: any) => {
        if (page1Ids.has(p.id)) {
            overlapIds.push(p.full_name);
        }
    });

    if (overlapIds.length > 0) {
        console.error(`❌ FAILURE: Found overlapping profiles between page 1 and page 2: ${overlapIds.join(', ')}`);
        process.exit(1);
    } else {
        console.log('✅ SUCCESS: Page 1 and Page 2 are completely disjoint (0 overlaps)!');
    }

    // 4. Fetch Page 3 (limit 10, offset 6) to drain the rest of the pool
    console.log('\n--- FETCHING PAGE 3 (Limit: 10, Offset: 6) ---');
    const { data: page3, error: err3 } = await supabase.rpc('match_profiles', {
        result_limit: 10,
        p_viewer_id: viewerId,
        p_offset: 6,
    });

    if (err3) {
        console.error('Failed to fetch page 3:', err3);
        process.exit(1);
    }

    console.log(`Returned count: ${page3.length}`);
    page3.forEach((p: any, idx: number) => {
        console.log(`  [${idx + 1}] Name: ${p.full_name}, ID: ${p.id}, Similarity: ${p.similarity}`);
    });

    const page2Ids = new Set(page2.map((p: any) => p.id));
    page3.forEach((p: any) => {
        if (page1Ids.has(p.id) || page2Ids.has(p.id)) {
            overlapIds.push(p.full_name);
        }
    });

    if (overlapIds.length > 0) {
        console.error(`❌ FAILURE: Found overlapping profiles in page 3: ${overlapIds.join(', ')}`);
        process.exit(1);
    } else {
        console.log('✅ SUCCESS: Page 3 has 0 overlaps with Page 1 and Page 2!');
    }

    // 5. Fetch Page 4 (limit 10, offset 100) to confirm empty results beyond limit
    console.log('\n--- FETCHING PAGE 4 (Offset: 100 - out of bounds) ---');
    const { data: page4, error: err4 } = await supabase.rpc('match_profiles', {
        result_limit: 10,
        p_viewer_id: viewerId,
        p_offset: 100,
    });

    if (err4) {
        console.error('Failed to fetch page 4:', err4);
        process.exit(1);
    }

    console.log(`Returned count: ${page4.length}`);
    if (page4.length === 0) {
        console.log('✅ SUCCESS: Out of bounds offset correctly returned an empty list!');
    } else {
        console.error('❌ FAILURE: Out of bounds offset returned profiles.');
        process.exit(1);
    }

    console.log('\n--------------------------------------------------');
    console.log('ALL IN-DEPTH PAGINATION TESTS PASSED SUCCESSFULLY!');
    console.log('--------------------------------------------------');
}

testPagination().catch((err) => {
    console.error('Unhandled script rejection:', err);
    process.exit(1);
});
