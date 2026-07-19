const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://oxdhkjernhpkscrideby.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94ZGhramVybmhwa3NjcmlkZWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTg1NDgsImV4cCI6MjA5NTEzNDU0OH0.duzjLyOIQxQ6PbsII6QonSvAXKi_qhdjbmH094-0gsw'
);

async function main() {
  // Check profiles columns
  const { data: profiles, error: err1 } = await supabase
    .from('profiles')
    .select('*')
    .limit(1);

  if (err1) {
    console.error('Error querying profiles:', err1);
  } else {
    console.log('Columns in profiles:', Object.keys(profiles[0] || {}));
  }

  // Check vip_bot_sessions
  const { data: sessions, error: err2 } = await supabase
    .from('vip_bot_sessions')
    .select('*')
    .limit(1);
  if (err2) {
    console.log('vip_bot_sessions does not exist or failed:', err2.message);
  } else {
    console.log('vip_bot_sessions exists! Columns:', Object.keys(sessions[0] || {}));
  }

  // Check vip_outreach_logs
  const { data: logs, error: err3 } = await supabase
    .from('vip_outreach_logs')
    .select('*')
    .limit(1);
  if (err3) {
    console.log('vip_outreach_logs does not exist or failed:', err3.message);
  } else {
    console.log('vip_outreach_logs exists! Columns:', Object.keys(logs[0] || {}));
  }
}

main();
