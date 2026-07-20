const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Read env variables manually
let envContent = '';
try {
  envContent = fs.readFileSync('.env', 'utf8');
} catch (err) {
  console.log("Could not load .env file:", err.message);
}

const env = {};
envContent.replace(/\r/g, '').split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
  }
});

const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const ivamId = '8e4ecc6a-02dc-4d7f-ab8f-07dfa2847e22';
  
  console.log(`Setting ivam's tier to assisted in Supabase...`);
  
  // Update profiles
  const { data: profileData, error: profileErr } = await supabase
    .from('profiles')
    .update({
      subscription_tier: 'assisted',
      membership_tier: 'assisted'
    })
    .eq('id', ivamId)
    .select();
    
  if (profileErr) {
    console.error("Error upgrading profiles:", profileErr.message);
    return;
  }
  
  // Clear any existing completed session to force the INTAKE_IN_PROGRESS chat flow
  const { error: sessionErr } = await supabase
    .from('assisted_concierge_sessions')
    .delete()
    .eq('user_id', ivamId);

  if (sessionErr) {
    console.log("Error clearing session:", sessionErr.message);
  }
  
  console.log("Successfully upgraded ivam to assisted tier! Profile:", profileData);
}

run();
