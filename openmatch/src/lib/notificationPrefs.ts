// src/lib/notificationPrefs.ts
//
// Single source of truth for in-app alert preferences. The mapping used to be
// duplicated: SettingsScreen owned the shape and MainTabsScreen re-implemented
// the type -> preference lookup inline. That drift produced a real bug where
// every 'system' notification was gated behind the "AI broker call alerts"
// switch, which ships off — so system notices were silently never shown.
//
// These are device-local (AsyncStorage). They gate the foreground in-app alert
// only; the app has no push notification transport yet.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type NotificationPrefs = {
    new_matches: boolean;
    new_messages: boolean;
    request_accepted: boolean;
    ghosting_reminders: boolean;
    system_alerts: boolean;
    broker_calls: boolean;
};

export const DEFAULT_NOTIF_PREFS: NotificationPrefs = {
    new_matches: true,
    new_messages: true,
    request_accepted: true,
    ghosting_reminders: true,
    // Account and safety notices. Defaults on — a user should never miss these
    // because of an unrelated toggle.
    system_alerts: true,
    broker_calls: false,
};

export const NOTIF_LABELS: Record<keyof NotificationPrefs, string> = {
    new_matches: 'New match suggestions',
    new_messages: 'New messages',
    request_accepted: 'Request accepted',
    ghosting_reminders: 'Follow-up reminders',
    system_alerts: 'Account & system notices',
    broker_calls: 'AI broker call alerts',
};

/** Notification `type` values as defined in 20260714000300_notifications.sql. */
export type NotificationType =
    | 'new_match'
    | 'message_received'
    | 'request_accepted'
    | 'request_received'
    | 'request_ghosted'
    | 'system';

const TYPE_TO_PREF: Record<NotificationType, keyof NotificationPrefs> = {
    new_match: 'new_matches',
    message_received: 'new_messages',
    request_accepted: 'request_accepted',
    request_received: 'request_accepted',
    request_ghosted: 'ghosting_reminders',
    system: 'system_alerts',
};

export function notifStorageKey(userId: string) {
    return `openmatch:notifPrefs:${userId}`;
}

/**
 * Merges stored prefs over the defaults.
 *
 * Reading stored JSON directly would drop any key added after the user last
 * saved, leaving it `undefined` and therefore falsy — a newly-added alert would
 * be off for every existing user. Merging keeps new keys at their default.
 */
export function mergeNotificationPrefs(stored: unknown): NotificationPrefs {
    if (!stored || typeof stored !== 'object') {
        return { ...DEFAULT_NOTIF_PREFS };
    }

    const merged = { ...DEFAULT_NOTIF_PREFS };
    for (const key of Object.keys(DEFAULT_NOTIF_PREFS) as (keyof NotificationPrefs)[]) {
        const value = (stored as Record<string, unknown>)[key];
        if (typeof value === 'boolean') {
            merged[key] = value;
        }
    }
    return merged;
}

/** Whether an in-app alert should be surfaced for this notification type. */
export function isNotificationEnabled(type: string, prefs: NotificationPrefs | null): boolean {
    if (!prefs) return true;

    const prefKey = TYPE_TO_PREF[type as NotificationType];
    // Unknown/future types are shown rather than swallowed.
    if (!prefKey) return true;

    return prefs[prefKey] !== false;
}

export async function loadNotificationPrefs(userId: string): Promise<NotificationPrefs> {
    try {
        const raw = await AsyncStorage.getItem(notifStorageKey(userId));
        return mergeNotificationPrefs(raw ? JSON.parse(raw) : null);
    } catch (error) {
        console.warn('Failed to load notification preferences:', error);
        return { ...DEFAULT_NOTIF_PREFS };
    }
}

export async function saveNotificationPrefs(userId: string, prefs: NotificationPrefs): Promise<void> {
    try {
        await AsyncStorage.setItem(notifStorageKey(userId), JSON.stringify(prefs));
    } catch (error) {
        console.warn('Failed to save notification preferences:', error);
    }
}
