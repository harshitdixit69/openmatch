import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';

/**
 * Lightweight anonymous analytics for top-of-funnel tracking.
 *
 * Answers questions like "did anyone even open the app?" and lets us measure the
 * signup funnel + marketing channel attribution — all before a user signs up.
 *
 * Privacy: we only store a randomly-generated device id (`anon_id`), never PII.
 * Events are best-effort and never throw / block the UI.
 */

const ANON_ID_KEY = 'openmatch.analytics.anon_id';
const USERNAME_KEY = 'openmatch.analytics.username';
const APP_VERSION = '1.0.0';

let cachedAnonId: string | null = null;
let cachedUtm: UtmParams | null = null;
let cachedUsername: string | null = null;
let usernameLoaded = false;

export type AppEventName =
    | 'app_opened'
    | 'auth_screen_viewed'
    | 'auth_intro_viewed'
    | 'auth_get_started_tapped'
    | 'auth_method_selected'
    | 'auth_google_tapped'
    | 'auth_google_success'
    | 'browse_as_guest_tapped'
    | 'guest_feed_viewed'
    | 'guest_action_gated'
    | 'signup_started'
    | 'otp_sent'
    | 'otp_send_failed'
    | 'otp_verified'
    | 'onboarding_step_viewed'
    | 'profile_completed';

type UtmParams = {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    referrer?: string;
};

function generateId(): string {
    // RFC4122-ish v4 without a crypto dependency (fine for a non-secret device id).
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

async function readStored(key: string): Promise<string | null> {
    try {
        if (Platform.OS === 'web') {
            return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
        }
        return await AsyncStorage.getItem(key);
    } catch {
        return null;
    }
}

async function writeStored(key: string, value: string): Promise<void> {
    try {
        if (Platform.OS === 'web') {
            if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
            return;
        }
        await AsyncStorage.setItem(key, value);
    } catch {
        // ignore
    }
}

async function getAnonId(): Promise<string> {
    if (cachedAnonId) return cachedAnonId;
    let id = await readStored(ANON_ID_KEY);
    if (!id) {
        id = generateId();
        await writeStored(ANON_ID_KEY, id);
    }
    cachedAnonId = id;
    return id;
}

/**
 * Associate a human-readable username with subsequent events (e.g. the user's
 * full name once their profile loads). Persisted so it survives reloads.
 */
export async function setAnalyticsUser(username: string | null | undefined): Promise<void> {
    const trimmed = username?.trim() || null;
    cachedUsername = trimmed;
    usernameLoaded = true;
    if (trimmed) {
        await writeStored(USERNAME_KEY, trimmed);
    }
}

/** Clear the associated username (call on sign-out). */
export async function clearAnalyticsUser(): Promise<void> {
    cachedUsername = null;
    usernameLoaded = true;
    try {
        if (Platform.OS === 'web') {
            if (typeof window !== 'undefined') window.localStorage.removeItem(USERNAME_KEY);
        } else {
            await AsyncStorage.removeItem(USERNAME_KEY);
        }
    } catch {
        // ignore
    }
}

async function getUsername(): Promise<string | null> {
    if (usernameLoaded) return cachedUsername;
    cachedUsername = await readStored(USERNAME_KEY);
    usernameLoaded = true;
    return cachedUsername;
}

/**
 * Capture UTM params + referrer from the web URL once per session so we can
 * attribute an install/open to a marketing channel (Instagram, WhatsApp, etc.).
 */
function captureUtm(): UtmParams {
    if (cachedUtm) return cachedUtm;
    const utm: UtmParams = {};
    try {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            utm.utm_source = params.get('utm_source') ?? undefined;
            utm.utm_medium = params.get('utm_medium') ?? undefined;
            utm.utm_campaign = params.get('utm_campaign') ?? undefined;
            utm.referrer = document.referrer || undefined;
        }
    } catch {
        // ignore
    }
    cachedUtm = utm;
    return utm;
}

/**
 * Fire-and-forget event tracker. Never throws; safe to call anywhere.
 */
export async function trackEvent(
    eventName: AppEventName,
    metadata: Record<string, unknown> = {},
): Promise<void> {
    try {
        const anonId = await getAnonId();
        const utm = captureUtm();
        const username = await getUsername();

        // Attach profile_id when the user is authenticated (best-effort, non-blocking).
        let profileId: string | null = null;
        try {
            const { data } = await supabase.auth.getUser();
            profileId = data.user?.id ?? null;
        } catch {
            profileId = null;
        }

        await supabase.from('app_events').insert({
            anon_id: anonId,
            profile_id: profileId,
            username: username ?? null,
            event_name: eventName,
            platform: Platform.OS,
            app_version: APP_VERSION,
            utm_source: utm.utm_source ?? null,
            utm_medium: utm.utm_medium ?? null,
            utm_campaign: utm.utm_campaign ?? null,
            referrer: utm.referrer ?? null,
            metadata,
        });
    } catch {
        // Analytics must never break the app.
    }
}
