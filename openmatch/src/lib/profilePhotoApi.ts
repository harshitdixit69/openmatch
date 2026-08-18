import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { supabase } from './supabase';

export const maxProfilePhotos = 4;
const profilePhotosBucket = 'profile-photos';

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
async function compressImageToArrayBuffer(uri: string, fallbackBuffer: ArrayBuffer): Promise<ArrayBuffer> {
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
            input.accept = 'image/*,application/pdf';
            input.onchange = (e: any) => {
                const file = e.target?.files?.[0];
                if (!file) {
                    resolve(null);
                    return;
                }
                const uri = URL.createObjectURL(file);
                const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
                resolve({
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    uri,
                    fileName: file.name ?? 'document.pdf',
                    mimeType: isPdf ? 'application/pdf' : (file.type || 'image/jpeg'),
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
 * Capture a live selfie using the front camera (liveness-lite for identity verification).
 * On web, falls back to the file picker with a camera capture hint. Forcing camera capture
 * (instead of letting the user pick any library photo) makes it materially harder to submit
 * a downloaded photo of someone else for verification.
 */
export async function captureLiveSelfie(): Promise<PickedProfilePhoto | null> {
    if (Platform.OS === 'web') {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.setAttribute('capture', 'user');
            input.onchange = (e: any) => {
                const file = e.target?.files?.[0];
                if (!file) {
                    resolve(null);
                    return;
                }
                resolve({
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    uri: URL.createObjectURL(file),
                    fileName: file.name ?? 'selfie.jpg',
                    mimeType: file.type || 'image/jpeg',
                });
            };
            input.onerror = () => resolve(null);
            input.click();
        });
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

        const { data } = supabase.storage.from(profilePhotosBucket).getPublicUrl(path);
        uploadedPhotoUrls.push(data.publicUrl);
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
    const marker = `/storage/v1/object/public/${profilePhotosBucket}/`;
    const markerIndex = publicUrl.indexOf(marker);

    if (markerIndex < 0) {
        return null;
    }

    const pathStartIndex = markerIndex + marker.length;
    const pathWithQuery = publicUrl.slice(pathStartIndex);
    const [path] = pathWithQuery.split('?');

    return path ? decodeURIComponent(path) : null;
}

function normalizeExtension(value: string) {
    if (value === 'jpeg') {
        return 'jpg';
    }

    return value;
}