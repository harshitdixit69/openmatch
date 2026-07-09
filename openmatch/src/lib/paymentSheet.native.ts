import {
    initPaymentSheet,
    initStripe,
    presentPaymentSheet,
} from '@stripe/stripe-react-native';
import { Platform } from 'react-native';

import { UnlockPaymentIntent, UnlockPaymentSheetResult } from './chat';

const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
const merchantIdentifier = process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER?.trim();
const applePayCountryCode = process.env.EXPO_PUBLIC_STRIPE_APPLE_PAY_COUNTRY_CODE?.trim() ?? 'IN';
const returnUrl = 'openmatch://stripe-redirect';

let stripeInitialized = false;

export function supportsUnlockPayments() {
    return Boolean(publishableKey);
}

export function getUnsupportedUnlockMessage() {
    return 'Missing EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY in the app environment.';
}

export async function presentUnlockPaymentSheet(intent: UnlockPaymentIntent): Promise<UnlockPaymentSheetResult> {
    if (!publishableKey) {
        throw new Error(getUnsupportedUnlockMessage());
    }

    if (!intent.clientSecret) {
        throw new Error('Unlock payment intent did not include a client secret.');
    }

    if (!stripeInitialized) {
        await initStripe({
            publishableKey,
            merchantIdentifier,
            urlScheme: 'openmatch',
        });

        stripeInitialized = true;
    }

    const paymentSheet = await initPaymentSheet({
        merchantDisplayName: intent.merchantDisplayName,
        paymentIntentClientSecret: intent.clientSecret,
        returnURL: returnUrl,
        applePay:
            Platform.OS === 'ios' && merchantIdentifier
                ? {
                    merchantCountryCode: applePayCountryCode,
                }
                : undefined,
        allowsDelayedPaymentMethods: false,
    });

    if (paymentSheet.error) {
        throw new Error(paymentSheet.error.message);
    }

    const result = await presentPaymentSheet();
    if (!result.error) {
        return {
            status: 'completed',
            message: null,
        };
    }

    if (result.error.code === 'Canceled') {
        return {
            status: 'canceled',
            message: result.error.message ?? 'Payment canceled.',
        };
    }

    throw new Error(result.error.message);
}