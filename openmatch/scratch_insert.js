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

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const ivamId = '8e4ecc6a-02dc-4d7f-ab8f-07dfa2847e22';
  const samId = '2d7bbeeb-ab0d-4a9f-988c-9c93a0f4cb4a';
  const riyaId = 'f02e3096-ca47-4067-af87-d6b6a342b090';

  try {
    console.log("Inserting matches and interest requests...");

    // 1. Insert Match for Sam (Connected)
    const [samUser1, samUser2] = ivamId < samId ? [ivamId, samId] : [samId, ivamId];
    const { error: mSamErr } = await supabase
      .from('matches')
      .upsert({
        user_1_id: samUser1,
        user_2_id: samUser2,
        status: 'connected',
      }, { onConflict: 'user_1_id,user_2_id' });
    if (mSamErr) throw mSamErr;

    // Insert Interest Request for Sam (Accepted)
    const { error: rSamErr } = await supabase
      .from('interest_requests')
      .insert({
        sender_id: ivamId,
        receiver_id: samId,
        status: 'accepted',
        reason_id: 'custom',
        personalized_reason: 'Elite concierge match by Elizabeth.',
      });
    if (rSamErr) console.log("Interest request for Sam might already exist or: ", rSamErr.message);

    // 2. Insert Match for Riya (Pending)
    const [riyaUser1, riyaUser2] = ivamId < riyaId ? [ivamId, riyaId] : [riyaId, ivamId];
    const { error: mRiyaErr } = await supabase
      .from('matches')
      .upsert({
        user_1_id: riyaUser1,
        user_2_id: riyaUser2,
        status: 'pending',
      }, { onConflict: 'user_1_id,user_2_id' });
    if (mRiyaErr) throw mRiyaErr;

    // Insert Interest Request for Riya (Sent / Awaiting Handshake)
    const { error: rRiyaErr } = await supabase
      .from('interest_requests')
      .insert({
        sender_id: ivamId,
        receiver_id: riyaId,
        status: 'sent',
        reason_id: 'custom',
        personalized_reason: 'Elite concierge match by Elizabeth.',
      });
    if (rRiyaErr) console.log("Interest request for Riya might already exist or: ", rRiyaErr.message);

    console.log("Successfully seeded handshake relationships!");
  } catch (err) {
    console.error("Error seeding handshake data:", err);
  }
}

run();
