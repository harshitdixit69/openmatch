console.log("SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "PRESENT" : "MISSING");
console.log("STRIPE_WEBHOOK_SECRET:", process.env.STRIPE_WEBHOOK_SECRET ? "PRESENT" : "MISSING");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "PRESENT" : "MISSING");
console.log("Keys in process.env:", Object.keys(process.env).filter(k => k.toLowerCase().includes('supabase') || k.toLowerCase().includes('key') || k.toLowerCase().includes('secret')));
