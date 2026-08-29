// src/lib/pushNotifications.ts
//
// Push notification transport for OpenMatch.
//
// This module owns the *device* side of push:
//   1. Ask the OS for notification permission.
//   2. Fetch the Expo push token for this device.
//   3. Persist it to Supabase (`push_tokens`) so server-side Edge Functions can
//      deliver alerts while the app is backgrounded or killed.
//   4. Wire foreground/response listeners for deep-linking.
//
// The actual sending happens server-side: a Postgres trigger on the
// `notifications` table calls the `send-push` Edge Function, which looks up the
// user's tokens here and relays through the Expo Push API to APNs/FCM.
//
// Web note: `expo-notifications` does NOT implement browser Web Push. On web we
// simply no-op here; browser push is a separate service-worker + VAPID flow.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { supabase } from './supabase';

// Show alerts/badges even when the app is foregrounded.
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
    }),
});

const ANDROID_CHANNEL_ID = 'default';

function isWeb(): boolean {
    return Platform.OS === 'web';
}

/**
 * Resolve the EAS project id (required by getExpoPushTokenAsync on SDK 49+).
 */
function getProjectId(): string | undefined {
    return (
        Constants?.expoConfig?.extra?.eas?.projectId ??
        // Fallback for bare/dev builds where expoConfig may be null.
        (Constants as any)?.easConfig?.projectId
    );
}

/**
 * Ask for permission and return the Expo push token for this device, or null if
 * unavailable (simulator, web, denied permission, etc.).
 */
export async function getExpoPushToken(): Promise<string | null> {
    if (isWeb()) return null;
    // Push tokens are not issued on simulators/emulators.
    if (!Device.isDevice) return null;

    try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        let status = existing;
        if (existing !== 'granted') {
            const req = await Notifications.requestPermissionsAsync();
            status = req.status;
        }
        if (status !== 'granted') return null;

        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
                name: 'Default',
                importance: Notifications.AndroidImportance.HIGH,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#E6C687',
            });
        }

        const projectId = getProjectId();
        const tokenResponse = await Notifications.getExpoPushTokenAsync(
            projectId ? { projectId } : undefined,
        );
        return tokenResponse.data ?? null;
    } catch (err) {
        console.warn('[push] Failed to obtain Expo push token', err);
        return null;
    }
}

/**
 * Register (or refresh) the current device's push token for the signed-in user.
 * Safe to call on every app launch / login — it upserts by token.
 */
export async function registerPushToken(userId: string): Promise<void> {
    if (isWeb()) return;
    const token = await getExpoPushToken();
    if (!token) return;

    const { error } = await supabase.from('push_tokens').upsert(
        {
            user_id: userId,
            token,
            platform: Platform.OS,
            enabled: true,
            updated_at: new Date().toISOString(),
        },
        { onConflict: 'token' },
    );

    if (error) {
        console.warn('[push] Failed to persist push token', error.message);
    }
}

/**
 * Disable the current device token on logout so a signed-out phone stops
 * receiving that user's alerts. We soft-disable rather than delete so we keep
 * delivery analytics.
 */
export async function unregisterPushToken(): Promise<void> {
    if (isWeb()) return;
    const token = await getExpoPushToken();
    if (!token) return;

    await supabase
        .from('push_tokens')
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq('token', token);
}

/**
 * Attach foreground + tap-response listeners. Returns an unsubscribe function.
 * `onDeepLink` receives the `metadata` payload (match_id, request_id, etc.) so
 * the app can navigate to the right screen when a notification is tapped.
 */
export function addNotificationListeners(
    onDeepLink?: (metadata: Record<string, unknown>) => void,
): () => void {
    if (isWeb()) return () => undefined;

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data ?? {};
        onDeepLink?.(data as Record<string, unknown>);
    });

    return () => {
        responseSub.remove();
    };
}
