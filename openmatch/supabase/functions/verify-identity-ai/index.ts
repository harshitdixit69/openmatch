import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM_INSTRUCTION = `You are an AI Identity & Security Auditor for OpenMatch, a professional Indian matrimonial app.
You are given two images:
1. A government-issued ID document (Aadhaar Card, PAN Card, Driving License, Passport, or Voter ID).
2. A live selfie of the candidate.

Perform the following 4 strict checks:
- Confirm Image 1 is a valid Indian Government ID document.
- Extract the Name and Date of Birth from the ID.
- Compare the face on the ID document with the face in the selfie.
- Assess overall confidence in the identity match.

Return ONLY a valid JSON object:
{
  "isValidGovtId": boolean,
  "docType": "Aadhaar" | "PAN" | "Passport" | "Driving License" | "Voter ID" | "Unknown",
  "extractedName": string,
  "extractedDob": string,
  "nameMatches": boolean,
  "faceMatches": boolean,
  "confidenceScore": number (0-100),
  "reason": string
}`;

async function callGemini(model: string, apiKey: string, body: any) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('RATE_LIMIT');
    }
    const errText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${errText}`);
  }
  
  return response.json();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { idBase64, idMimeType, selfieBase64, selfieMimeType } = await req.json();
    
    if (!idBase64 || !selfieBase64) {
       return new Response(JSON.stringify({ error: 'Missing image data' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: 'Server configuration error (missing API key)' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const geminiReqBody = {
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }]
      },
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType: idMimeType || 'image/jpeg',
              data: idBase64
            }
          },
          {
            inlineData: {
              mimeType: selfieMimeType || 'image/jpeg',
              data: selfieBase64
            }
          },
          {
            text: "Please verify the identity."
          }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    let geminiResponse;
    try {
      geminiResponse = await callGemini('gemini-2.0-flash', geminiApiKey, geminiReqBody);
    } catch (e: any) {
      if (e.message === 'RATE_LIMIT') {
        return new Response(JSON.stringify({ error: 'AI rate limit exceeded. Please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      console.warn('Falling back to gemini-2.5-flash after error:', e.message);
      // Try fallback
      try {
        geminiResponse = await callGemini('gemini-2.5-flash', geminiApiKey, geminiReqBody);
      } catch (fallbackError: any) {
        if (fallbackError.message === 'RATE_LIMIT') {
          return new Response(JSON.stringify({ error: 'AI rate limit exceeded. Please try again later.' }), {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        throw fallbackError;
      }
    }

    const text = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Invalid response from Gemini");
    }

    const result = JSON.parse(text);

    // Keep the same response format for the client
    const responsePayload = {
      verified: Boolean(result.isValidGovtId) && Boolean(result.nameMatches) && Boolean(result.faceMatches) && (result.confidenceScore ?? 0) >= 80,
      confidenceScore: result.confidenceScore || 0,
      extractedName: result.extractedName || '',
      extractedDob: result.extractedDob || '',
      reason: result.reason || ''
    };

    return new Response(JSON.stringify(responsePayload), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
