import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { supabase } from './supabase';

export const maxProfilePhotos = 4;
const profilePhotosBucket = 'profile-photos';

// The profile-photos bucket is PRIVATE (see 20260823030000_private_media_buckets.sql),
// so we hand out signed URLs instead of public ones. A signed URL carries an unguessable
// token and cannot be fabricated by anonymous visitors, which closes the "anyone on the
// internet can open a guessable /object/public/<uid>/<file> URL" gap. The TTL is long
// because these URLs are persisted in profiles.photo_urls and echoed by server RPCs;
// a shorter, on-read-refreshed signing scheme is the eventual hardening step.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 5; // ~5 years

// Keep uploads comfortably under the Supabase Storage bucket file-size limit.
const maxUploadDimension = 1600; // px on the longest edge
const uploadJpegQuality = 0.82;

/**
 * Downscale/re-encode an image so it stays under the storage bucket size limit.
 *
 * On web we use a canvas to resize + re-encode to JPEG (the source of the
 * "object exceeded the maximum allowed size" error, since browsers hand us the
 * full-resolution original). On native we fall back to the already-fetched
 * ArrayBuffer (expo-image-picker already applies `quality`).
 */
export async function compressImageToArrayBuffer(uri: string, fallbackBuffer: ArrayBuffer): Promise<ArrayBuffer> {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
        return fallbackBuffer;
    }

    try {
        const dataUrl: string = await new Promise((resolve, reject) => {
            const blob = new Blob([fallbackBuffer]);
            const objectUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                try {
                    const scale = Math.min(1, maxUploadDimension / Math.max(img.width, img.height));
                    const width = Math.max(1, Math.round(img.width * scale));
                    const height = Math.max(1, Math.round(img.height * scale));

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('Canvas not supported'));
                        return;
                    }
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', uploadJpegQuality));
                } catch (err) {
                    reject(err);
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
            };
            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('Failed to load image for compression'));
            };
            img.src = objectUrl;
        });

        const base64 = dataUrl.split(',')[1] ?? '';
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    } catch {
        // If compression fails for any reason, fall back to the original bytes.
        return fallbackBuffer;
    }
}

export type PickedProfilePhoto = {
    id: string;
    uri: string;
    fileName: string | null;
    mimeType: string | null;
};

export async function pickGovtIdDocument(): Promise<PickedProfilePhoto | null> {
    if (Platform.OS === 'web') {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            // Images only. PDFs are deliberately not accepted: verification face-matches
            // the photo on the ID against the live selfie, and UIDAI e-Aadhaar PDFs are
            // password-encrypted (Gemini returns 400 "Unable to process input image").
            // Even unencrypted, the embedded portrait is too small to match reliably.
            input.accept = 'image/*';
            input.onchange = (e: any) => {
                const file = e.target?.files?.[0];
                if (!file) {
                    resolve(null);
                    return;
                }
                resolve({
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    uri: URL.createObjectURL(file),
                    fileName: file.name ?? 'id.jpg',
                    mimeType: file.type || 'image/jpeg',
                });
            };
            input.onerror = () => resolve(null);
            input.click();
        });
    }

    try {
        return await pickProfilePhotoFromLibrary();
    } catch {
        return null;
    }
}

/**
 * Web-only: open a live front-camera stream in a fullscreen overlay and let the user
 * snap a frame. Returns null if the user cancels. Throws if no camera is available or
 * permission is denied — the caller surfaces an actionable message and we NEVER fall
 * back to a file picker (that is the exact impersonation hole we are closing: on desktop
 * a file <input capture="user"> silently lets the user pick a saved photo of someone
 * else, producing a fraudulent "verified" badge from a real ID + a downloaded selfie).
 */
async function captureLiveSelfieWeb(): Promise<PickedProfilePhoto | null> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error(
            'Your browser does not support live camera capture. Please verify from the OpenMatch mobile app.',
        );
    }

    let stream: MediaStream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
        });
    } catch {
        throw new Error(
            'Camera access is required for a live selfie. Please allow camera permission, or verify from the OpenMatch mobile app.',
        );
    }

    return new Promise<PickedProfilePhoto | null>((resolve) => {
        const cleanup = (overlay: HTMLElement) => {
            stream.getTracks().forEach((track) => track.stop());
            overlay.remove();
        };

        const overlay = document.createElement('div');
        overlay.style.cssText =
            'position:fixed;inset:0;z-index:99999;background:#0b1419;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;';

        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.srcObject = stream;
        video.style.cssText =
            'width:min(92vw,420px);aspect-ratio:3/4;object-fit:cover;border-radius:16px;transform:scaleX(-1);background:#000;box-shadow:0 8px 40px rgba(0,0,0,0.5);';

        const hint = document.createElement('p');
        hint.textContent = 'Center your face in the frame, then capture your live selfie.';
        hint.style.cssText =
            'color:#e6edf0;font-family:system-ui,sans-serif;font-size:15px;text-align:center;margin:0;max-width:420px;';

        const buttonRow = document.createElement('div');
        buttonRow.style.cssText = 'display:flex;gap:12px;';

        const captureBtn = document.createElement('button');
        captureBtn.textContent = '📸 Capture';
        captureBtn.style.cssText =
            'background:#d1354c;color:#fff;border:none;border-radius:10px;padding:14px 28px;font-size:16px;font-weight:700;cursor:pointer;font-family:system-ui,sans-serif;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText =
            'background:transparent;color:#e6edf0;border:1px solid #3a4a52;border-radius:10px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;';

        captureBtn.onclick = () => {
            const width = video.videoWidth || 720;
            const height = video.videoHeight || 960;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                cleanup(overlay);
                resolve(null);
                return;
            }
            // Draw the raw (un-mirrored) frame so the stored image matches how a camera
            // actually sees the person, consistent with the ID photo orientation.
            ctx.drawImage(video, 0, 0, width, height);
            canvas.toBlob(
                (blob) => {
                    cleanup(overlay);
                    if (!blob) {
                        resolve(null);
                        return;
                    }
                    resolve({
                        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        uri: URL.createObjectURL(blob),
                        fileName: 'live-selfie.jpg',
                        mimeType: 'image/jpeg',
                    });
                },
                'image/jpeg',
                0.9,
            );
        };

        cancelBtn.onclick = () => {
            cleanup(overlay);
            resolve(null);
        };

        buttonRow.appendChild(captureBtn);
        buttonRow.appendChild(cancelBtn);
        overlay.appendChild(video);
        overlay.appendChild(hint);
        overlay.appendChild(buttonRow);
        document.body.appendChild(overlay);
    });
}

/**
 * Capture a live selfie using the front camera (liveness for identity verification).
 * On native this is the front camera only (no gallery). On web this is a live
 * getUserMedia capture (no file picker) so a downloaded photo of someone else cannot
 * be submitted. The server (verify-identity-ai) additionally flags photo-of-a-photo /
 * screen recaptures and routes them to manual review.
 */
export async function captureLiveSelfie(): Promise<PickedProfilePhoto | null> {
    if (Platform.OS === 'web') {
        // Real liveness on web: capture a frame from a live getUserMedia camera stream.
        // We deliberately DO NOT fall back to a file <input>, because desktop browsers
        // ignore the `capture` attribute and would let an impersonator pick a saved photo
        // of someone else from disk (real ID + a downloaded selfie of the ID's owner ==
        // a fraudulent "verified" badge). If the camera is unavailable we fail closed and
        // ask the user to use the mobile app instead.
        return captureLiveSelfieWeb();
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
        throw new Error('Camera permission is required to capture a live selfie for verification.');
    }

    const result = await ImagePicker.launchCameraAsync({
        cameraType: ImagePicker.CameraType.front,
        allowsEditing: false,
        quality: 0.85,
    });

    if (result.canceled || !result.assets?.[0]) {
        return null;
    }

    const asset = result.assets[0];
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        uri: asset.uri,
        fileName: asset.fileName ?? null,
        mimeType: asset.mimeType ?? 'image/jpeg',
    };
}

export async function pickProfilePhotoFromLibrary(): Promise<PickedProfilePhoto | null> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
        throw new Error('Photo library permission is required to add profile photos.');
    }

    const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 5],
        quality: 0.85,
    });

    if (result.canceled || !result.assets?.[0]) {
        return null;
    }

    const asset = result.assets[0];

    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        uri: asset.uri,
        fileName: asset.fileName ?? null,
        mimeType: asset.mimeType ?? null,
    };
}

export async function uploadCurrentUserProfilePhotos(photos: PickedProfilePhoto[]) {
    if (photos.length === 0) {
        return [] as string[];
    }

    const {
        data: { user },
        error,
    } = await supabase.auth.getUser();

    if (error) {
        throw error;
    }

    if (!user) {
        throw new Error('You must be signed in to upload profile photos.');
    }

    const uploadedPhotoUrls: string[] = [];

    for (const photo of photos) {
        const response = await fetch(photo.uri);
        const originalBuffer = await response.arrayBuffer();
        const arrayBuffer = await compressImageToArrayBuffer(photo.uri, originalBuffer);
        const wasCompressed = arrayBuffer !== originalBuffer;
        const extension = wasCompressed ? 'jpg' : resolveFileExtension(photo);
        const contentType = wasCompressed ? 'image/jpeg' : photo.mimeType ?? `image/${extension}`;
        const path = `${user.id}/${Date.now()}-${photo.id}.${extension}`;

        const { error: uploadError } = await supabase.storage.from(profilePhotosBucket).upload(path, arrayBuffer, {
            contentType,
            upsert: false,
        });

        if (uploadError) {
            throw uploadError;
        }

        const { data, error: signError } = await supabase.storage
            .from(profilePhotosBucket)
            .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

        if (signError || !data?.signedUrl) {
            throw signError ?? new Error('Could not generate a URL for the uploaded photo.');
        }

        uploadedPhotoUrls.push(data.signedUrl);
    }

    return uploadedPhotoUrls;
}

export async function deleteCurrentUserProfilePhotos(photoUrls: string[]) {
    if (photoUrls.length === 0) {
        return;
    }

    const storagePaths = photoUrls
        .map(resolveStoragePathFromPublicUrl)
        .filter((path): path is string => Boolean(path));

    if (storagePaths.length === 0) {
        return;
    }

    const { error } = await supabase.storage.from(profilePhotosBucket).remove(storagePaths);

    if (error) {
        throw error;
    }
}

function resolveFileExtension(photo: PickedProfilePhoto) {
    const fromFileName = photo.fileName?.split('.').pop()?.trim().toLowerCase();
    if (fromFileName) {
        return normalizeExtension(fromFileName);
    }

    const fromMimeType = photo.mimeType?.split('/').pop()?.trim().toLowerCase();
    if (fromMimeType) {
        return normalizeExtension(fromMimeType);
    }

    const fromUri = photo.uri.split('.').pop()?.trim().toLowerCase();
    if (fromUri) {
        return normalizeExtension(fromUri);
    }

    return 'jpg';
}

function resolveStoragePathFromPublicUrl(publicUrl: string) {
    // Handle both legacy public URLs (/object/public/<bucket>/) and the signed URLs
    // (/object/sign/<bucket>/) we issue now that the bucket is private.
    const markers = [
        `/storage/v1/object/public/${profilePhotosBucket}/`,
        `/storage/v1/object/sign/${profilePhotosBucket}/`,
    ];

    for (const marker of markers) {
        const markerIndex = publicUrl.indexOf(marker);
        if (markerIndex < 0) {
            continue;
        }

        const pathStartIndex = markerIndex + marker.length;
        const pathWithQuery = publicUrl.slice(pathStartIndex);
        const [path] = pathWithQuery.split('?');
        return path ? decodeURIComponent(path) : null;
    }

    return null;
}

function normalizeExtension(value: string) {
    if (value === 'jpeg') {
        return 'jpg';
    }

    return value;
}