import { readFile } from 'node:fs/promises';

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
    console.log('==> Triggering Stripe Webhook Idempotency Unit Test on Supabase Edge runtime...');
    
    let env = {};
    try {
        env = parseEnvFile(await readFile(new URL('../.env', import.meta.url), 'utf8'));
    } catch (e) {
        console.error('Error reading .env file:', e.message);
        process.exit(1);
    }

    const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
    const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const functionsBaseUrl = supabaseUrl.replace('.supabase.co', '.functions.supabase.co');

    if (!supabaseUrl || !anonKey) {
        throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env file.');
    }

    const response = await fetch(`${functionsBaseUrl}/test-subscription-fulfillment`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${anonKey}`
        }
    });

    const data = await response.text();
    console.log("Response Status:", response.status);
    console.log("Response Body:", data);

    try {
        const json = JSON.parse(data);
        if (json.success) {
            console.log("==> IDEMPOTENCY UNIT TEST PASSED SUCCESSFULLY! 🎉");
            // Let the event loop exit naturally to avoid win32 async handle assertions
        } else {
            console.error("==> IDEMPOTENCY UNIT TEST FAILED:", json.error || json);
            process.exit(1);
        }
    } catch (e) {
        console.error("Failed to parse response JSON:", e);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
