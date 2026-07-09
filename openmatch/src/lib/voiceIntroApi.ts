import { supabase } from './supabase';

const voiceIntroBucket = 'intent-voice-intros';

export type VoiceIntroClip = {
    uri: string;
    durationSeconds: number;
    mimeType?: string | null;
};

export async function uploadCurrentUserVoiceIntro(clip: VoiceIntroClip) {
    const {
        data: { user },
        error,
    } = await supabase.auth.getUser();

    if (error) {
        throw error;
    }

    if (!user) {
        throw new Error('You must be signed in to upload a voice intro.');
    }

    const response = await fetch(clip.uri);
    const arrayBuffer = await response.arrayBuffer();
    const extension = resolveAudioExtension(clip.mimeType);
    const path = `${user.id}/${Date.now()}-voice-intro.${extension}`;

    const { error: uploadError } = await supabase.storage.from(voiceIntroBucket).upload(path, arrayBuffer, {
        contentType: clip.mimeType ?? `audio/${extension}`,
        upsert: false,
    });

    if (uploadError) {
        throw uploadError;
    }

    const { data } = supabase.storage.from(voiceIntroBucket).getPublicUrl(path);
    return data.publicUrl;
}

function resolveAudioExtension(mimeType: string | null | undefined) {
    const normalized = mimeType?.trim().toLowerCase() ?? '';

    if (normalized.includes('mpeg') || normalized.includes('mp3')) {
        return 'mp3';
    }

    if (normalized.includes('wav')) {
        return 'wav';
    }

    if (normalized.includes('aac')) {
        return 'aac';
    }

    return 'm4a';
}