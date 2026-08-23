-- Migration: give the verification-docs bucket explicit limits.
--
-- The bucket was created in 20260803000100_harden_identity_verification.sql without a
-- file_size_limit or allowed_mime_types, so it inherited the project-wide default. A
-- full-resolution phone photo or a browser-picked original blew straight past it, and
-- storage returned "The object exceeded the maximum allowed size" — which surfaced in
-- the app as a bare "Edge Function returned a non-2xx status code".
--
-- The client now downscales to <=1600px JPEG before upload (well under 1 MB in
-- practice), so 8 MB is a generous ceiling that still stops someone streaming a huge
-- file into a bucket that has no user-facing delete path.

update storage.buckets
set
  file_size_limit = 8388608, -- 8 MB
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/pdf'
  ]
where id = 'verification-docs';
