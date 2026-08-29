import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';

import { getFriendlyErrorMessage, showFriendlyAlert } from '../lib/errorUtils';
import { supabase } from '../lib/supabase';
import { trackEvent } from '../lib/analytics';
import { useTheme } from '../lib/theme';
import { GoogleLogo } from './GoogleLogo';

// Ensure the browser auth session is dismissed correctly after redirect (native).
WebBrowser.maybeCompleteAuthSession();

type AuthStep = 'phone-input' | 'otp-verify' | 'email-fallback' | 'email-otp-verify';

// H2 FIX: OTP rate limiting constants
const OTP_MAX_REQUESTS = 3;
const OTP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Email OTP mock: only used when explicitly enabled via env flag. This lets you
// test the signup UI locally without SMTP. To send REAL OTP emails, leave this
// unset (or set to 'false') and configure SMTP in the Supabase dashboard.
const ENABLE_MOCK_EMAIL_OTP =
    process.env.EXPO_PUBLIC_ENABLE_MOCK_EMAIL_OTP === 'true';

export function AuthForm() {
    const [step, setStep] = useState<AuthStep>('phone-input');

    // H2 FIX: Track OTP request timestamps for rate limiting
    const otpRequestTimestamps = useRef<number[]>([]);
    const [selectedCountryCode, setSelectedCountryCode] = useState('+91');
    const [rawPhone, setRawPhone] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info');

    // Resend OTP countdown
    const [resendCooldown, setResendCooldown] = useState(0);

    // Mock fallback when SMS provider is disabled in Supabase dashboard
    const [isMockMode, setIsMockMode] = useState(false);
    const [mockCode, setMockCode] = useState<string | null>(null);

    // Email fallback state
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [emailMode, setEmailMode] = useState<'signin' | 'signup'>('signin');
    const [emailOtpCode, setEmailOtpCode] = useState('');

    // C6 FIX: ToS/Privacy acceptance
    const [tosAccepted, setTosAccepted] = useState(false);

    const { colors } = useTheme();

    useEffect(() => {
        if (resendCooldown <= 0) return;
        const timer = setInterval(() => {
            setResendCooldown((prev) => Math.max(0, prev - 1));
        }, 1000);
        return () => clearInterval(timer);
    }, [resendCooldown]);

    // Format phone number into E.164 (+919876543210)
    function getFormattedPhone(): string {
        const cleaned = rawPhone.replace(/[^0-9]/g, '');
        if (rawPhone.startsWith('+')) {
            return '+' + cleaned;
        }
        const countryDigits = selectedCountryCode.replace('+', '');
        if (cleaned.startsWith(countryDigits)) {
            return '+' + cleaned;
        }
        return selectedCountryCode + cleaned;
    }

    // Sign in with Google via Supabase OAuth (works on web + native).
    async function handleGoogleSignIn() {
        setLoading(true);
        setStatusMessage('');
        try {
            trackEvent('auth_google_tapped');

            if (Platform.OS === 'web') {
                const { error } = await supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo:
                            typeof window !== 'undefined' ? window.location.origin : undefined,
                    },
                });
                if (error) throw error;
                // The browser will redirect to Google and back automatically.
                return;
            }

            // Native (iOS / Android): open an in-app browser auth session.
            const redirectTo = AuthSession.makeRedirectUri();
            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo, skipBrowserRedirect: true },
            });
            if (error) throw error;
            if (!data?.url) throw new Error('Could not start Google sign-in.');

            const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
            if (result.type !== 'success' || !result.url) {
                // User cancelled or dismissed the browser.
                setLoading(false);
                return;
            }

            // Parse tokens / code from the redirect URL and establish the session.
            const returnedUrl = result.url;
            const hashPart = returnedUrl.includes('#') ? returnedUrl.split('#')[1] : '';
            const queryPart = returnedUrl.includes('?')
                ? returnedUrl.split('?')[1].split('#')[0]
                : '';
            const params = new URLSearchParams(hashPart || queryPart);

            const accessToken = params.get('access_token');
            const refreshToken = params.get('refresh_token');
            const code = params.get('code');

            if (accessToken && refreshToken) {
                const { error: sessErr } = await supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken,
                });
                if (sessErr) throw sessErr;
            } else if (code) {
                const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
                if (exErr) throw exErr;
            } else {
                throw new Error('Google sign-in did not return a valid session.');
            }

            trackEvent('auth_google_success');
        } catch (err) {
            const msg = getFriendlyErrorMessage(err);
            setStatusType('error');
            setStatusMessage(msg);
            showFriendlyAlert('Google Sign-In Failed', msg);
        } finally {
            setLoading(false);
        }
    }

    // Validate phone number
    function validatePhone(): boolean {
        const cleaned = rawPhone.replace(/[^0-9]/g, '');
        if (cleaned.length < 7 || cleaned.length > 15) {
            const msg = 'Please enter a valid mobile number (10 digits).';
            if (Platform.OS === 'web') alert(msg);
            else Alert.alert('Invalid Phone Number', msg);
            return false;
        }
        return true;
    }

    // Step 1: Send Phone OTP via Supabase
    async function handleSendPhoneOtp() {
        if (!validatePhone()) return;

        trackEvent('signup_started', { method: 'phone' });

        // H2 FIX: Client-side OTP rate limiting
        const now = Date.now();
        otpRequestTimestamps.current = otpRequestTimestamps.current.filter(
            (t) => now - t < OTP_WINDOW_MS
        );
        if (otpRequestTimestamps.current.length >= OTP_MAX_REQUESTS) {
            const remainingMs = OTP_WINDOW_MS - (now - otpRequestTimestamps.current[0]);
            const remainingMin = Math.ceil(remainingMs / 60000);
            const msg = `Too many OTP requests. Please try again in ${remainingMin} minute${remainingMin > 1 ? 's' : ''}.`;
            setStatusType('error');
            setStatusMessage(msg);
            if (Platform.OS === 'web') alert(msg);
            else Alert.alert('Rate Limit', msg);
            return;
        }
        otpRequestTimestamps.current.push(now);

        const formattedPhone = getFormattedPhone();
        setLoading(true);
        setStatusMessage('');

        try {
            if (__DEV__) console.log('[Auth] Requesting Phone OTP for:', formattedPhone);
            const { error } = await supabase.auth.signInWithOtp({
                phone: formattedPhone,
                options: {
                    shouldCreateUser: true,
                },
            });

            if (error) {
                const errMsg = error.message.toLowerCase();
                // C1 FIX: Only allow mock OTP fallback in development builds
                if (
                    __DEV__ &&
                    (
                        error.code === 'phone_provider_disabled' ||
                        errMsg.includes('provider') ||
                        errMsg.includes('disabled') ||
                        errMsg.includes('unsupported')
                    )
                ) {
                    console.log('[Auth] Supabase SMS provider disabled. Activating mock OTP fallback (DEV ONLY).');
                    setIsMockMode(true);
                    setMockCode('123456');
                    setStep('otp-verify');
                    setResendCooldown(30);
                    setStatusType('info');
                    setStatusMessage('SMS OTP simulated (Dev Mode). Use verification code: 123456');
                    return;
                }
                throw error;
            }

            // Real SMS sent successfully
            setIsMockMode(false);
            setStep('otp-verify');
            setResendCooldown(30);
            setStatusType('success');
            setStatusMessage(`Verification code sent to ${formattedPhone}`);
            trackEvent('otp_sent', { method: 'phone' });
        } catch (err: any) {
            console.error('[Auth] Error sending phone OTP:', err);
            const msg = getFriendlyErrorMessage(err, 'Could not send verification code. Please check your phone number.');
            trackEvent('otp_send_failed', { method: 'phone', error: err?.message ?? String(err) });
            setStatusType('error');
            setStatusMessage(msg);
            showFriendlyAlert('Verification Error', msg);
        } finally {
            setLoading(false);
        }
    }

    // Step 2: Verify Phone OTP via Supabase
    async function handleVerifyPhoneOtp() {
        const code = otpCode.trim();
        if (code.length < 4) {
            const msg = 'Please enter the 6-digit verification code.';
            showFriendlyAlert('Invalid Code', msg);
            return;
        }

        const formattedPhone = getFormattedPhone();
        setLoading(true);
        setStatusMessage('');

        try {
            if (isMockMode && mockCode && code === mockCode) {
                // Mock Authentication logic for test mode
                const cleanDigits = formattedPhone.replace(/[^0-9]/g, '');
                const mockEmail = `phone_${cleanDigits}@mock-phone-auth.openmatch.app`;
                const mockPassword = `MockPhonePass_${cleanDigits}!`;

                const { error: signInErr } = await supabase.auth.signInWithPassword({
                    email: mockEmail,
                    password: mockPassword,
                });

                if (signInErr) {
                    const { error: signUpErr } = await supabase.auth.signUp({
                        email: mockEmail,
                        password: mockPassword,
                        options: {
                            data: {
                                phone: formattedPhone,
                            },
                        },
                    });
                    if (signUpErr) throw signUpErr;

                    const { error: finalSignInErr } = await supabase.auth.signInWithPassword({
                        email: mockEmail,
                        password: mockPassword,
                    });
                    if (finalSignInErr) throw finalSignInErr;
                }

                setStatusType('success');
                setStatusMessage('Phone verified successfully! Signing you in...');
                return;
            }

            // Real Supabase OTP Verification
            if (__DEV__) console.log('[Auth] Verifying Supabase OTP for:', formattedPhone);
            const { error } = await supabase.auth.verifyOtp({
                phone: formattedPhone,
                token: code,
                type: 'sms',
            });

            if (error) throw error;

            setStatusType('success');
            setStatusMessage('Phone verified! Signing you in...');
            trackEvent('otp_verified', { method: 'phone' });
        } catch (err: any) {
            console.error('[Auth] Error verifying OTP:', err);
            const msg = getFriendlyErrorMessage(err, 'Invalid verification code. Please try again.');
            setStatusType('error');
            setStatusMessage(msg);
            showFriendlyAlert('Verification Failed', msg);
        } finally {
            setLoading(false);
        }
    }

    // Step 3: Handle Email Auth Submission (Sign Up / Sign In)
    async function handleEmailSubmit() {
        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail) {
            showFriendlyAlert('Missing Info', 'Please enter your email address.');
            return;
        }

        if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
            showFriendlyAlert('Invalid Email', 'Please enter a valid email address.');
            return;
        }

        if (!password.trim()) {
            showFriendlyAlert('Missing Info', 'Please enter your password.');
            return;
        }

        if (emailMode === 'signup') {
            if (password.length < 8) {
                showFriendlyAlert('Weak Password', 'Password must be at least 8 characters long.');
                return;
            }

            if (password !== confirmPassword) {
                showFriendlyAlert('Password Mismatch', 'Passwords do not match. Please re-enter your password.');
                return;
            }

            if (!tosAccepted) {
                showFriendlyAlert('Terms of Service', 'Please accept the Terms of Service and Privacy Policy to continue.');
                return;
            }

            trackEvent('signup_started', { method: 'email' });
            setLoading(true);
            setStatusMessage('');

            try {
                // Mock mode: only when explicitly enabled (no SMTP needed for UI testing).
                if (ENABLE_MOCK_EMAIL_OTP) {
                    setIsMockMode(true);
                    setMockCode('123456');
                    setStep('email-otp-verify');
                    setResendCooldown(30);
                    setStatusType('info');
                    setStatusMessage('Email OTP simulated (Dev Mode). Use verification code: 123456');
                    trackEvent('otp_sent', { method: 'email' });
                    return;
                }

                // Send a REAL 6-digit OTP to the user's email for verification.
                const { error: otpErr } = await supabase.auth.signInWithOtp({
                    email: cleanEmail,
                    options: {
                        shouldCreateUser: true,
                    },
                });

                if (otpErr) throw otpErr;

                // Move to Email OTP verification screen
                setIsMockMode(false);
                setStep('email-otp-verify');
                setResendCooldown(30);
                setStatusType('info');
                setStatusMessage(`Verification code sent to ${cleanEmail}`);
                trackEvent('otp_sent', { method: 'email' });
            } catch (err: any) {
                console.error('[Auth] Error in email sign up:', err);
                const msg = getFriendlyErrorMessage(err, 'Could not send verification code. Please check your email.');
                setStatusType('error');
                setStatusMessage(msg);
                showFriendlyAlert('Sign Up Error', msg);
            } finally {
                setLoading(false);
            }
        } else {
            // Sign In flow with Email + Password
            setLoading(true);
            setStatusMessage('');
            try {
                const { error } = await supabase.auth.signInWithPassword({
                    email: cleanEmail,
                    password,
                });

                if (error) throw error;

                setStatusType('success');
                setStatusMessage('Signed in successfully.');
            } catch (err: any) {
                console.error('[Auth] Error in email sign in:', err);
                const msg = getFriendlyErrorMessage(err, 'Authentication failed. Please check your credentials.');
                setStatusType('error');
                setStatusMessage(msg);
                showFriendlyAlert('Sign In Failed', msg);
            } finally {
                setLoading(false);
            }
        }
    }

    // Step 4: Verify Email OTP code and save password
    async function handleVerifyEmailOtp() {
        const cleanEmail = email.trim().toLowerCase();
        const code = emailOtpCode.trim();
        if (code.length < 4) {
            showFriendlyAlert('Invalid Code', 'Please enter the verification code sent to your email.');
            return;
        }

        setLoading(true);
        setStatusMessage('');

        try {
            // Mock mode check for dev testing
            if (isMockMode && mockCode && code === mockCode) {
                // Try to sign up the new account first.
                const { error: signUpErr } = await supabase.auth.signUp({
                    email: cleanEmail,
                    password,
                });

                // If the account already exists (e.g. a previous attempt), just sign in.
                if (signUpErr) {
                    const msg = (signUpErr.message || '').toLowerCase();
                    const alreadyExists =
                        msg.includes('already registered') ||
                        msg.includes('already exists') ||
                        msg.includes('user_already_exists');

                    const { error: signInErr } = await supabase.auth.signInWithPassword({
                        email: cleanEmail,
                        password,
                    });

                    // Only surface an error if it wasn't simply a duplicate account.
                    if (signInErr && !alreadyExists) throw signUpErr;
                    if (signInErr && alreadyExists) throw signInErr;
                }

                setStatusType('success');
                setStatusMessage('Email verified! Signing you in...');
                trackEvent('otp_verified', { method: 'email' });
                return;
            }

            // Verify email OTP token
            const { error: verifyErr } = await supabase.auth.verifyOtp({
                email: cleanEmail,
                token: code,
                type: 'email',
            });

            if (verifyErr) {
                // Fallback attempt: verify as signup type
                const { error: fallbackErr } = await supabase.auth.verifyOtp({
                    email: cleanEmail,
                    token: code,
                    type: 'signup',
                });
                if (fallbackErr) throw fallbackErr;
            }

            // Once email is verified, set the user's password if provided during signup
            if (password.trim()) {
                await supabase.auth.updateUser({ password: password.trim() });
            }

            setStatusType('success');
            setStatusMessage('Email verified successfully! Signing you in...');
            trackEvent('otp_verified', { method: 'email' });
        } catch (err: any) {
            console.error('[Auth] Error verifying email OTP:', err);
            const msg = getFriendlyErrorMessage(err, 'Invalid or expired verification code. Please try again.');
            setStatusType('error');
            setStatusMessage(msg);
            showFriendlyAlert('Verification Failed', msg);
        } finally {
            setLoading(false);
        }
    }

    // Resend Email OTP
    async function handleResendEmailOtp() {
        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail) return;

        setLoading(true);
        setStatusMessage('');

        try {
            const { error } = await supabase.auth.signInWithOtp({
                email: cleanEmail,
                options: {
                    shouldCreateUser: true,
                },
            });

            if (error) throw error;

            setResendCooldown(30);
            setStatusType('success');
            setStatusMessage(`New verification code sent to ${cleanEmail}`);
            trackEvent('otp_sent', { method: 'email' });
        } catch (err: any) {
            console.error('[Auth] Error resending email OTP:', err);
            const msg = getFriendlyErrorMessage(err, 'Could not resend code. Please try again later.');
            showFriendlyAlert('Error', msg);
        } finally {
            setLoading(false);
        }
    }

    return (
        <View style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder }]}>
            {/* Header Title */}
            <View style={styles.headerContainer}>
                <Text style={[styles.badgeText, { color: colors.accent }]}>
                    {step === 'email-fallback' || step === 'email-otp-verify'
                        ? '✉️ SECURE EMAIL AUTHENTICATION'
                        : '🔐 SECURE PHONE VERIFICATION'}
                </Text>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}
                >
                    {step === 'phone-input' && 'Enter your Mobile Number'}
                    {step === 'otp-verify' && 'Verify 6-Digit OTP Code'}
                    {step === 'email-fallback' && (emailMode === 'signup' ? 'Create Account with Email' : 'Email Sign In')}
                    {step === 'email-otp-verify' && 'Verify Email OTP Code'}
                </Text>
                <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
                    {step === 'phone-input' && 'We will send a 6-digit verification code via SMS to confirm your identity.'}
                    {step === 'otp-verify' && `Enter the verification code sent to ${getFormattedPhone()}`}
                    {step === 'email-fallback' &&
                        (emailMode === 'signup'
                            ? 'Enter your email, create a password, and verify via OTP.'
                            : 'Sign in using your registered email and password.')}
                    {step === 'email-otp-verify' && `Enter the verification code sent to ${email.trim()}`}
                </Text>
            </View>

            {/* STEP 1: Phone Number Input */}
            {step === 'phone-input' && (
                <View style={styles.formContainer}>
                    <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>Mobile Number</Text>
                    <View style={styles.phoneInputRow}>
                        {/* Country Code Picker Pill */}
                        <View style={styles.countryCodePill}>
                            <Text style={styles.countryCodeText}>{selectedCountryCode}</Text>
                        </View>

                        {/* Phone Number TextInput */}
                        <TextInput
                            autoFocus
                            keyboardType="phone-pad"
                            maxLength={15}
                            placeholder="98765 43210"
                            placeholderTextColor="#5a6488"
                            style={styles.phoneInput}
                            value={rawPhone}
                            onChangeText={setRawPhone}
                            onSubmitEditing={handleSendPhoneOtp}
                        />
                    </View>

                    {/* C6 FIX: ToS/Privacy Policy Acceptance */}
                    <Pressable
                        style={styles.tosRow}
                        onPress={() => setTosAccepted((prev) => !prev)}
                    >
                        <View style={[styles.tosCheckbox, tosAccepted && styles.tosCheckboxChecked]}>
                            {tosAccepted ? <Text style={styles.tosCheckmark}>✓</Text> : null}
                        </View>
                        <Text style={[styles.tosText, { color: colors.textSecondary }]}>
                            I agree to the{' '}
                            <Text style={styles.tosLink}>Terms of Service</Text>
                            {' '}and{' '}
                            <Text style={styles.tosLink}>Privacy Policy</Text>
                        </Text>
                    </Pressable>

                    {/* Submit Button */}
                    <Pressable
                        disabled={loading || !rawPhone.trim() || !tosAccepted}
                        onPress={handleSendPhoneOtp}
                        style={[
                            styles.primaryBtn,
                            (loading || !rawPhone.trim() || !tosAccepted) && styles.disabledBtn,
                        ]}
                    >
                        {loading ? (
                            <ActivityIndicator color="#070912" size="small" />
                        ) : (
                            <Text style={styles.primaryBtnText}>Get Verification Code ➔</Text>
                        )}
                    </Pressable>
                </View>
            )}

            {/* STEP 2: OTP Verification Code Input */}
            {step === 'otp-verify' && (
                <View style={styles.formContainer}>
                    <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>Verification Code</Text>
                    <TextInput
                        autoFocus
                        keyboardType="number-pad"
                        maxLength={6}
                        placeholder="1 2 3 4 5 6"
                        placeholderTextColor="#5a6488"
                        style={styles.otpInput}
                        value={otpCode}
                        onChangeText={setOtpCode}
                        onSubmitEditing={handleVerifyPhoneOtp}
                    />

                    {/* Action Buttons Row */}
                    <Pressable
                        disabled={loading || otpCode.trim().length < 4}
                        onPress={handleVerifyPhoneOtp}
                        style={[
                            styles.primaryBtn,
                            (loading || otpCode.trim().length < 4) && styles.disabledBtn,
                        ]}
                    >
                        {loading ? (
                            <ActivityIndicator color="#070912" size="small" />
                        ) : (
                            <Text style={styles.primaryBtnText}>Verify Code & Sign In ➔</Text>
                        )}
                    </Pressable>

                    <View style={styles.otpFooterRow}>
                        {/* Resend OTP */}
                        <Pressable
                            disabled={resendCooldown > 0 || loading}
                            onPress={handleSendPhoneOtp}
                            style={styles.resendBtn}
                        >
                            <Text
                                style={[
                                    styles.resendBtnText,
                                    resendCooldown > 0 && styles.disabledText,
                                ]}
                            >
                                {resendCooldown > 0
                                    ? `Resend OTP (${resendCooldown}s)`
                                    : 'Resend OTP'}
                            </Text>
                        </Pressable>

                        <Text style={styles.dividerDot}>•</Text>

                        {/* Edit Phone Number */}
                        <Pressable
                            onPress={() => {
                                setStep('phone-input');
                                setOtpCode('');
                                setStatusMessage('');
                            }}
                            style={styles.editPhoneBtn}
                        >
                            <Text style={styles.editPhoneText}>Change Number</Text>
                        </Pressable>
                    </View>
                </View>
            )}

            {/* STEP 3: Email Fallback (Sign Up / Sign In) */}
            {step === 'email-fallback' && (
                <View style={styles.formContainer}>
                    {/* Toggle between Sign In (left) and Sign Up (right) */}
                    <View style={styles.tabToggleRow}>
                        <Pressable
                            onPress={() => {
                                setEmailMode('signin');
                                setStatusMessage('');
                            }}
                            style={[
                                styles.tabToggleBtn,
                                emailMode === 'signin' && styles.tabToggleBtnActive,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.tabToggleText,
                                    emailMode === 'signin' && styles.tabToggleTextActive,
                                ]}
                            >
                                Sign In
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={() => {
                                setEmailMode('signup');
                                setStatusMessage('');
                            }}
                            style={[
                                styles.tabToggleBtn,
                                emailMode === 'signup' && styles.tabToggleBtnActive,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.tabToggleText,
                                    emailMode === 'signup' && styles.tabToggleTextActive,
                                ]}
                            >
                                Sign Up
                            </Text>
                        </Pressable>
                    </View>

                    <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>Email Address</Text>
                    <TextInput
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="email-address"
                        placeholder="you@example.com"
                        placeholderTextColor="#5a6488"
                        style={styles.standardInput}
                        value={email}
                        onChangeText={setEmail}
                    />

                    <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>Password</Text>
                    <TextInput
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder={emailMode === 'signup' ? 'Create a secure password (8+ chars)' : 'Enter your password'}
                        placeholderTextColor="#5a6488"
                        secureTextEntry
                        style={styles.standardInput}
                        value={password}
                        onChangeText={setPassword}
                    />

                    {emailMode === 'signup' && (
                        <>
                            <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>Confirm Password</Text>
                            <TextInput
                                autoCapitalize="none"
                                autoCorrect={false}
                                placeholder="Re-enter your password"
                                placeholderTextColor="#5a6488"
                                secureTextEntry
                                style={styles.standardInput}
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                                onSubmitEditing={handleEmailSubmit}
                            />

                            {/* Terms of Service acceptance */}
                            <Pressable
                                style={styles.tosRow}
                                onPress={() => setTosAccepted((prev) => !prev)}
                            >
                                <View style={[styles.tosCheckbox, tosAccepted && styles.tosCheckboxChecked]}>
                                    {tosAccepted ? <Text style={styles.tosCheckmark}>✓</Text> : null}
                                </View>
                                <Text style={[styles.tosText, { color: colors.textSecondary }]}>
                                    I agree to the{' '}
                                    <Text style={styles.tosLink}>Terms of Service</Text>
                                    {' '}and{' '}
                                    <Text style={styles.tosLink}>Privacy Policy</Text>
                                </Text>
                            </Pressable>
                        </>
                    )}

                    {/* Submit Button */}
                    <Pressable
                        disabled={loading}
                        onPress={handleEmailSubmit}
                        style={[styles.primaryBtn, loading && styles.disabledBtn]}
                    >
                        {loading ? (
                            <ActivityIndicator color="#ffffff" size="small" />
                        ) : (
                            <Text style={styles.primaryBtnText}>
                                {emailMode === 'signup' ? 'Continue with Verification ➔' : 'Sign In ➔'}
                            </Text>
                        )}
                    </Pressable>
                </View>
            )}

            {/* STEP 4: Email OTP Verification */}
            {step === 'email-otp-verify' && (
                <View style={styles.formContainer}>
                    <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>6-Digit Email Code</Text>
                    <TextInput
                        autoFocus
                        keyboardType="number-pad"
                        maxLength={8}
                        placeholder="1 2 3 4 5 6"
                        placeholderTextColor="#5a6488"
                        style={styles.otpInput}
                        value={emailOtpCode}
                        onChangeText={setEmailOtpCode}
                        onSubmitEditing={handleVerifyEmailOtp}
                    />

                    {/* Action Buttons Row */}
                    <Pressable
                        disabled={loading || emailOtpCode.trim().length < 4}
                        onPress={handleVerifyEmailOtp}
                        style={[
                            styles.primaryBtn,
                            (loading || emailOtpCode.trim().length < 4) && styles.disabledBtn,
                        ]}
                    >
                        {loading ? (
                            <ActivityIndicator color="#ffffff" size="small" />
                        ) : (
                            <Text style={styles.primaryBtnText}>Verify Email & Continue ➔</Text>
                        )}
                    </Pressable>

                    <View style={styles.otpFooterRow}>
                        {/* Resend OTP */}
                        <Pressable
                            disabled={resendCooldown > 0 || loading}
                            onPress={handleResendEmailOtp}
                            style={styles.resendBtn}
                        >
                            <Text
                                style={[
                                    styles.resendBtnText,
                                    resendCooldown > 0 && styles.disabledText,
                                ]}
                            >
                                {resendCooldown > 0
                                    ? `Resend Code (${resendCooldown}s)`
                                    : 'Resend Code'}
                            </Text>
                        </Pressable>

                        <Text style={styles.dividerDot}>•</Text>

                        {/* Edit Email Address */}
                        <Pressable
                            onPress={() => {
                                setStep('email-fallback');
                                setEmailOtpCode('');
                                setStatusMessage('');
                            }}
                            style={styles.editPhoneBtn}
                        >
                            <Text style={styles.editPhoneText}>Change Email</Text>
                        </Pressable>
                    </View>
                </View>
            )}

            {/* Status & Banner Messages */}
            {!!statusMessage && (
                <View
                    style={[
                        styles.statusBanner,
                        statusType === 'success' && styles.successBanner,
                        statusType === 'error' && styles.errorBanner,
                    ]}
                >
                    <Text
                        style={[
                            styles.statusText,
                            statusType === 'success' && styles.successText,
                            statusType === 'error' && styles.errorText,
                        ]}
                    >
                        {statusMessage}
                    </Text>
                </View>
            )}

            {/* Footer Navigation / Mode Switch */}
            <View style={[styles.cardFooter, { borderTopColor: colors.cardBorder }]}>
                {step === 'email-fallback' || step === 'email-otp-verify' ? (
                    <Pressable onPress={() => {
                        setStep('phone-input');
                        setStatusMessage('');
                    }}>
                        <Text style={[styles.toggleText, { color: colors.textSecondary }]}>← Back to Phone Verification</Text>
                    </Pressable>
                ) : (
                    <>
                        <View style={styles.footerDivider}>
                            <View style={[styles.footerDividerLine, { backgroundColor: colors.cardBorder }]} />
                            <Text style={[styles.footerDividerText, { color: colors.textSecondary }]}>OR</Text>
                            <View style={[styles.footerDividerLine, { backgroundColor: colors.cardBorder }]} />
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            disabled={loading}
                            onPress={handleGoogleSignIn}
                            style={[styles.googleBtn, loading && styles.disabledBtn]}
                        >
                            <View style={styles.googleIconWrap}>
                                <GoogleLogo size={18} />
                            </View>
                            <Text style={styles.googleBtnText}>
                                Continue with Google
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                                setStep('email-fallback');
                                setStatusMessage('');
                            }}
                            style={[styles.emailAltBtn, { borderColor: colors.accent }]}
                        >
                            <Text style={[styles.emailAltBtnText, { color: colors.accent }]}>
                                ✉️  Continue with Email & Password
                            </Text>
                        </Pressable>
                    </>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#ffffff',
        borderColor: '#e2e7f5',
        borderRadius: 20,
        borderWidth: 1,
        gap: 16,
        padding: 24,
        shadowColor: '#0e2e3a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 4,
        width: '100%',
    },
    headerContainer: {
        gap: 6,
    },
    badgeText: {
        color: '#ff6a3d',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    cardTitle: {
        color: '#0e2e3a',
        fontSize: 22,
        fontWeight: '800',
    },
    cardSubtitle: {
        color: '#5a717b',
        fontSize: 14,
        lineHeight: 20,
    },
    formContainer: {
        gap: 14,
        marginTop: 4,
    },
    fieldLabel: {
        color: '#0e2e3a',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    phoneInputRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
    },
    countryCodePill: {
        backgroundColor: '#f1f5f7',
        borderColor: '#e2e7f5',
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 14,
    },
    countryCodeText: {
        color: '#0e2e3a',
        fontSize: 16,
        fontWeight: '700',
    },
    phoneInput: {
        backgroundColor: '#f7fafb',
        borderColor: '#e2e7f5',
        borderRadius: 12,
        borderWidth: 1,
        color: '#10232a',
        flex: 1,
        fontSize: 17,
        fontWeight: '600',
        letterSpacing: 0.5,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    otpInput: {
        backgroundColor: '#f7fafb',
        borderColor: '#ff6a3d',
        borderRadius: 12,
        borderWidth: 1.5,
        color: '#0e2e3a',
        fontSize: 24,
        fontWeight: '800',
        letterSpacing: 8,
        paddingHorizontal: 16,
        paddingVertical: 14,
        textAlign: 'center',
    },
    standardInput: {
        backgroundColor: '#f7fafb',
        borderColor: '#e2e7f5',
        borderRadius: 12,
        borderWidth: 1,
        color: '#10232a',
        fontSize: 15,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    tabToggleRow: {
        backgroundColor: '#f1f5f7',
        borderRadius: 12,
        flexDirection: 'row',
        marginBottom: 6,
        padding: 4,
    },
    tabToggleBtn: {
        alignItems: 'center',
        borderRadius: 10,
        flex: 1,
        justifyContent: 'center',
        paddingVertical: 10,
    },
    tabToggleBtnActive: {
        backgroundColor: '#ffffff',
        shadowColor: '#0e2e3a',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
    },
    tabToggleText: {
        color: '#5a717b',
        fontSize: 14,
        fontWeight: '600',
    },
    tabToggleTextActive: {
        color: '#0e2e3a',
        fontWeight: '800',
    },
    primaryBtn: {
        alignItems: 'center',
        backgroundColor: '#ff6a3d',
        borderRadius: 12,
        justifyContent: 'center',
        paddingVertical: 14,
    },
    disabledBtn: {
        backgroundColor: '#dc8c69',
        opacity: 0.7,
    },
    primaryBtnText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '800',
    },
    secondaryBtn: {
        alignItems: 'center',
        backgroundColor: '#f1f5f7',
        borderColor: '#e2e7f5',
        borderRadius: 12,
        borderWidth: 1,
        justifyContent: 'center',
        paddingVertical: 14,
    },
    secondaryBtnText: {
        color: '#0e2e3a',
        fontSize: 15,
        fontWeight: '700',
    },
    otpFooterRow: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 10,
        marginTop: 4,
    },
    resendBtn: {
        paddingVertical: 4,
    },
    resendBtnText: {
        color: '#ff6a3d',
        fontSize: 13,
        fontWeight: '600',
    },
    disabledText: {
        color: '#94a3b8',
    },
    dividerDot: {
        color: '#cbd5e1',
        fontSize: 14,
    },
    editPhoneBtn: {
        paddingVertical: 4,
    },
    editPhoneText: {
        color: '#5a717b',
        fontSize: 13,
        fontWeight: '600',
        textDecorationLine: 'underline',
    },
    emailBtnRow: {
        flexDirection: 'row',
        gap: 10,
    },
    statusBanner: {
        backgroundColor: '#f8fafc',
        borderColor: '#e2e8f0',
        borderRadius: 10,
        borderWidth: 1,
        padding: 12,
    },
    successBanner: {
        backgroundColor: '#f0fdf4',
        borderColor: '#bbf7d0',
    },
    errorBanner: {
        backgroundColor: '#fef2f2',
        borderColor: '#fecaca',
    },
    statusText: {
        color: '#0284c7',
        fontSize: 13,
        lineHeight: 18,
        textAlign: 'center',
    },
    successText: {
        color: '#15803d',
    },
    errorText: {
        color: '#dc2626',
    },
    cardFooter: {
        alignItems: 'center',
        borderTopColor: '#f1f5f9',
        borderTopWidth: 1,
        marginTop: 4,
        paddingTop: 14,
    },
    toggleText: {
        color: '#5a717b',
        fontSize: 13,
        fontWeight: '600',
    },
    footerDivider: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
        marginBottom: 12,
        width: '100%',
    },
    footerDividerLine: {
        backgroundColor: '#e2e7f5',
        flex: 1,
        height: 1,
    },
    footerDividerText: {
        color: '#5a717b',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1,
    },
    googleBtn: {
        alignItems: 'center',
        backgroundColor: '#ffffff',
        borderColor: '#dadce0',
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'center',
        marginBottom: 12,
        paddingVertical: 14,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
        elevation: 2,
        width: '100%',
    },
    googleIconWrap: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 20,
        width: 20,
    },
    googleBtnText: {
        color: '#3c4043',
        fontSize: 15,
        fontWeight: '600',
        letterSpacing: 0.2,
    },
    emailAltBtn: {
        alignItems: 'center',
        borderColor: '#f97316',
        borderRadius: 12,
        borderWidth: 1.5,
        paddingVertical: 14,
        width: '100%',
    },
    emailAltBtnText: {
        color: '#f97316',
        fontSize: 15,
        fontWeight: '700',
    },
    tosRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
        paddingVertical: 4,
    },
    tosCheckbox: {
        alignItems: 'center',
        borderColor: '#c4d0d6',
        borderRadius: 5,
        borderWidth: 2,
        height: 22,
        justifyContent: 'center',
        width: 22,
    },
    tosCheckboxChecked: {
        backgroundColor: '#ff6a3d',
        borderColor: '#ff6a3d',
    },
    tosCheckmark: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
    tosText: {
        flex: 1,
        fontSize: 12,
        lineHeight: 17,
    },
    tosLink: {
        color: '#ff6a3d',
        fontWeight: '700',
        textDecorationLine: 'underline',
    },
});
