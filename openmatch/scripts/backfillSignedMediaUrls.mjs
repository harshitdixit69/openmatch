import { createClient } from '@supabase/supabase-js';

// Backfill: convert existing PUBLIC storage URLs stored in the database into signed URLs,
// so they keep working after profile-photos / intent-voice-intros are flipped to private
// (migration 20260823030000_private_media_buckets.sql).
//
// Run this AFTER shipping the client change and BEFORE applying that migration.
// createSignedUrl works whether the bucket is currently public or private, so running it
// while still public is safe and produces URLs that survive the flip.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfillSignedMediaUrls.mjs
//   DRY_RUN=1 ... to preview without writing.

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = /^(1|true|yes)$/i.test(process.env.DRY_RUN ?? '');

if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
}

const PROFILE_PHOTOS_BUCKET = 'profile-photos';
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 5; // ~5 years — matches the client.

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
});

// Pull the storage path out of either a public or an already-signed URL.
function storagePathFromUrl(bucket, url) {
    if (typeof url !== 'string') return null;
    const markers = [
        `/storage/v1/object/public/${bucket}/`,
        `/storage/v1/object/sign/${bucket}/`,
    ];
    for (const marker of markers) {
        const i = url.indexOf(marker);
        if (i < 0) continue;
        const [path] = url.slice(i + marker.length).split('?');
        return path ? decodeURIComponent(path) : null;
    }
    return null;
}

function isAlreadySigned(url) {
    return typeof url === 'string' && url.includes('/object/sign/');
}

async function signPath(bucket, path) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
        throw error ?? new Error(`Failed to sign ${bucket}/${path}`);
    }
    return data.signedUrl;
}

let scanned = 0;
let updated = 0;
let skipped = 0;
const pageSize = 500;
let from = 0;

for (;;) {
    const { data: rows, error } = await supabase
        .from('profiles')
        .select('id, photo_urls')
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
        scanned += 1;
        const photoUrls = Array.isArray(row.photo_urls) ? row.photo_urls : [];
        if (photoUrls.length === 0) {
            skipped += 1;
            continue;
        }

        let changed = false;
        const next = [];
        for (const url of photoUrls) {
            if (isAlreadySigned(url)) {
                next.push(url);
                continue;
            }
            const path = storagePathFromUrl(PROFILE_PHOTOS_BUCKET, url);
            if (!path) {
                // Foreign/unknown URL (e.g. seeded test data) — leave it untouched.
                next.push(url);
                continue;
            }
            try {
                next.push(await signPath(PROFILE_PHOTOS_BUCKET, path));
                changed = true;
            } catch (e) {
                console.warn(`  ! could not sign ${path} for profile ${row.id}:`, e.message);
                next.push(url);
            }
        }

        if (!changed) {
            skipped += 1;
            continue;
        }

        if (dryRun) {
            console.log(`[dry-run] would update profile ${row.id} (${next.length} photos)`);
            updated += 1;
            continue;
        }

        const { error: updateError } = await supabase
            .from('profiles')
            .update({ photo_urls: next })
            .eq('id', row.id);

        if (updateError) {
            console.warn(`  ! failed to update profile ${row.id}:`, updateError.message);
        } else {
            updated += 1;
            console.log(`updated profile ${row.id}`);
        }
    }

    from += pageSize;
}

console.log(`\nDone. scanned=${scanned} updated=${updated} skipped=${skipped} dryRun=${dryRun}`);
