#!/usr/bin/env node
/**
 * generatePromoVideo.mjs
 * ----------------------
 * Generates an OpenMatch promo video (a young woman promoting the app with
 * voiceover) using Google's Gemini / Veo video generation API.
 *
 * SETUP:
 *   npm install @google/genai
 *   export GEMINI_API_KEY="your_api_key_here"   # get one at https://aistudio.google.com/apikey
 *
 * RUN:
 *   node scripts/generatePromoVideo.mjs
 *
 * NOTE: Veo generates the visuals + native audio. Model names/params evolve —
 * if you get a model error, list models in AI Studio and update MODEL below.
 */

import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('❌ Missing GEMINI_API_KEY. Run: export GEMINI_API_KEY="..."');
  process.exit(1);
}

const MODEL = 'veo-3.0-generate-001'; // update if a newer Veo model is available

const PROMPT = `
A viral, high-energy 9:16 vertical Instagram Reel / TikTok UGC video of a charismatic, expressive 24-year-old Indian woman in casual trendy clothing (oversized blazer, AirPods) in a modern sunlit aesthetic room, speaking directly to camera in natural Hindi/Hinglish with genuine emotion.

EDITING & STYLE:
- Fast-paced UGC style, jump-cuts every 2-3 seconds, authentic handheld micro-motion, cinematic portrait depth-of-field.
- High-contrast kinetic auto-captions in Hinglish with bouncing yellow keyword highlights.
- Dynamic camera zooms on emotional reaction beats.
- Ambient energetic lo-fi Indian indie beat mixed softly beneath crisp speech.

SCENE-BY-SCENE BREAKDOWN (HINDI / HINGLISH VOICEOVER):
[0-3s] PATTERN INTERRUPT HOOK: She leans into camera with wide eyes in shock.
Captions: "₹3,000 diye aur photo abhi bhi BLURRED hai?! 💀"
VO (Hindi/Hinglish): "Yaar please mujhe batao main akeli nahi hoon jo shaadi apps ko ₹3,000 mahina deke thak chuki hoon... sirf ek BLURRED photo dekhne ke liye?!"

[3-8s] AGITATION: Eye-roll and sarcastic facepalm. Screen mockup showing red "CANCEL SUBSCRIPTION" overlay.
Captions: "Itne paise diye aur 2 min mein Ghost? 🤦‍♀️"
VO (Hindi/Hinglish): "Matlab itna mehenga subscription lo, message karo, aur samne wala 2 minute mein ghost kar deta hai!"

[8-17s] OPENMATCH REVEAL: Jump cut to her smiling excitedly, holding phone up with floating clean UI mockup.
Captions: "Meet OpenMatch ✨ 100% Free Browse & Chat"
VO (Hindi/Hinglish): "Fir meri bestie ne mujhe bataya OpenMatch ke baare mein! Yahan SAARI photos crystal clear dikhti hain bina kisi blur ke. Aur matching aur chatting? 100% FREE!"

[17-24s] AI SAFETY & ₹99 UNLOCK: Quick zoom on screen showing AI safety shield blocking risky contact leaks.
Captions: "AI Safety Shield 🛡️ Only ₹99 jab dono ready hon!"
VO (Hindi/Hinglish): "Inka smart AI creeps aur spam messages ko filter karta hai. Aur koi monthly loot nahi hai—sirf ₹99 ka ek chhota sa unlock jab aap DONO sach mein connect karna chahte ho."

[24-30s] HIGH-ENERGY CTA: Confident wink and smile, pointing downwards toward the download link.
Captions: "Link bio mein hai! Abhi download karo 👆"
VO (Hindi/Hinglish): "Toh faltu ke monthly plans pe paise barbad karna band karo. Bio mein link hai ya Play Store se OpenMatch download karo... Thank me later!"
`.trim();

async function main() {
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  console.log('🎬 Requesting video generation from Veo...');
  let operation = await ai.models.generateVideos({
    model: MODEL,
    prompt: PROMPT,
    config: {
      aspectRatio: '9:16',
      // numberOfVideos: 1,
    },
  });

  // Poll until the long-running operation completes.
  while (!operation.done) {
    console.log('⏳ Rendering... (checking again in 10s)');
    await new Promise((r) => setTimeout(r, 10_000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) {
    console.error('❌ No video returned. Full response:');
    console.dir(operation.response, { depth: 5 });
    process.exit(1);
  }

  const outPath = 'openmatch_promo.mp4';
  await ai.files.download({ file: video, downloadPath: outPath });
  console.log(`✅ Done! Saved to ${outPath}`);
  console.log(`   Size: ${(fs.statSync(outPath).size / 1e6).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error('❌ Generation failed:', err);
  process.exit(1);
});
