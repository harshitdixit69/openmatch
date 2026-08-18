import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://oxdhkjernhpkscrideby.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94ZGhramVybmhwa3NjcmlkZWJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTU1ODU0OCwiZXhwIjoyMDk1MTM0NTQ4fQ.6busKsR95s7N-Sgpg6C6UDOcTXZoJMgYEfbs2ZEaVno';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

async function main() {
    const args = process.argv.slice(2);
    const identifier = args[0]; // Email, User UUID, or Name
    const newCredits = args[1] !== undefined ? parseInt(args[1], 10) : 5; // Default 5 credits

    if (!identifier) {
        console.log(`
Usage:
  node scripts/resetUserSpotlight.mjs <email_or_user_id_or_name> [credits_count]

Examples:
  node scripts/resetUserSpotlight.mjs "harshit" 5
  node scripts/resetUserSpotlight.mjs "user@example.com" 10
  node scripts/resetUserSpotlight.mjs "53ac538b-9231-4357-ad00-9f5940300916" 3
        `);

        // List recent profiles
        const { data: recentProfiles } = await supabase
            .from('profiles')
            .select('id, full_name, spotlights_remaining, spotlight_active_until, subscription_tier')
            .order('created_at', { ascending: false })
            .limit(5);

        console.log('\n--- Recent Profiles in Database ---');
        console.table(recentProfiles);
        return;
    }

    console.log(`Searching for user: "${identifier}"...`);

    // 1. Search by UUID if valid UUID format
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    let targetProfile = null;

    if (isUuid) {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, spotlights_remaining, spotlight_active_until, subscription_tier')
            .eq('id', identifier)
            .maybeSingle();

        if (!error && data) targetProfile = data;
    }

    // 2. Search by Email in auth.users if not found by UUID
    if (!targetProfile) {
        const { data: authUsers, error: authErr } = await supabase.auth.admin.listUsers();
        if (!authErr && authUsers?.users) {
            const matchedUser = authUsers.users.find(
                (u) => u.email?.toLowerCase() === identifier.toLowerCase()
            );
            if (matchedUser) {
                const { data } = await supabase
                    .from('profiles')
                    .select('id, full_name, spotlights_remaining, spotlight_active_until, subscription_tier')
                    .eq('id', matchedUser.id)
                    .maybeSingle();
                if (data) targetProfile = data;
            }
        }
    }

    // 3. Search by Name in profiles
    if (!targetProfile) {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, spotlights_remaining, spotlight_active_until, subscription_tier')
            .ilike('full_name', `%${identifier}%`)
            .limit(1)
            .maybeSingle();

        if (!error && data) targetProfile = data;
    }

    if (!targetProfile) {
        console.error(`❌ User not found with identifier: "${identifier}"`);
        return;
    }

    console.log('\nFound Target Profile:');
    console.log(`- ID: ${targetProfile.id}`);
    console.log(`- Name: ${targetProfile.full_name}`);
    console.log(`- Current Spotlights: ${targetProfile.spotlights_remaining}`);
    console.log(`- Spotlight Active Until: ${targetProfile.spotlight_active_until || 'None'}`);
    console.log(`- Tier: ${targetProfile.subscription_tier}`);

    // Update spotlights
    const { data: updatedProfile, error: updateErr } = await supabase
        .from('profiles')
        .update({
            spotlights_remaining: newCredits,
            spotlight_active_until: null, // clear active timer so it can be re-activated cleanly
        })
        .eq('id', targetProfile.id)
        .select('id, full_name, spotlights_remaining, spotlight_active_until')
        .single();

    if (updateErr) {
        console.error('❌ Failed to update spotlights:', updateErr);
        return;
    }

    console.log('\n✅ Spotlight Reset Successful!');
    console.log(`- Name: ${updatedProfile.full_name}`);
    console.log(`- New Spotlights Remaining: ${updatedProfile.spotlights_remaining}`);
    console.log(`- Spotlight Active Timer: Cleared (ready to activate)`);
}

main().catch(console.error);
