import React, { useEffect, useState } from 'react';
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

import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';

type AuthStep = 'phone-input' | 'otp-verify' | 'email-fallback';

export function AuthForm() {
    const [step, setStep] = useState<AuthStep>('phone-input');
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
        } catch (err: any) {
            console.error('[Auth] Error sending phone OTP:', err);
            const msg = err?.message || 'Could not send verification code. Please check your phone number.';
            setStatusType('error');
            setStatusMessage(msg);
            if (Platform.OS === 'web') alert(msg);
            else Alert.alert('Verification Error', msg);
        } finally {
            setLoading(false);
        }
    }

    // Step 2: Verify Phone OTP via Supabase
    async function handleVerifyPhoneOtp() {
        const code = otpCode.trim();
        if (code.length < 4) {
            const msg = 'Please enter the 6-digit verification code.';
            if (Platform.OS === 'web') alert(msg);
            else Alert.alert('Invalid Code', msg);
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
        } catch (err: any) {
            console.error('[Auth] Error verifying OTP:', err);
            const msg = err?.message || 'Invalid verification code. Please try again.';
            setStatusType('error');
            setStatusMessage(msg);
            if (Platform.OS === 'web') alert(msg);
            else Alert.alert('Verification Failed', msg);
        } finally {
            setLoading(false);
        }
    }

    // Email Password Fallback Login
    async function handleEmailAuth(isSignUp: boolean) {
        if (!email.trim() || !password.trim()) {
            Alert.alert('Missing Info', 'Please enter email and password.');
            return;
        }

        setLoading(true);
        setStatusMessage('');

        try {
            if (isSignUp) {
                const { data, error } = await supabase.auth.signUp({
                    email: email.trim().toLowerCase(),
                    password,
                });
                if (error) throw error;
                if (data.session) {
                    setStatusMessage('Account created and signed in.');
                } else {
                    setStatusMessage('Check your email for confirmation link.');
                }
            } else {
                const { error } = await supabase.auth.signInWithPassword({
                    email: email.trim().toLowerCase(),
                    password,
                });
                if (error) throw error;
                setStatusMessage('Signed in successfully.');
            }
        } catch (err: any) {
            setStatusType('error');
            setStatusMessage(err?.message || 'Authentication failed.');
        } finally {
            setLoading(false);
        }
    }

    return (
        <View style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder }]}>
            {/* Header Title */}
            <View style={styles.headerContainer}>
                <Text style={[styles.badgeText, { color: colors.accent }]}>🔐 SECURE PHONE VERIFICATION</Text>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                    {step === 'phone-input' && 'Enter your Mobile Number'}
                    {step === 'otp-verify' && 'Verify 6-Digit OTP Code'}
                    {step === 'email-fallback' && 'Email Login'}
                </Text>
                <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
                    {step === 'phone-input' && 'We will send a 6-digit verification code via SMS to confirm your identity.'}
                    {step === 'otp-verify' && `Enter the verification code sent to ${getFormattedPhone()}`}
                    {step === 'email-fallback' && 'Sign in using your account email and password.'}
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
                            placeholderTextColor="#7b8d96"
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
                            <ActivityIndicator color="#0d0c0f" size="small" />
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
                        placeholderTextColor="#7b8d96"
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
                            <ActivityIndicator color="#0d0c0f" size="small" />
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

            {/* STEP 3: Email Fallback (Optional) */}
            {step === 'email-fallback' && (
                <View style={styles.formContainer}>
                    <TextInput
                        autoCapitalize="none"
                        keyboardType="email-address"
                        placeholder="Email Address"
                        placeholderTextColor="#7b8d96"
                        style={styles.standardInput}
                        value={email}
                        onChangeText={setEmail}
                    />
                    <TextInput
                        autoCapitalize="none"
                        placeholder="Password"
                        placeholderTextColor="#7b8d96"
                        secureTextEntry
                        style={styles.standardInput}
                        value={password}
                        onChangeText={setPassword}
                    />

                    <View style={styles.emailBtnRow}>
                        <Pressable
                            disabled={loading}
                            onPress={() => handleEmailAuth(false)}
                            style={[styles.primaryBtn, { flex: 1 }]}
                        >
                            <Text style={styles.primaryBtnText}>Sign In</Text>
                        </Pressable>
                        <Pressable
                            disabled={loading}
                            onPress={() => handleEmailAuth(true)}
                            style={[styles.secondaryBtn, { flex: 1 }]}
                        >
                            <Text style={styles.secondaryBtnText}>Sign Up</Text>
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
                {step !== 'email-fallback' ? (
                    <Pressable onPress={() => setStep('email-fallback')}>
                        <Text style={[styles.toggleText, { color: colors.textSecondary }]}>Use Email & Password instead</Text>
                    </Pressable>
                ) : (
                    <Pressable onPress={() => setStep('phone-input')}>
                        <Text style={[styles.toggleText, { color: colors.textSecondary }]}>← Back to Phone Verification</Text>
                    </Pressable>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#ffffff',
        borderColor: '#d7e3e6',
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
        color: '#e56a3a',
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
        borderColor: '#d7e3e6',
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
        borderColor: '#d7e3e6',
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
        borderColor: '#e56a3a',
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
        borderColor: '#d7e3e6',
        borderRadius: 12,
        borderWidth: 1,
        color: '#10232a',
        fontSize: 15,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    primaryBtn: {
        alignItems: 'center',
        backgroundColor: '#e56a3a',
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
        borderColor: '#d7e3e6',
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
        color: '#e56a3a',
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
        backgroundColor: '#e56a3a',
        borderColor: '#e56a3a',
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
        color: '#e56a3a',
        fontWeight: '700',
        textDecorationLine: 'underline',
    },
});
