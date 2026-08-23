import { supabase } from './supabase';

const voiceIntroBucket = 'intent-voice-intros';

// The bucket is PRIVATE (see 20260823030000_private_media_buckets.sql); we issue signed
// URLs so voice intros are not anonymously reachable at a guessable path. Long TTL because
// the URL is persisted and echoed by server RPCs.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 5; // ~5 years

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

    const { data, error: signError } = await supabase.storage
        .from(voiceIntroBucket)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (signError || !data?.signedUrl) {
        throw signError ?? new Error('Could not generate a URL for the uploaded voice intro.');
    }

    return data.signedUrl;
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