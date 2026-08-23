import { Alert, Platform } from 'react-native';

/**
 * Normalizes raw backend, database, Supabase, network, and runtime error objects
 * into clear, polite, and actionable human-friendly error messages for UI display.
 */
export function getFriendlyErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
    if (!error) {
        return fallback;
    }

    let rawMessage = '';
    let errorCode = '';
    let errorStatus: number | string = '';

    if (typeof error === 'string') {
        rawMessage = error;
    } else if (typeof error === 'object' && error !== null) {
        const errObj = error as Record<string, any>;
        rawMessage =
            errObj.message ||
            errObj.error_description ||
            errObj.error ||
            errObj.msg ||
            (typeof errObj.toString === 'function' && errObj.toString() !== '[object Object]' ? errObj.toString() : '');
        errorCode = errObj.code || errObj.error_code || '';
        errorStatus = errObj.status || errObj.statusCode || '';
    }

    const lower = (rawMessage + ' ' + errorCode + ' ' + errorStatus).toLowerCase().trim();

    // 1. Missing / Invalid API Key or Supabase Gateway Auth error
    if (
        lower.includes('invalid api key') ||
        lower.includes('unauthorized_invalid_api_key') ||
        lower.includes('invalid api_key') ||
        lower.includes('apikey') ||
        lower.includes('project is paused') ||
        lower.includes('service unavailable') ||
        lower.includes('bad gateway') ||
        lower.includes('gateway timeout')
    ) {
        return 'Unable to connect to the authentication service. Please try again shortly or check your network.';
    }

    // 2. Network & Connectivity Issues
    if (
        lower.includes('network request failed') ||
        lower.includes('failed to fetch') ||
        lower.includes('fetch failed') ||
        lower.includes('networkerror') ||
        lower.includes('timeout') ||
        lower.includes('econnrefused') ||
        lower.includes('net::err') ||
        lower.includes('internet connection')
    ) {
        return 'No internet connection detected. Please check your network and try again.';
    }

    // 3. Invalid Login Credentials (Email/Password)
    if (
        lower.includes('invalid login credentials') ||
        lower.includes('invalid_grant') ||
        lower.includes('invalid credentials') ||
        lower.includes('invalid email or password')
    ) {
        return 'Incorrect email or password. Please verify your details and try again.';
    }

    // 4. Unconfirmed Email
    if (lower.includes('email not confirmed') || lower.includes('unconfirmed email')) {
        return 'Please check your email inbox and confirm your address before signing in.';
    }

    // 5. User Already Registered / Duplicate Email
    if (
        lower.includes('user already registered') ||
        lower.includes('user_already_exists') ||
        lower.includes('already registered') ||
        lower.includes('email address is already registered') ||
        lower.includes('duplicate key value')
    ) {
        return 'An account with this email or phone number already exists. Please sign in instead.';
    }

    // 6. Rate Limiting / Cooldown
    if (
        lower.includes('rate limit') ||
        lower.includes('over_email_send_rate_limit') ||
        lower.includes('over_sms_send_rate_limit') ||
        lower.includes('too many requests') ||
        lower.includes('429')
    ) {
        return 'Too many attempts. Please wait a few minutes before trying again.';
    }

    // 7. OTP Code Errors
    if (
        lower.includes('token has expired') ||
        lower.includes('otp expired') ||
        lower.includes('invalid token') ||
        lower.includes('token is invalid') ||
        lower.includes('invalid verification code') ||
        lower.includes('otp code is incorrect')
    ) {
        return 'Incorrect or expired verification code. Please enter the code carefully or request a new one.';
    }

    // 7b. Email Sending / SMTP Provider Errors
    if (
        lower.includes('error sending magic link email') ||
        lower.includes('error sending confirmation email') ||
        lower.includes('error sending email') ||
        lower.includes('smtp')
    ) {
        return 'Unable to send verification email. Please check the email address, try again in a few minutes, or use phone verification.';
    }

    // 8. SMS Provider Disabled in Dev Mode
    if (
        lower.includes('phone_provider_disabled') ||
        lower.includes('sms provider') ||
        lower.includes('unsupported phone provider')
    ) {
        return 'SMS verification service is temporarily unavailable. Please try email login or contact support.';
    }

    // 9. Session / JWT Expired or Unauthorized
    if (
        lower.includes('jwt expired') ||
        lower.includes('token expired') ||
        lower.includes('auth session missing') ||
        lower.includes('not authenticated') ||
        lower.includes('user not found') ||
        lower.includes('session has expired')
    ) {
        return 'Your session has expired. Please sign in again.';
    }

    // 10. Permission & Security (RLS, 403 Forbidden)
    if (
        lower.includes('permission denied') ||
        lower.includes('violates row-level security') ||
        lower.includes('rls') ||
        lower.includes('403') ||
        lower.includes('forbidden')
    ) {
        return 'You do not have permission to perform this action.';
    }

    // 11. Database / SQL / PostgREST Internal Errors (Never leak technical names)
    if (
        lower.includes('pgrst') ||
        lower.includes('syntax error') ||
        lower.includes('relation') ||
        lower.includes('column') ||
        lower.includes('violates check constraint') ||
        lower.includes('violates foreign key constraint') ||
        lower.includes('null value in column')
    ) {
        return fallback;
    }

    // 12. Password Quality Requirements
    if (
        lower.includes('password should be at least') ||
        lower.includes('weak password') ||
        lower.includes('password is too short')
    ) {
        return 'Password must be at least 8 characters long.';
    }

    // 13. AI Model / Ghostwriter / Copilot Errors
    if (
        lower.includes('gemini') ||
        lower.includes('openai') ||
        lower.includes('ai ghostwriter') ||
        lower.includes('ai copilot') ||
        lower.includes('resource exhausted') ||
        lower.includes('quota exceeded')
    ) {
        return 'AI assistant is temporarily busy. Please try again in a few moments.';
    }

    // 14. Camera & Media Permissions
    if (
        lower.includes('permission is required') ||
        lower.includes('camera permission') ||
        lower.includes('photo library permission') ||
        lower.includes('permission denied by user')
    ) {
        return 'Camera or photo library permission is required. Please grant access in your device settings.';
    }

    // 15. File / Upload Too Large
    if (
        lower.includes('exceeded the maximum allowed size') ||
        lower.includes('maximum allowed size') ||
        lower.includes('payload too large') ||
        lower.includes('entity too large') ||
        lower.includes('413')
    ) {
        return 'That photo is too large. Please choose a smaller image (under 5 MB) and try again.';
    }

    // 16. Clean user-provided validation strings that are already friendly
    if (
        rawMessage &&
        rawMessage.length < 150 &&
        !rawMessage.includes('{') &&
        !rawMessage.includes('}') &&
        !rawMessage.includes('TypeError') &&
        !rawMessage.includes('ReferenceError') &&
        !rawMessage.includes('SyntaxError') &&
        !rawMessage.includes('at ') &&
        !rawMessage.includes('http')
    ) {
        return rawMessage;
    }

    return fallback;
}

/**
 * Cross-platform alert that shows a sanitized, user-friendly error dialog.
 */
export function showFriendlyAlert(
    title: string,
    error: unknown,
    fallback = 'Something went wrong. Please try again.'
): void {
    // A plain non-empty string is an already human-readable message (e.g. a success
    // or informational notice), NOT a raw error to be sanitized. Running it through
    // getFriendlyErrorMessage would pattern-match it, find no known error signature,
    // and wrongly replace it with the generic fallback. Show it verbatim instead.
    const message =
        typeof error === 'string' && error.trim()
            ? error
            : getFriendlyErrorMessage(error, fallback);
    if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
            window.alert(`${title}\n\n${message}`);
            return;
        }
    }
    Alert.alert(title, message);
}
