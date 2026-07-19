const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Read env variables manually
try {
  const envContent = fs.readFileSync('.env', 'utf8');
  envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key] = val;
    }
  });
} catch (err) {
  console.log("Could not load .env file manually:", err.message);
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase URL or Key! URL:", supabaseUrl, "Key:", supabaseKey);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  try {
    console.log("=== PROFILES ===");
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id, full_name, subscription_tier, unlock_credits_remaining');
    if (pErr) throw pErr;
    console.log(JSON.stringify(profiles, null, 2));

    console.log("\n=== MATCHES ===");
    const { data: matches, error: mErr } = await supabase
      .from('matches')
      .select('*');
    if (mErr) throw mErr;
    console.log(JSON.stringify(matches, null, 2));

    console.log("\n=== INTEREST REQUESTS ===");
    const { data: reqs, error: rErr } = await supabase
      .from('interest_requests')
      .select('*');
    if (rErr) throw rErr;
    console.log(JSON.stringify(reqs, null, 2));

  } catch (err) {
    console.error("Error running query:", err);
  }
}

run();
