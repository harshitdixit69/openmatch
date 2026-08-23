import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    DEFAULT_PROMPT_STATE,
    loadPromptState,
    MAX_PROMPT_DISMISSALS,
    MAX_PROMPT_SHOWS,
    parsePromptState,
    PROMPT_COOLDOWN_DAYS,
    recordPromptAccepted,
    recordPromptDismissed,
    recordPromptShown,
    shouldShowVerificationPrompt,
    verificationPromptKey,
    VerificationPromptState,
} from './verificationPrompt';

jest.mock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
    },
}));

const storage = AsyncStorage as unknown as {
    getItem: jest.Mock;
    setItem: jest.Mock;
};

const fresh: VerificationPromptState = { ...DEFAULT_PROMPT_STATE };
const NOW = new Date('2026-08-23T12:00:00Z');

function daysAgo(days: number) {
    return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('verificationPrompt', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        storage.setItem.mockResolvedValue(undefined);
        storage.getItem.mockResolvedValue(null);
    });

    describe('shouldShowVerificationPrompt', () => {
        it('shows for an unverified user with no history', () => {
            expect(shouldShowVerificationPrompt('unverified', fresh, NOW)).toBe(true);
        });

        it('shows for a rejected user so they can retry', () => {
            expect(shouldShowVerificationPrompt('rejected', fresh, NOW)).toBe(true);
        });

        it('never asks a verified user', () => {
            expect(shouldShowVerificationPrompt('verified', fresh, NOW)).toBe(false);
        });

        it('never asks while manual review is pending', () => {
            // Asking here would imply their submission was lost.
            expect(shouldShowVerificationPrompt('pending', fresh, NOW)).toBe(false);
        });

        it('stops permanently after two dismissals', () => {
            const state = { ...fresh, dismissedCount: MAX_PROMPT_DISMISSALS };

            expect(shouldShowVerificationPrompt('unverified', state, NOW)).toBe(false);
        });

        it('stops after the impression cap even without dismissals', () => {
            const state = { ...fresh, shownCount: MAX_PROMPT_SHOWS };

            expect(shouldShowVerificationPrompt('unverified', state, NOW)).toBe(false);
        });

        it('respects the cooldown window', () => {
            const state = { ...fresh, shownCount: 1, lastShownAt: daysAgo(PROMPT_COOLDOWN_DAYS - 1) };

            expect(shouldShowVerificationPrompt('unverified', state, NOW)).toBe(false);
        });

        it('shows again once the cooldown has elapsed', () => {
            const state = { ...fresh, shownCount: 1, lastShownAt: daysAgo(PROMPT_COOLDOWN_DAYS + 1) };

            expect(shouldShowVerificationPrompt('unverified', state, NOW)).toBe(true);
        });

        it('is not permanently suppressed by an unparseable timestamp', () => {
            const state = { ...fresh, shownCount: 1, lastShownAt: 'not-a-date' };

            expect(shouldShowVerificationPrompt('unverified', state, NOW)).toBe(true);
        });

        it('treats a missing status as unverified', () => {
            expect(shouldShowVerificationPrompt(null, fresh, NOW)).toBe(true);
            expect(shouldShowVerificationPrompt(undefined, fresh, NOW)).toBe(true);
        });
    });

    describe('parsePromptState', () => {
        it('falls back to defaults for junk input', () => {
            expect(parsePromptState(null)).toEqual(DEFAULT_PROMPT_STATE);
            expect(parsePromptState('nope')).toEqual(DEFAULT_PROMPT_STATE);
        });

        it('ignores fields of the wrong type', () => {
            expect(parsePromptState({ shownCount: '3', dismissedCount: null, lastShownAt: 7 })).toEqual(
                DEFAULT_PROMPT_STATE,
            );
        });
    });

    describe('persistence', () => {
        it('loads defaults when storage is empty', async () => {
            await expect(loadPromptState('u1')).resolves.toEqual(DEFAULT_PROMPT_STATE);
        });

        it('recovers from corrupt JSON', async () => {
            storage.getItem.mockResolvedValue('{broken');

            await expect(loadPromptState('u1')).resolves.toEqual(DEFAULT_PROMPT_STATE);
        });

        it('recordPromptShown increments the count and stamps the time', async () => {
            storage.getItem.mockResolvedValue(JSON.stringify({ ...fresh, shownCount: 1 }));

            const next = await recordPromptShown('u1');

            expect(next.shownCount).toBe(2);
            expect(next.lastShownAt).not.toBeNull();
            expect(storage.setItem).toHaveBeenCalledWith(
                verificationPromptKey('u1'),
                expect.stringContaining('"shownCount":2'),
            );
        });

        it('recordPromptDismissed increments dismissals only', async () => {
            storage.getItem.mockResolvedValue(JSON.stringify({ ...fresh, shownCount: 1 }));

            const next = await recordPromptDismissed('u1');

            expect(next.dismissedCount).toBe(1);
            expect(next.shownCount).toBe(1);
        });

        it('recordPromptAccepted stops any further prompting', async () => {
            await recordPromptAccepted('u1');

            const written = JSON.parse(storage.setItem.mock.calls[0][1]);
            expect(shouldShowVerificationPrompt('unverified', parsePromptState(written), NOW)).toBe(false);
        });
    });

    it('namespaces the storage key per user', () => {
        expect(verificationPromptKey('abc')).toBe('openmatch:verificationPrompt:abc');
        expect(verificationPromptKey('abc')).not.toBe(verificationPromptKey('xyz'));
    });
});
