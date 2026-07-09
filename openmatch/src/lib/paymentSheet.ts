import { UnlockPaymentIntent, UnlockPaymentSheetResult } from './chat';

const unsupportedMessage =
    'Stripe PaymentSheet is available in the iOS or Android build. Use the native app to unlock direct chat.';

export function supportsUnlockPayments() {
    return false;
}

export function getUnsupportedUnlockMessage() {
    return unsupportedMessage;
}

export async function presentUnlockPaymentSheet(_intent: UnlockPaymentIntent): Promise<UnlockPaymentSheetResult> {
    return {
        status: 'unsupported',
        message: unsupportedMessage,
    };
}