// src/lib/notificationsApi.ts
// F8 – In-app Notifications
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type NotificationType =
    | 'new_match'
    | 'request_received'
    | 'request_accepted'
    | 'request_declined'
    | 'request_ghosted'
    | 'message_received'
    | 'contact_unlocked'
    | 'profile_viewed'
    | 'reliability_badge'
    | 'system';

export type AppNotification = {
    id: string;
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    metadata: Record<string, string>;
    isRead: boolean;
    createdAt: string;
};

type NotificationRow = {
    id: string;
    user_id: string;
    type: NotificationType;
    title: string;
    body: string;
    metadata: Record<string, string>;
    is_read: boolean;
    created_at: string;
};

function rowToNotification(r: NotificationRow): AppNotification {
    return {
        id: r.id,
        userId: r.user_id,
        type: r.type,
        title: r.title,
        body: r.body,
        metadata: r.metadata ?? {},
        isRead: r.is_read,
        createdAt: r.created_at,
    };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------
export async function fetchNotifications(limit = 60): Promise<AppNotification[]> {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) throw authErr ?? new Error('Not authenticated');

    const { data, error } = await supabase
        .from('notifications')
        .select('id, user_id, type, title, body, metadata, is_read, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit)
        .returns<NotificationRow[]>();

    if (error) throw error;
    return (data ?? []).map(rowToNotification);
}

// ---------------------------------------------------------------------------
// Mark single notification as read
// ---------------------------------------------------------------------------
export async function markNotificationRead(notificationId: string): Promise<void> {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) throw authErr ?? new Error('Not authenticated');

    const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId)
        .eq('user_id', user.id);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Mark all notifications as read
// ---------------------------------------------------------------------------
export async function markAllNotificationsRead(): Promise<void> {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) throw authErr ?? new Error('Not authenticated');

    await supabase.rpc('mark_all_notifications_read', { p_user_id: user.id });
}

// ---------------------------------------------------------------------------
// Realtime subscription
// ---------------------------------------------------------------------------
export function subscribeToNotifications(
    userId: string,
    onNew: (n: AppNotification) => void
): RealtimeChannel {
    return supabase
        .channel(`notifications:${userId}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${userId}`,
            },
            (payload) => {
                onNew(rowToNotification(payload.new as NotificationRow));
            }
        )
        .subscribe();
}
