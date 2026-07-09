// Temporary smoke test for the Cisco-aware chat adapter.
// Run with: deno run --allow-env --allow-net _ciscoSmokeTest.ts
// This imports the REAL adapter used by the edge functions.
import { callAzureJsonChat, callTextChat, hasChatProvider, getCiscoConfig } from './azureChat.ts';

console.log('hasChatProvider():', hasChatProvider());
console.log('Cisco configured:', Boolean(getCiscoConfig()));

// 1) JSON mode (used by fit-friction, onboarding-copilot, chat-prompts, request-reasons)
const jsonResult = await callAzureJsonChat({
    maxTokens: 400,
    messages: [
        {
            role: 'system',
            content:
                'You are a matchmaking analyst. Return only JSON with keys summary (string), fitPoints (array of strings), frictionPoints (array of strings).',
        },
        {
            role: 'user',
            content: 'Profile A: loves hiking, values family, software engineer in Pune.\nProfile B: enjoys trekking, close to family, teacher in Mumbai.',
        },
    ],
});
console.log('\n[JSON MODE] parsed object keys:', Object.keys(jsonResult));
console.log('[JSON MODE] summary:', jsonResult.summary);
console.log('[JSON MODE] fitPoints:', JSON.stringify(jsonResult.fitPoints));

// 2) Text mode (used by compatibility-summary)
const textResult = await callTextChat({
    maxTokens: 160,
    temperature: 0.4,
    messages: [
        {
            role: 'system',
            content:
                'You are an expert matchmaker. Return exactly two plain-text sentences, no markdown, no labels.',
        },
        {
            role: 'user',
            content: 'Profile A: loves hiking and family.\nProfile B: enjoys trekking and is family-oriented.',
        },
    ],
});
console.log('\n[TEXT MODE] summary:', textResult);

console.log('\n✅ Cisco adapter smoke test passed.');
