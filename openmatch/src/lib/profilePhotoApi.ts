import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

export const maxProfilePhotos = 4;
const profilePhotosBucket = 'profile-photos';

export type PickedProfilePhoto = {
    id: string;
    uri: string;
    fileName: string | null;
    mimeType: string | null;
};

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
        const arrayBuffer = await response.arrayBuffer();
        const extension = resolveFileExtension(photo);
        const path = `${user.id}/${Date.now()}-${photo.id}.${extension}`;

        const { error: uploadError } = await supabase.storage.from(profilePhotosBucket).upload(path, arrayBuffer, {
            contentType: photo.mimeType ?? `image/${extension}`,
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