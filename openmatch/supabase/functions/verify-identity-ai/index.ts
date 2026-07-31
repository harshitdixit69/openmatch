import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { idPhotoUrl, selfiePhotoUrl, expectedName, expectedDob } = await req.json();

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('EXPO_PUBLIC_GEMINI_API_KEY');
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({
          verified: false,
          confidenceScore: 0,
          reason: 'GEMINI_API_KEY environment variable is not configured on Supabase Edge Function.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const promptText = `
You are an AI Identity & Security Auditor for OpenMatch matrimonial app in India.
Analyze the two image URLs provided:
1. ID Photo URL: ${idPhotoUrl}
2. Selfie Photo URL: ${selfiePhotoUrl}

Candidate Expected Full Name: "${expectedName || ''}"
Candidate Expected DOB: "${expectedDob || ''}"

Perform the following 4 strict checks:
1. Confirm if Image 1 is a valid Indian Government ID card (Aadhaar, PAN Card, Driving License, Passport, Voter ID).
2. Extract the Name and Date of Birth printed on the ID document.
3. Compare the extracted name on the document with "${expectedName || ''}" (allow minor spelling/middle name variations).
4. Perform facial biometric comparison between the face photo on the ID card and the live selfie in Image 2.

Return ONLY a valid JSON object matching this schema:
{
  "isValidGovtId": boolean,
  "docType": "Aadhaar" | "PAN" | "Passport" | "Driving License" | "Voter ID" | "Unknown",
  "extractedName": string,
  "extractedDob": string,
  "nameMatches": boolean,
  "faceMatches": boolean,
  "confidenceScore": number (0-100),
  "reason": "Clear explanation of verification outcome"
}
`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: promptText }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return new Response(
        JSON.stringify({
          verified: false,
          confidenceScore: 0,
          reason: `Gemini API HTTP Error ${res.status}: ${errText}`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const resJson = await res.json();
    const rawText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return new Response(
        JSON.stringify({
          verified: false,
          confidenceScore: 0,
          reason: 'AI Vision model returned an empty response.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const parsed = JSON.parse(rawText);
    const isApproved =
      Boolean(parsed.isValidGovtId) &&
      Boolean(parsed.nameMatches) &&
      Boolean(parsed.faceMatches) &&
      (parsed.confidenceScore ?? 0) >= 80;

    return new Response(
      JSON.stringify({
        verified: isApproved,
        confidenceScore: parsed.confidenceScore ?? (isApproved ? 92 : 30),
        extractedName: parsed.extractedName,
        extractedDob: parsed.extractedDob,
        reason: parsed.reason || (isApproved ? 'Identity verified successfully by AI Vision.' : 'Verification failed AI security checks.'),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        verified: false,
        confidenceScore: 0,
        reason: `Server error during AI verification: ${err?.message || 'Unknown error'}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
