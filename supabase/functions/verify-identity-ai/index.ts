// verify-identity-ai
//
// The ONLY path allowed to write public.profiles.verification_status.
// (public.prevent_client_verification_change() reverts any non-service-role write.)
//
// Responsibilities:
//   1. Authenticate the caller with their own JWT (anon client).
//   2. Run Gemini vision checks on the govt ID + live selfie.
//   3. Persist the raw KYC docs to the PRIVATE `verification-docs` bucket (service role).
//   4. Log the attempt in public.verification_attempts (service role).
//   5. Write the resulting badge to public.profiles (service role).
//   6. Return { status: 'approved' | 'pending' | 'rejected' } — the contract that
//      profileApi.submitVerification() and IdentityVerificationScreen expect.
//
// NOTE: it returns `status`, not `verified`. The old v2 returned `verified: boolean`,
// which made the client fall through to `?? 'error'` on every single call.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Confidence at or above this, with all three boolean checks passing, auto-approves.
const APPROVE_THRESHOLD = 80;
// Between this and APPROVE_THRESHOLD we queue for manual review rather than rejecting
// outright — a blurry photo of a real ID should not brand someone as fraudulent.
const REVIEW_THRESHOLD = 55;

// Vision + JSON-mode capable models, tried in order.
// NOTE: Google retired the 2.x Flash family for new users — every request 404'd with
// "This model is no longer available to new users. Please update your code to use
// models/gemini-3.6-flash". Verified against the ListModels endpoint before pinning.
// These are deliberately DISTINCT model families, not aliases: `gemini-flash-latest`
// resolves to whatever is current and can point at the same overloaded backend that
// just returned 503, which makes it useless as a failover target.
const MODEL_CHAIN = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.6-flash-lite'];

const SYSTEM_INSTRUCTION = `You are an AI Identity & Security Auditor for OpenMatch, a professional Indian matrimonial app.
You are given two images:
1. A government-issued ID document (Aadhaar Card, PAN Card, Driving License, Passport, or Voter ID).
2. A live selfie of the candidate.

Perform the following 4 strict checks:
- Confirm Image 1 is a valid Indian Government ID document.
- Extract the Name and Date of Birth from the ID.
- Compare the face on the ID document with the face in the selfie.
- Assess overall confidence in the identity match.

Also extract the ID's unique document number (Aadhaar number, PAN, passport number,
license number, or voter ID number) EXACTLY as printed, digits/letters only, and assess
whether the selfie (Image 2) is a genuine live capture of a real person physically
present — versus a spoof such as a photo of a photo, a screen/monitor recapture, a
printout, or an obviously edited/AI-generated image. Look for tell-tale signs: screen
glare/moire, visible device bezels, paper edges, unnatural flatness, or a second ID-style
border around the face.

Return ONLY a valid JSON object:
{
  "isValidGovtId": boolean,
  "docType": "Aadhaar" | "PAN" | "Passport" | "Driving License" | "Voter ID" | "Unknown",
  "extractedName": string,
  "extractedDob": string,
  "idNumber": string,
  "nameMatches": boolean,
  "faceMatches": boolean,
  "selfieSpoofSuspected": boolean,
  "confidenceScore": number (0-100),
  "reason": string
}`;

type Decision = 'approved' | 'pending' | 'rejected';

interface AiResult {
  isValidGovtId?: boolean;
  docType?: string;
  extractedName?: string;
  extractedDob?: string;
  idNumber?: string;
  nameMatches?: boolean;
  faceMatches?: boolean;
  selfieSpoofSuspected?: boolean;
  confidenceScore?: number;
  reason?: string;
}

/**
 * Maps the raw AI output onto the three-state decision the client understands.
 * Exported shape is intentionally pure so the rules are easy to reason about.
 */
export function decideVerification(result: AiResult): { status: Decision; reason: string } {
  const confidence = Number(result.confidenceScore ?? 0);
  const aiReason = (result.reason || '').trim();

  // Not an Indian government ID at all — nothing to review, this is a hard fail.
  if (!result.isValidGovtId) {
    return {
      status: 'rejected',
      reason: aiReason || 'The uploaded document was not recognised as a valid Indian government ID.',
    };
  }

  // Anti-spoofing: a selfie that looks like a photo-of-a-photo, a screen recapture, or an
  // edited/AI image must NEVER auto-approve, even if the face "matches" — the match is
  // exactly what an attacker holding someone else's photo would produce. Route to a human.
  if (result.selfieSpoofSuspected) {
    return {
      status: 'pending',
      reason:
        aiReason ||
        'Your selfie could not be confirmed as a live capture. Please retake it in the app using your camera in good lighting. Our team will review this.',
    };
  }

  if (result.nameMatches && result.faceMatches && confidence >= APPROVE_THRESHOLD) {
    return { status: 'approved', reason: aiReason || 'Identity confirmed.' };
  }

  // Something is off but the document is genuine — a human should look at it.
  if (confidence >= REVIEW_THRESHOLD) {
    if (!result.faceMatches) {
      return {
        status: 'pending',
        reason: aiReason || 'We could not confidently match your selfie to the photo on your ID. Our team will review this manually.',
      };
    }
    if (!result.nameMatches) {
      return {
        status: 'pending',
        reason: aiReason || 'The name on your ID does not exactly match your profile. Our team will review this manually.',
      };
    }
    return {
      status: 'pending',
      reason: aiReason || 'Your documents need a manual review. We will update you shortly.',
    };
  }

  return {
    status: 'rejected',
    reason: aiReason || 'We could not verify your identity from these images. Please retake them in good lighting.',
  };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function extensionForMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('heic')) return 'heic';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('pdf')) return 'pdf';
  return 'jpg';
}

// Normalise an ID number so trivial formatting differences (spaces, dashes, case) do not
// let the same document masquerade as two different ones. Aadhaar "1234 5678 9012",
// "1234-5678-9012" and "123456789012" must all collapse to the same canonical value.
function normalizeIdNumber(raw: string | undefined | null): string {
  return (raw ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

// One-way keyed hash of the ID number. We deliberately do NOT store the raw Govt ID
// number anywhere — only a salted SHA-256 digest, which is enough to detect "this exact
// ID already verified a different account" without holding sensitive KYC data at rest.
async function hashIdNumber(docType: string, idNumber: string, salt: string): Promise<string> {
  const canonical = `${(docType || 'Unknown').toUpperCase()}:${idNumber}:${salt}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function callGemini(model: string, apiKey: string, body: unknown) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // 429 = per-key quota, 503 = Google-side capacity. Both are transient: the caller
    // should move to the next model or back off, never surface a failure to the user.
    if (response.status === 429 || response.status === 503) throw new Error('TRANSIENT');
    const errText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${errText}`);
  }

  return response.json();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Walks MODEL_CHAIN, retrying each model once with a short backoff on transient
 * (429/503) failures. A non-transient error from any model is thrown immediately —
 * a malformed request will fail identically everywhere, so retrying just wastes time.
 * Throws TRANSIENT only when every model in the chain is genuinely unavailable.
 */
async function callGeminiWithFailover(apiKey: string, body: unknown) {
  let sawTransient = false;

  for (const model of MODEL_CHAIN) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGemini(model, apiKey, body);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message !== 'TRANSIENT') throw e;

        sawTransient = true;
        console.warn(`[verify-identity-ai] ${model} unavailable (attempt ${attempt + 1})`);
        if (attempt === 0) await sleep(1200);
      }
    }
  }

  throw new Error(sawTransient ? 'TRANSIENT' : 'All Gemini models failed');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    // The platform auto-injects SUPABASE_SERVICE_ROLE_KEY, and the `SUPABASE_` prefix is
    // reserved so it cannot be set via `supabase secrets set`. SERVICE_ROLE_KEY is an
    // escape hatch for local `supabase functions serve` / self-hosted setups.
    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';

    if (!serviceRoleKey) {
      // Without the service role we cannot persist anything, and a verification that
      // is not persisted is worse than none at all — fail loudly instead of lying.
      return json({ error: 'Server configuration error (missing service role key)' }, 500);
    }

    // Privileged client: bypasses RLS and the verification-lock trigger.
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Resolve the caller by validating their JWT directly, rather than building a second
    // anon-key client with the Authorization header attached. On projects migrated to the
    // new publishable/secret API keys and asymmetric JWT signing, the legacy anon-key
    // path returns "Unauthorized" for perfectly valid sessions.
    const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!accessToken) return json({ error: 'Malformed Authorization header' }, 401);

    const { data: { user }, error: authError } = await admin.auth.getUser(accessToken);
    if (authError || !user) {
      console.warn('[verify-identity-ai] token rejected:', authError?.message);
      return json({
        error: 'Your session has expired. Please sign out and sign in again, then retry verification.',
      }, 401);
    }

    const { idBase64, idMimeType, selfieBase64, selfieMimeType, fullName, dob } = await req.json();
    if (!idBase64 || !selfieBase64) return json({ error: 'Missing image data' }, 400);

    // PDFs cannot be verified: UIDAI e-Aadhaar PDFs are password-encrypted (Gemini
    // answers 400 "Unable to process input image"), and the embedded portrait is too
    // low-resolution to face-match against a selfie. Reject with an actionable message
    // instead of forwarding an opaque model error. The client blocks this too; this is
    // the backstop for older app builds still sending PDFs.
    if (typeof idMimeType === 'string' && idMimeType.includes('pdf')) {
      return json({
        error: 'PDF documents cannot be verified. Please upload a clear photo of your physical ID card instead.',
      }, 400);
    }

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) return json({ error: 'Server configuration error (missing API key)' }, 500);

    // ---- 1. Persist the raw documents to the PRIVATE bucket ----------------------
    // Done before the AI call so we always retain evidence of what was submitted,
    // even if the model call later fails.
    const stamp = Date.now();
    const idExt = extensionForMime(idMimeType || 'image/jpeg');
    const selfieExt = extensionForMime(selfieMimeType || 'image/jpeg');
    const idPath = `${user.id}/${stamp}-id.${idExt}`;
    const selfiePath = `${user.id}/${stamp}-selfie.${selfieExt}`;

    const uploads = await Promise.all([
      admin.storage.from('verification-docs').upload(idPath, base64ToBytes(idBase64), {
        contentType: idMimeType || 'image/jpeg',
        upsert: true,
      }),
      admin.storage.from('verification-docs').upload(selfiePath, base64ToBytes(selfieBase64), {
        contentType: selfieMimeType || 'image/jpeg',
        upsert: true,
      }),
    ]);

    const uploadError = uploads.find((u) => u.error)?.error;
    if (uploadError) {
      console.error('[verify-identity-ai] storage upload failed:', uploadError.message);
      return json({ error: 'Could not securely store your documents. Please try again.' }, 500);
    }

    // ---- 2. Run the AI checks ----------------------------------------------------
    const identityHint = fullName || dob
      ? `The candidate registered as name: "${fullName ?? 'unknown'}", date of birth: "${dob ?? 'unknown'}". Set nameMatches based on whether the ID name matches this registered name (ignore case, honorifics, and middle-name ordering).`
      : 'No registered name was supplied; set nameMatches to true if the ID clearly shows a name.';

    const geminiReqBody = {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{
        parts: [
          { inlineData: { mimeType: idMimeType || 'image/jpeg', data: idBase64 } },
          { inlineData: { mimeType: selfieMimeType || 'image/jpeg', data: selfieBase64 } },
          { text: `Please verify the identity. ${identityHint}` },
        ],
      }],
      generationConfig: { responseMimeType: 'application/json' },
    };

    let geminiResponse;
    try {
      geminiResponse = await callGeminiWithFailover(geminiApiKey, geminiReqBody);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message === 'TRANSIENT') {
        // Every model was rate-limited or overloaded. This is explicitly NOT a rejection:
        // the client maps a non-2xx to status 'error', which leaves verification_status
        // untouched so the user can simply retry.
        return json({
          error: 'Our verification service is busy right now. Please try again in a minute — your documents were not rejected.',
        }, 503);
      }
      throw e;
    }

    const text = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Invalid response from Gemini');

    let result: AiResult;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('Could not parse the AI verification response');
    }

    const { status, reason } = decideVerification(result);
    const confidenceScore = Number(result.confidenceScore ?? 0);

    // ---- 2b. One Govt ID → one verified account ----------------------------------
    // The name/face checks stop "Sam verifies as Sam using Harshit's ID", but not
    // "Sam registers AS Harshit and verifies with Harshit's real ID + photo". To blunt
    // that impersonation vector we bind each Govt ID number to a single account: if this
    // exact ID has already verified a DIFFERENT user, we refuse to hand out a second
    // badge and flag it for review. We store only a salted hash, never the raw number.
    let finalStatus = status;
    let finalReason = reason;

    const canonicalIdNumber = normalizeIdNumber(result.idNumber);
    // A salt keeps the hashes non-reversible even if the table leaks. Fall back to the
    // service role key (always present) so the check never silently no-ops.
    const idSalt =
      Deno.env.get('VERIFICATION_ID_SALT') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? 'openmatch-fallback-salt';

    let idHash: string | null = null;
    if (finalStatus === 'approved' && canonicalIdNumber.length >= 6) {
      idHash = await hashIdNumber(result.docType || 'Unknown', canonicalIdNumber, idSalt);

      const { data: existing, error: lookupError } = await admin
        .from('verified_identities')
        .select('user_id')
        .eq('id_hash', idHash)
        .maybeSingle();

      if (lookupError) {
        console.error('[verify-identity-ai] id-hash lookup failed:', lookupError.message);
        // Fail closed: if we cannot confirm the ID is unique, do not auto-approve.
        finalStatus = 'pending';
        finalReason = 'We could not complete identity checks right now. Our team will review your submission.';
      } else if (existing && existing.user_id !== user.id) {
        console.warn(`[verify-identity-ai] duplicate ID: hash already bound to ${existing.user_id}, attempted by ${user.id}`);
        finalStatus = 'rejected';
        finalReason =
          'This government ID has already been used to verify another OpenMatch account. Each ID can verify only one profile. If you believe this is a mistake, please contact support.';
      }
    }

    // ---- 3. Log the attempt ------------------------------------------------------
    const { error: attemptError } = await admin.from('verification_attempts').insert({
      user_id: user.id,
      id_photo_url: idPath,
      selfie_photo_url: selfiePath,
      similarity_score: confidenceScore,
      status: finalStatus,
    });
    if (attemptError) {
      // Non-fatal: the audit row failing should not deny a legitimate user their badge.
      console.error('[verify-identity-ai] attempt log failed:', attemptError.message);
    }

    // ---- 4. Write the badge ------------------------------------------------------
    // profiles.verification_status is constrained to
    // ('unverified' | 'pending' | 'verified' | 'rejected').
    const profileStatus = finalStatus === 'approved' ? 'verified' : finalStatus;
    const { error: profileError } = await admin
      .from('profiles')
      .update({ verification_status: profileStatus })
      .eq('id', user.id);

    if (profileError) {
      console.error('[verify-identity-ai] profile update failed:', profileError.message);
      // The badge is the whole point — if it did not stick, tell the client to retry
      // rather than showing a success screen backed by nothing.
      return json({ error: 'Verification could not be saved. Please try again.' }, 500);
    }

    // Read the value back. A BEFORE-UPDATE trigger can silently revert verification_status
    // (that is exactly what the client-lock trigger does for non-service-role callers), in
    // which case the UPDATE above returns no error yet nothing changed. Verifying the
    // persisted value guarantees we never show a "verified" screen backed by an
    // 'unverified' row — the failure that made the badge vanish on refresh.
    const { data: savedRow, error: readBackError } = await admin
      .from('profiles')
      .select('verification_status')
      .eq('id', user.id)
      .single();

    if (readBackError || !savedRow) {
      console.error('[verify-identity-ai] profile read-back failed:', readBackError?.message);
      return json({ error: 'Verification could not be confirmed. Please try again.' }, 500);
    }

    if (savedRow.verification_status !== profileStatus) {
      console.error(
        `[verify-identity-ai] verification_status did not persist: expected "${profileStatus}", got "${savedRow.verification_status}". ` +
          'The client-lock trigger likely did not recognise the service role (check auth.role()/current_user under the new API keys).',
      );
      return json({ error: 'Verification could not be saved. Please try again.' }, 500);
    }

    // ---- 5. Bind the ID to this account (only after a confirmed 'verified' badge) --
    // Done last so we never reserve an ID for a verification that ultimately failed to
    // persist. upsert keeps re-verification by the SAME user idempotent.
    if (profileStatus === 'verified' && idHash) {
      const { error: bindError } = await admin
        .from('verified_identities')
        .upsert({ id_hash: idHash, user_id: user.id, doc_type: result.docType || 'Unknown' }, { onConflict: 'id_hash' });
      if (bindError) {
        // Non-fatal for THIS user's badge, but log loudly: a failure here weakens the
        // one-ID-one-account guarantee for future attempts.
        console.error('[verify-identity-ai] id-hash binding failed:', bindError.message);
      }
    }

    return json({
      status: finalStatus,
      confidenceScore,
      extractedName: result.extractedName || '',
      extractedDob: result.extractedDob || '',
      reason: finalReason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('[verify-identity-ai] error:', message);
    return json({ error: message }, 500);
  }
});
