// src/lib/verificationPrompt.ts
//
// Decides whether to nudge a user to verify their identity.
//
// Verification asks for a government ID and a live selfie — the heaviest ask in
// the app. So the prompt is deliberately conservative: it only fires after the
// user has sent an interest request (the moment they actually want to be
// believed), never more than a few times, and never again once they have said
// no twice.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export type VerificationPromptState = {
    /** How many times the prompt has been shown. */
    shownCount: number;
    /** How many times the user actively dismissed it. */
    dismissedCount: number;
    /** ISO timestamp of the last time it was shown. */
    lastShownAt: string | null;
};

export const DEFAULT_PROMPT_STATE: VerificationPromptState = {
    shownCount: 0,
    dismissedCount: 0,
    lastShownAt: null,
};

/** Stop asking after this many impressions, however the user reacted. */
export const MAX_PROMPT_SHOWS = 3;
/** Two explicit dismissals is a clear no. Never ask again. */
export const MAX_PROMPT_DISMISSALS = 2;
/** Minimum gap between impressions. */
export const PROMPT_COOLDOWN_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export function verificationPromptKey(userId: string) {
    return `openmatch:verificationPrompt:${userId}`;
}

export function parsePromptState(stored: unknown): VerificationPromptState {
    if (!stored || typeof stored !== 'object') {
        return { ...DEFAULT_PROMPT_STATE };
    }

    const raw = stored as Record<string, unknown>;
    return {
        shownCount: typeof raw.shownCount === 'number' ? raw.shownCount : 0,
        dismissedCount: typeof raw.dismissedCount === 'number' ? raw.dismissedCount : 0,
        lastShownAt: typeof raw.lastShownAt === 'string' ? raw.lastShownAt : null,
    };
}

/**
 * Pure decision function so the frequency rules are testable without storage.
 *
 * `now` is injectable for the same reason.
 */
export function shouldShowVerificationPrompt(
    status: VerificationStatus | null | undefined,
    state: VerificationPromptState,
    now: Date = new Date(),
): boolean {
    // Already verified, or awaiting manual review — nothing to ask for.
    if (status === 'verified' || status === 'pending') return false;

    if (state.dismissedCount >= MAX_PROMPT_DISMISSALS) return false;
    if (state.shownCount >= MAX_PROMPT_SHOWS) return false;

    if (state.lastShownAt) {
        const last = new Date(state.lastShownAt).getTime();
        // An unparseable timestamp should not permanently suppress the prompt.
        if (!Number.isNaN(last) && now.getTime() - last < PROMPT_COOLDOWN_DAYS * DAY_MS) {
            return false;
        }
    }

    return true;
}

export async function loadPromptState(userId: string): Promise<VerificationPromptState> {
    try {
        const raw = await AsyncStorage.getItem(verificationPromptKey(userId));
        return parsePromptState(raw ? JSON.parse(raw) : null);
    } catch (error) {
        console.warn('Failed to load verification prompt state:', error);
        return { ...DEFAULT_PROMPT_STATE };
    }
}

async function writePromptState(userId: string, state: VerificationPromptState): Promise<void> {
    try {
        await AsyncStorage.setItem(verificationPromptKey(userId), JSON.stringify(state));
    } catch (error) {
        console.warn('Failed to save verification prompt state:', error);
    }
}

export async function recordPromptShown(userId: string): Promise<VerificationPromptState> {
    const current = await loadPromptState(userId);
    const next: VerificationPromptState = {
        ...current,
        shownCount: current.shownCount + 1,
        lastShownAt: new Date().toISOString(),
    };
    await writePromptState(userId, next);
    return next;
}

export async function recordPromptDismissed(userId: string): Promise<VerificationPromptState> {
    const current = await loadPromptState(userId);
    const next: VerificationPromptState = {
        ...current,
        dismissedCount: current.dismissedCount + 1,
    };
    await writePromptState(userId, next);
    return next;
}

/** Accepting means they are on their way to the verification screen — stop asking. */
export async function recordPromptAccepted(userId: string): Promise<void> {
    await writePromptState(userId, {
        shownCount: MAX_PROMPT_SHOWS,
        dismissedCount: 0,
        lastShownAt: new Date().toISOString(),
    });
}
