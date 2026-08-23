import {
    DEFAULT_NOTIF_PREFS,
    isNotificationEnabled,
    mergeNotificationPrefs,
    notifStorageKey,
    NOTIF_LABELS,
    NotificationPrefs,
} from './notificationPrefs';

// The real module needs a native module that does not exist under Jest.
jest.mock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
    },
}));

describe('notificationPrefs', () => {
    describe('DEFAULT_NOTIF_PREFS', () => {
        it('defaults account and system notices to on', () => {
            // Regression: 'system' used to be gated behind broker_calls, which
            // ships off, so system notices were silently never surfaced.
            expect(DEFAULT_NOTIF_PREFS.system_alerts).toBe(true);
        });

        it('has a label for every preference', () => {
            for (const key of Object.keys(DEFAULT_NOTIF_PREFS) as (keyof NotificationPrefs)[]) {
                expect(NOTIF_LABELS[key]).toMatch(/[A-Za-z]/);
            }
        });
    });

    describe('mergeNotificationPrefs', () => {
        it('returns the defaults for null or non-object input', () => {
            expect(mergeNotificationPrefs(null)).toEqual(DEFAULT_NOTIF_PREFS);
            expect(mergeNotificationPrefs('nonsense')).toEqual(DEFAULT_NOTIF_PREFS);
            expect(mergeNotificationPrefs(undefined)).toEqual(DEFAULT_NOTIF_PREFS);
        });

        it('keeps a newly added key at its default when stored data predates it', () => {
            // A user who saved before system_alerts existed must not end up with
            // it undefined (and therefore falsy).
            const legacy = {
                new_matches: false,
                new_messages: true,
                request_accepted: true,
                ghosting_reminders: true,
                broker_calls: false,
            };

            const merged = mergeNotificationPrefs(legacy);

            expect(merged.new_matches).toBe(false);
            expect(merged.system_alerts).toBe(true);
        });

        it('ignores non-boolean values', () => {
            const merged = mergeNotificationPrefs({ new_messages: 'yes', new_matches: 0 });

            expect(merged.new_messages).toBe(true);
            expect(merged.new_matches).toBe(true);
        });

        it('does not mutate the shared defaults', () => {
            const merged = mergeNotificationPrefs({ new_matches: false });
            merged.new_messages = false;

            expect(DEFAULT_NOTIF_PREFS.new_matches).toBe(true);
            expect(DEFAULT_NOTIF_PREFS.new_messages).toBe(true);
        });
    });

    describe('isNotificationEnabled', () => {
        const allOff: NotificationPrefs = {
            new_matches: false,
            new_messages: false,
            request_accepted: false,
            ghosting_reminders: false,
            system_alerts: false,
            broker_calls: false,
        };

        it('shows everything when there are no stored prefs', () => {
            expect(isNotificationEnabled('system', null)).toBe(true);
            expect(isNotificationEnabled('new_match', null)).toBe(true);
        });

        it('maps each notification type to its preference', () => {
            expect(isNotificationEnabled('new_match', allOff)).toBe(false);
            expect(isNotificationEnabled('message_received', allOff)).toBe(false);
            expect(isNotificationEnabled('request_accepted', allOff)).toBe(false);
            expect(isNotificationEnabled('request_received', allOff)).toBe(false);
            expect(isNotificationEnabled('request_ghosted', allOff)).toBe(false);
            expect(isNotificationEnabled('system', allOff)).toBe(false);
        });

        it('does not gate system notices behind the broker toggle', () => {
            // The original bug, pinned: broker off must not mute system notices.
            const brokerOff: NotificationPrefs = { ...DEFAULT_NOTIF_PREFS, broker_calls: false };

            expect(isNotificationEnabled('system', brokerOff)).toBe(true);
        });

        it('surfaces unknown types rather than swallowing them', () => {
            expect(isNotificationEnabled('some_future_type', allOff)).toBe(true);
        });
    });

    it('namespaces the storage key per user', () => {
        expect(notifStorageKey('abc')).toBe('openmatch:notifPrefs:abc');
        expect(notifStorageKey('abc')).not.toBe(notifStorageKey('xyz'));
    });
});
