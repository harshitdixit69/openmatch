// src/lib/paymentsApi.ts
//
// Powers Settings > Subscription & payments:
//   * getSubscriptionSummary() — the member's current plan, expiry and remaining credits
//   * getPaymentHistory()      — the owner-readable ledger (public.payment_history)
//   * restorePurchases()       — re-sync entitlements from the server (source of truth)
//
// The server is always authoritative: subscription state lives on public.profiles and is
// only ever written by the Stripe webhook. The client never grants itself entitlements.

import { supabase } from './supabase';
import { fetchCurrentProfile } from './profileApi';

export type SubscriptionTier =
    | 'free'
    | 'plus'
    | 'pro'
    | 'pro_max'
    | 'pro_supreme'
    | 'vip'
    | 'assisted';

export interface SubscriptionSummary {
    tier: SubscriptionTier;
    /** Human-friendly plan name, e.g. "Pro Max". */
    tierLabel: string;
    /** True when the user holds a paid tier that has not expired. */
    isActive: boolean;
    /** ISO expiry timestamp, or null for the free plan / never-purchased. */
    expiresAt: string | null;
    /** True when a paid plan exists but its expiry is in the past. */
    isExpired: boolean;
    credits: {
        unlocks: number;
        superInterests: number;
        spotlights: number;
        aiCalls: number;
    };
}

export interface PaymentRecord {
    id: string;
    kind: string;
    description: string | null;
    tier: string | null;
    durationMonths: number | null;
    amountMinor: number | null;
    currency: string;
    status: string;
    createdAt: string;
}

const TIER_LABELS: Record<string, string> = {
    free: 'Free',
    plus: 'Pro',
    pro: 'Pro',
    pro_max: 'Pro Max',
    pro_supreme: 'Pro Supreme',
    vip: 'VIP',
    assisted: 'Assisted',
};

export function tierLabel(tier: string | null | undefined): string {
    if (!tier) return 'Free';
    return TIER_LABELS[tier] ?? tier.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Formats a minor-unit amount (e.g. paise) into a display string like "₹299". */
export function formatAmount(amountMinor: number | null | undefined, currency = 'INR'): string {
    if (amountMinor == null) return '—';
    const symbol = currency === 'INR' ? '₹' : `${currency} `;
    const major = amountMinor / 100;
    return `${symbol}${major.toLocaleString('en-IN', { maximumFractionDigits: major % 1 === 0 ? 0 : 2 })}`;
}

/**
 * Reads the caller's current subscription state from their profile. The free tier (or a
 * lapsed paid tier) reports isActive === false so the UI can offer an upgrade CTA.
 */
export async function getSubscriptionSummary(): Promise<SubscriptionSummary> {
    const profile = await fetchCurrentProfile();

    const tier = (profile?.subscription_tier ?? 'free') as SubscriptionTier;
    const expiresAt = profile?.subscription_expires_at ?? null;
    const notFree = tier !== 'free';
    const expiryTime = expiresAt ? new Date(expiresAt).getTime() : null;
    const isExpired = notFree && expiryTime != null && expiryTime <= Date.now();
    const isActive = notFree && (expiryTime == null || expiryTime > Date.now());

    return {
        tier,
        tierLabel: tierLabel(tier),
        isActive,
        expiresAt,
        isExpired,
        credits: {
            unlocks: profile?.unlock_credits_remaining ?? profile?.manual_unlock_credits ?? 0,
            superInterests: profile?.super_interest_remaining ?? 0,
            spotlights: profile?.spotlights_remaining ?? 0,
            aiCalls: profile?.ai_call_credits ?? 0,
        },
    };
}

/**
 * Returns the caller's payment ledger, newest first. RLS guarantees a user only ever
 * sees their own rows. Returns an empty array when the table is empty or unavailable.
 */
export async function getPaymentHistory(limit = 50): Promise<PaymentRecord[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
        .from('payment_history')
        .select('id, kind, description, tier, duration_months, amount_minor, currency, status, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        // Table may not exist yet on an un-migrated environment, or the SELECT grant/RLS
        // may not be in place — in every such case a member simply has "no history" to
        // show. Never let this block the rest of the Manage Subscription screen.
        if (
            /does not exist|relation .* does not exist|permission denied|not have permission/i.test(
                error.message,
            ) ||
            (error as { code?: string }).code === '42501' ||
            (error as { code?: string }).code === '42P01'
        ) {
            return [];
        }
        throw error;
    }

    return (data ?? []).map((row: any) => ({
        id: row.id,
        kind: row.kind,
        description: row.description,
        tier: row.tier,
        durationMonths: row.duration_months,
        amountMinor: row.amount_minor,
        currency: row.currency ?? 'INR',
        status: row.status ?? 'succeeded',
        createdAt: row.created_at,
    }));
}

/**
 * "Restore purchases" for a Stripe-billed app: re-fetch the authoritative entitlement
 * state from the server. If a webhook had not yet propagated when the user last looked,
 * this pulls the latest. Returns the refreshed summary so the caller can report the
 * outcome (active plan restored vs. nothing to restore).
 */
export async function restorePurchases(): Promise<SubscriptionSummary> {
    return getSubscriptionSummary();
}
