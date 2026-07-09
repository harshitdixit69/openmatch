import { PremiumAnalyticsSurface, trackPremiumEvent } from './premiumAnalytics';
import { supabase } from './supabase';

type PremiumEventName = 'premium_promo_impression' | 'premium_promo_cta_tap' | 'premium_highlight_card_open' | 'premium_highlight_interest_tap';

type PremiumEventRow = {
    event_name: PremiumEventName;
    created_at: string;
};

export type PremiumPromoVariantId = 'starter' | 'high_intent' | 'engaged' | 'cooldown';
export type PremiumExperimentArm = 'A' | 'B';

export type PremiumPromoVariant = {
    id: PremiumPromoVariantId;
    experimentArm: PremiumExperimentArm;
    showPromo: boolean;
    shouldTrackImpression: boolean;
    eyebrow: string;
    title: string;
    body: string;
    ctaLabel: string;
    ctaNotice: string;
    impressionContext: string;
    ctaContext: string;
};

const IMPRESSION_COOLDOWN_MS = 20 * 60 * 1000;

export function getDefaultPremiumPromoVariant(surface: PremiumAnalyticsSurface): PremiumPromoVariant {
    const isHome = surface === 'home_feed';
    return {
        id: 'starter',
        experimentArm: 'A',
        showPromo: true,
        shouldTrackImpression: true,
        eyebrow: isHome ? 'Premium spotlight' : 'Premium preview',
        title: isHome ? 'Boost visibility without hiding core chat' : 'Priority profile placement',
        body: isHome
            ? 'Optional premium boosts can highlight your profile in discovery while keeping matching and escrow chat free.'
            : 'Optional promo placements can improve profile visibility while keeping core request and chat flow open to free users.',
        ctaLabel: 'Coming soon',
        ctaNotice: 'Optional premium boosts are being tuned and will stay non-coercive.',
        impressionContext: 'starter_a',
        ctaContext: 'starter_cta_a',
    };
}

export async function resolvePremiumPromoVariant(surface: PremiumAnalyticsSurface) {
    const fallback = getDefaultPremiumPromoVariant(surface);

    try {
        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
            return fallback;
        }

        const experimentArm = resolveExperimentArm(user.id);

        const { data, error } = await supabase
            .from('premium_analytics_events')
            .select('event_name, created_at')
            .eq('profile_id', user.id)
            .eq('surface', surface)
            .order('created_at', { ascending: false })
            .limit(80)
            .returns<PremiumEventRow[]>();

        if (error) {
            if (isMissingPremiumAnalyticsTable(error.message)) {
                return fallback;
            }

            throw error;
        }

        const events = data ?? [];
        const impressionEvents = events.filter((event) => event.event_name === 'premium_promo_impression');
        const ctaTapCount = events.filter((event) => event.event_name === 'premium_promo_cta_tap').length;
        const highlightOpenCount = events.filter((event) => event.event_name === 'premium_highlight_card_open').length;
        const highlightInterestCount = events.filter((event) => event.event_name === 'premium_highlight_interest_tap').length;

        const lastImpressionAt = impressionEvents[0]?.created_at ? new Date(impressionEvents[0].created_at).getTime() : null;
        const now = Date.now();
        const shouldTrackImpression = !lastImpressionAt || Number.isNaN(lastImpressionAt) || now - lastImpressionAt > IMPRESSION_COOLDOWN_MS;

        if (ctaTapCount >= 2 || highlightInterestCount >= 3) {
            return applyExperimentArm(
                {
                    ...fallback,
                    id: 'engaged',
                    shouldTrackImpression,
                    eyebrow: 'Premium fit',
                    title: 'You seem ready for profile acceleration',
                    body: 'Because you engage with highlighted profiles, we can surface your profile in higher-intent slots without touching free chat access.',
                    ctaLabel: 'Notify me first',
                    ctaNotice: 'We noted your interest and will prioritize you for the first premium rollout.',
                    impressionContext: 'engaged',
                    ctaContext: 'engaged_cta',
                },
                experimentArm,
                surface,
            );
        }

        if (highlightOpenCount >= 3) {
            return applyExperimentArm(
                {
                    ...fallback,
                    id: 'high_intent',
                    shouldTrackImpression,
                    eyebrow: 'Premium signal',
                    title: 'See more profile-intent shortcuts',
                    body: 'You often open highlighted profiles. Premium can add cleaner priority lanes while preserving the free match and escrow flow.',
                    ctaLabel: 'Show me preview',
                    ctaNotice: 'Preview access will open soon with fair, non-coercive pricing.',
                    impressionContext: 'high_intent',
                    ctaContext: 'high_intent_cta',
                },
                experimentArm,
                surface,
            );
        }

        if (impressionEvents.length >= 6 && ctaTapCount === 0) {
            return applyExperimentArm(
                {
                    ...fallback,
                    id: 'cooldown',
                    shouldTrackImpression,
                    eyebrow: 'No pressure',
                    title: 'Keep exploring free matches first',
                    body: 'Premium is optional. Your core journey stays fully usable while we quietly test upgrades in the background.',
                    ctaLabel: 'Maybe later',
                    ctaNotice: 'No action needed. We will keep premium optional and non-intrusive.',
                    impressionContext: 'cooldown',
                    ctaContext: 'cooldown_cta',
                },
                experimentArm,
                surface,
            );
        }

        return applyExperimentArm(
            {
                ...fallback,
                shouldTrackImpression,
                impressionContext: 'starter',
                ctaContext: 'starter_cta',
            },
            experimentArm,
            surface,
        );
    } catch (error) {
        console.warn('Premium targeting fallback used.', error);
        return fallback;
    }
}

export async function trackPremiumPromoImpressionIfNeeded(surface: PremiumAnalyticsSurface, variant: PremiumPromoVariant) {
    if (!variant.showPromo || !variant.shouldTrackImpression) {
        return;
    }

    await trackPremiumEvent({
        eventName: 'premium_promo_impression',
        surface,
        context: variant.impressionContext,
        metadata: {
            variant: variant.id,
            experimentArm: variant.experimentArm,
        },
    });
}

function resolveExperimentArm(seed: string): PremiumExperimentArm {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
        hash = (hash * 31 + seed.charCodeAt(index)) % 9973;
    }

    return hash % 2 === 0 ? 'A' : 'B';
}

function applyExperimentArm(
    variant: Omit<PremiumPromoVariant, 'experimentArm'>,
    arm: PremiumExperimentArm,
    surface: PremiumAnalyticsSurface,
): PremiumPromoVariant {
    const isHome = surface === 'home_feed';
    const base: PremiumPromoVariant = {
        ...variant,
        experimentArm: arm,
        impressionContext: `${variant.impressionContext}_${arm.toLowerCase()}`,
        ctaContext: `${variant.ctaContext}_${arm.toLowerCase()}`,
    };

    if (arm === 'A') {
        return base;
    }

    if (base.id === 'engaged') {
        return {
            ...base,
            eyebrow: 'Premium momentum',
            title: 'Fast-track your profile visibility',
            body: 'You are already interacting with high-intent profiles. Premium can increase your qualified exposure while free chat remains untouched.',
            ctaLabel: 'Reserve my spot',
            ctaNotice: 'You are on the early-access waitlist for momentum-based premium boosts.',
        };
    }

    if (base.id === 'high_intent') {
        return {
            ...base,
            eyebrow: 'Premium insight',
            title: 'Open more high-intent profiles first',
            body: 'Based on your profile review pattern, premium can prioritize serious matches without changing the free escrow chat journey.',
            ctaLabel: 'See early access',
            ctaNotice: 'Early access is limited and will roll out in small waves.',
        };
    }

    if (base.id === 'cooldown') {
        return {
            ...base,
            eyebrow: 'Take your time',
            title: 'Premium stays optional, always',
            body: 'No pressure. Continue with free matching and chat while we refine premium add-ons in the background.',
            ctaLabel: 'Hide for now',
            ctaNotice: 'Understood. We will keep premium prompts lightweight.',
        };
    }

    return {
        ...base,
        eyebrow: isHome ? 'Premium preview' : 'Premium option',
        title: isHome ? 'Get discovered by more serious profiles' : 'See cleaner priority lanes',
        body: isHome
            ? 'Premium can increase profile discovery reach while core match and chat actions stay free.'
            : 'Premium can improve placement in high-intent inbox moments without gating requests or chat.',
        ctaLabel: 'Get early access',
        ctaNotice: 'Early access preferences saved. We will notify you when this rolls out.',
    };
}

function isMissingPremiumAnalyticsTable(message: string | undefined) {
    return /premium_analytics_events/i.test(message ?? '') && /(does not exist|relation)/i.test(message ?? '');
}
