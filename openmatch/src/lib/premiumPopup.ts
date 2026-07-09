import AsyncStorage from '@react-native-async-storage/async-storage';

import { PremiumPromoVariant } from './premiumTargeting';

// ---------------------------------------------------------------------------
// Premium promo popup gating
//
// The popup is deliberately rare and non-coercive. It only appears when ALL of
// the following hold:
//   1. The behavior-targeted variant is "warm" (engaged / high_intent).
//   2. It has not been shown in the last MIN_GAP_MS (7 days).
//   3. It has not already been shown once this app session.
//   4. The user has not dismissed it MAX_DISMISSALS times without tapping the
//      CTA (after which it retires permanently and only opens on demand).
// ---------------------------------------------------------------------------

const LAST_SHOWN_KEY = 'premium_popup_last_shown_at';
const DISMISS_COUNT_KEY = 'premium_popup_dismiss_count';
const RETIRED_KEY = 'premium_popup_retired';

const MIN_GAP_MS = 7 * 24 * 60 * 60 * 1000; // 7 days between auto-popups.
const MAX_DISMISSALS = 2; // Retire after this many dismissals without a CTA tap.

// Only these behavior variants are allowed to auto-popup.
const WARM_VARIANT_IDS = new Set<PremiumPromoVariant['id']>(['engaged', 'high_intent']);

// Once-per-session guard. Module-level, so it resets on app reload.
let shownThisSession = false;

export function isWarmPremiumVariant(variant: PremiumPromoVariant): boolean {
    return WARM_VARIANT_IDS.has(variant.id);
}

/**
 * Returns true when the milestone-triggered popup is allowed to show for this
 * variant right now. Storage errors fail safe (suppress the popup).
 */
export async function shouldShowPremiumPopup(variant: PremiumPromoVariant): Promise<boolean> {
    if (!variant.showPromo || !isWarmPremiumVariant(variant)) {
        return false;
    }

    if (shownThisSession) {
        return false;
    }

    try {
        const [retired, lastShownRaw] = await Promise.all([
            AsyncStorage.getItem(RETIRED_KEY),
            AsyncStorage.getItem(LAST_SHOWN_KEY),
        ]);

        if (retired === 'true') {
            return false;
        }

        const lastShown = lastShownRaw ? Number(lastShownRaw) : 0;
        if (lastShown && !Number.isNaN(lastShown) && Date.now() - lastShown < MIN_GAP_MS) {
            return false;
        }

        return true;
    } catch (error) {
        console.warn('Premium popup gate storage error; suppressing popup.', error);
        return false;
    }
}

/** Marks the popup as shown (this session + persisted timestamp). */
export async function recordPremiumPopupShown(): Promise<void> {
    shownThisSession = true;
    try {
        await AsyncStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
    } catch (error) {
        console.warn('Could not persist premium popup shown timestamp.', error);
    }
}

/** A CTA tap is positive intent — reset the dismissal streak. */
export async function recordPremiumPopupCtaTapped(): Promise<void> {
    try {
        await AsyncStorage.setItem(DISMISS_COUNT_KEY, '0');
    } catch (error) {
        console.warn('Could not reset premium popup dismiss count.', error);
    }
}

/** A dismissal increments the streak; retire the popup after MAX_DISMISSALS. */
export async function recordPremiumPopupDismissed(): Promise<void> {
    try {
        const raw = await AsyncStorage.getItem(DISMISS_COUNT_KEY);
        const next = (raw ? Number(raw) : 0) + 1;
        await AsyncStorage.setItem(DISMISS_COUNT_KEY, String(Number.isNaN(next) ? 1 : next));

        if (next >= MAX_DISMISSALS) {
            await AsyncStorage.setItem(RETIRED_KEY, 'true');
        }
    } catch (error) {
        console.warn('Could not persist premium popup dismissal.', error);
    }
}
