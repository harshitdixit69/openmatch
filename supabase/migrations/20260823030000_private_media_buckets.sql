-- Migration: Make profile-photos and intent-voice-intros PRIVATE
--
-- Problem (data-safety audit): both buckets were public = true with a blanket
-- "... are public" SELECT policy, so every user photo / voice intro was reachable by
-- ANYONE on the internet at a guessable path (/object/public/<bucket>/<uid>/<file>),
-- no authentication required.
--
-- Fix: flip both buckets to private and replace the public SELECT policy with an
-- owner-only one. The app now stores SIGNED URLs (createSignedUrl) instead of public
-- URLs — a signed URL carries an unguessable token and cannot be forged by anonymous
-- visitors, and viewers do not need storage RLS because the token itself grants access.
-- The owner-only SELECT policy is what lets each user MINT a signed URL for their own
-- freshly uploaded object; the service role (backfill script) bypasses RLS.
--
-- DEPLOYMENT ORDER (important):
--   1. Ship the client (uploads now produce signed URLs).
--   2. Run scripts/backfillSignedMediaUrls.mjs to convert EXISTING public URLs in
--      profiles.photo_urls to signed URLs (works while the bucket is still public).
--   3. Apply THIS migration to flip the buckets private.
-- Flipping private before the backfill would 404 every existing photo until it runs.

-- 1. Flip buckets to private.
update storage.buckets set public = false where id = 'profile-photos';
update storage.buckets set public = false where id = 'intent-voice-intros';

-- 2. profile-photos: replace the public read policy with owner-only.
drop policy if exists "Profile photos are public" on storage.objects;
drop policy if exists "Owners read own profile photos" on storage.objects;
create policy "Owners read own profile photos" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- 3. intent-voice-intros: replace the public read policy with owner-only.
drop policy if exists "Voice intros are public" on storage.objects;
drop policy if exists "Owners read own voice intros" on storage.objects;
create policy "Owners read own voice intros" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'intent-voice-intros'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
