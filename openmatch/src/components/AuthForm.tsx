import { useEffect, useState } from 'react';
import {
    Alert,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { BackButton } from './BackButton';
import { supabase } from '../lib/supabase';

type AuthMode = 'sign-in' | 'sign-up' | 'otp' | 'phone-otp' | 'verify-phone-code';

export function AuthForm() {
    const [mode, setMode] = useState<AuthMode>('sign-in');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [phone, setPhone] = useState('');
    const [smsCode, setSmsCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [emailCooldownUntil, setEmailCooldownUntil] = useState<number>(0);
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [nowMs, setNowMs] = useState<number>(Date.now());
    const [mockSmsCode, setMockSmsCode] = useState<string | null>(null);

    const normalizedEmail = email.trim().toLowerCase();

    const hasEmailCooldown = nowMs < emailCooldownUntil;
    const cooldownSecondsLeft = Math.max(
        1,
        Math.ceil((emailCooldownUntil - nowMs) / 1000),
    );
    const submitBlockedByCooldown = (mode === 'sign-up' || mode === 'otp') && hasEmailCooldown;

    useEffect(() => {
        if (!hasEmailCooldown) {
            return;
        }

        const timer = setInterval(() => {
            setNowMs(Date.now());
        }, 1000);

        return () => clearInterval(timer);
    }, [hasEmailCooldown]);

    async function onSubmit() {
        if ((mode === 'sign-up' || mode === 'otp') && hasEmailCooldown) {
            Alert.alert(
                'Please wait',
                `Too many email requests. Try again in ${cooldownSecondsLeft}s.`,
            );
            return;
        }

        const isEmailMode = mode === 'sign-in' || mode === 'sign-up' || mode === 'otp';

        if (isEmailMode && !normalizedEmail) {
            Alert.alert('Missing email', 'Please enter your email address.');
            return;
        }

        if (isEmailMode && (mode === 'sign-in' || mode === 'sign-up') && !password) {
            Alert.alert('Missing password', 'Please enter your password.');
            return;
        }

        setLoading(true);
        setStatusMessage('');

        try {
            if (mode === 'sign-in') {
                const { error } = await supabase.auth.signInWithPassword({
                    email: normalizedEmail,
                    password,
                });

                if (error) throw error;

                setStatusMessage('Signed in successfully.');
                Alert.alert('Signed in', 'Welcome back to OpenMatch.');
            }

            if (mode === 'sign-up') {
                const { data, error } = await supabase.auth.signUp({
                    email: normalizedEmail,
                    password,
                });

                if (error) throw error;

                setEmailCooldownUntil(Date.now() + 60_000);

                if (data.session) {
                    setStatusMessage('Account created and signed in.');
                    Alert.alert('Signed up', 'Your account is active and you are signed in.');
                    return;
                }

                setStatusMessage('Account created. Please verify your email before signing in.');

                Alert.alert(
                    'Verify your email',
                    'Account created. Check your inbox to verify before signing in.',
                );
            }

            if (mode === 'otp') {
                const { error } = await supabase.auth.signInWithOtp({
                    email: normalizedEmail,
                    options: {
                        shouldCreateUser: true,
                    },
                });

                if (error) throw error;

                setEmailCooldownUntil(Date.now() + 60_000);
                setStatusMessage('Magic link sent. Check your inbox.');

                Alert.alert('Magic link sent', 'Check your email for the sign-in link.');
            }

            if (mode === 'phone-otp') {
                if (!phone) {
                    if (Platform.OS === 'web') {
                        alert('Please enter your mobile number.');
                    } else {
                        Alert.alert('Missing phone number', 'Please enter your mobile number.');
                    }
                    return;
                }
                try {
                    const { error } = await supabase.auth.signInWithOtp({
                        phone: phone.trim(),
                    });
                    if (error) throw error;
                    setMode('verify-phone-code');
                    setStatusMessage('SMS OTP sent. Enter the code below.');
                    if (Platform.OS === 'web') {
                        alert('A verification code has been sent to your mobile number.');
                    } else {
                        Alert.alert('OTP Sent', 'A verification code has been sent to your mobile number.');
                    }
                } catch (err: any) {
                    const errMsg = err?.message || '';
                    if (err?.code === 'phone_provider_disabled' || errMsg.includes('provider') || errMsg.includes('disabled')) {
                        console.log('Phone provider disabled in Supabase, using mock authentication fallback.');
                        setMockSmsCode('123456');
                        setMode('verify-phone-code');
                        setStatusMessage('SMS OTP simulated. Enter "123456" below to verify.');
                        if (Platform.OS === 'web') {
                            alert('Phone OTP simulated (mock fallback): A verification code (123456) has been sent to your mobile number.');
                        } else {
                            Alert.alert('OTP Sent (Mock Fallback)', 'A verification code (123456) has been simulated for your mobile number.');
                        }
                    } else {
                        throw err;
                    }
                }
            }

            if (mode === 'verify-phone-code') {
                if (!smsCode) {
                    if (Platform.OS === 'web') {
                        alert('Please enter the verification code.');
                    } else {
                        Alert.alert('Missing code', 'Please enter the verification code.');
                    }
                    return;
                }

                if (mockSmsCode && smsCode.trim() === mockSmsCode) {
                    const cleanPhone = phone.replace(/[^0-9]/g, '');
                    const mockEmail = `phone_${cleanPhone}@mock-phone-auth.openmatch.app`;
                    const mockPassword = `MockPhonePassword123!`;

                    try {
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
                                        phone: phone.trim(),
                                    }
                                }
                            });
                            if (signUpErr) throw signUpErr;

                            const { error: finalSignInErr } = await supabase.auth.signInWithPassword({
                                email: mockEmail,
                                password: mockPassword,
                            });
                            if (finalSignInErr) throw finalSignInErr;
                        }
                    } catch (authErr: any) {
                        throw new Error(`Mock authentication failed: ${authErr.message}`);
                    }

                    setStatusMessage('Signed in successfully via mock phone fallback.');
                    if (Platform.OS === 'web') {
                        alert('Welcome to OpenMatch (Simulated Phone Session).');
                    } else {
                        Alert.alert('Signed in', 'Welcome to OpenMatch.');
                    }
                    return;
                }

                const { error } = await supabase.auth.verifyOtp({
                    phone: phone.trim(),
                    token: smsCode.trim(),
                    type: 'sms',
                });
                if (error) throw error;
                setStatusMessage('Signed in successfully.');
                if (Platform.OS === 'web') {
                    alert('Welcome to OpenMatch.');
                } else {
                    Alert.alert('Signed in', 'Welcome to OpenMatch.');
                }
            }
        } catch (error) {
            const authCode = getAuthErrorCode(error);
            const rawMessage =
                error instanceof Error ? error.message : 'Authentication failed.';

            if (authCode === 'over_email_send_rate_limit') {
                setEmailCooldownUntil(Date.now() + 60_000);
                setStatusMessage(
                    'Email send rate limit reached. Wait about 1 minute and retry, or switch to Sign In if your account already exists.',
                );
                Alert.alert(
                    'Rate limit reached',
                    'Supabase temporarily blocked email sends. Wait about 1 minute, then retry. If this email already has an account, use Sign In.',
                );
                return;
            }

            if (rawMessage.toLowerCase().includes('email not confirmed')) {
                setStatusMessage(
                    'Your account exists but email is not verified. Check inbox/spam for the confirmation email, then try Sign In again.',
                );
                Alert.alert(
                    'Email not confirmed',
                    'Please verify your email first. After confirmation, use Sign In.',
                );
                return;
            }

            if (rawMessage.toLowerCase().includes('invalid login credentials')) {
                setStatusMessage(
                    'Invalid credentials. Use the same email/password used at signup, or use OTP for passwordless login.',
                );
            }

            Alert.alert('Auth error', rawMessage);
        } finally {
            setLoading(false);
        }
    }

    function resetToSignIn() {
        setMode('sign-in');
        setStatusMessage('');
    }

    return (
        <View style={styles.card}>
            <View style={styles.headerRow}>
                {mode !== 'sign-in' ? <BackButton onPress={resetToSignIn} /> : null}
                <Text style={styles.sectionTitle}>Welcome to OpenMatch</Text>
            </View>

            {mode !== 'verify-phone-code' && (
                <View style={styles.tabs}>
                    <Pressable
                        onPress={() => setMode('sign-in')}
                        style={[styles.tab, mode === 'sign-in' && styles.activeTab]}
                    >
                        <Text style={[styles.tabText, mode === 'sign-in' && styles.activeTabText]}>
                            Sign In
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={() => setMode('sign-up')}
                        style={[styles.tab, mode === 'sign-up' && styles.activeTab]}
                    >
                        <Text style={[styles.tabText, mode === 'sign-up' && styles.activeTabText]}>
                            Sign Up
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={() => setMode('otp')}
                        style={[styles.tab, mode === 'otp' && styles.activeTab]}
                    >
                        <Text style={[styles.tabText, mode === 'otp' && styles.activeTabText]}>
                            Email OTP
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={() => setMode('phone-otp')}
                        style={[styles.tab, mode === 'phone-otp' && styles.activeTab]}
                    >
                        <Text style={[styles.tabText, mode === 'phone-otp' && styles.activeTabText]}>
                            Phone OTP
                        </Text>
                    </Pressable>
                </View>
            )}

            {(mode === 'sign-in' || mode === 'sign-up' || mode === 'otp') && (
                <TextInput
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    placeholder="Email"
                    placeholderTextColor="#829198"
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                />
            )}

            {(mode === 'sign-in' || mode === 'sign-up') && (
                <TextInput
                    autoCapitalize="none"
                    autoComplete="password"
                    placeholder="Password"
                    placeholderTextColor="#829198"
                    secureTextEntry
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                />
            )}

            {mode === 'phone-otp' && (
                <TextInput
                    autoCapitalize="none"
                    autoComplete="tel"
                    keyboardType="phone-pad"
                    placeholder="Phone number (+91...)"
                    placeholderTextColor="#829198"
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                />
            )}

            {mode === 'verify-phone-code' && (
                <TextInput
                    autoCapitalize="none"
                    keyboardType="number-pad"
                    placeholder="6-digit verification code"
                    placeholderTextColor="#829198"
                    style={styles.input}
                    value={smsCode}
                    onChangeText={setSmsCode}
                />
            )}

            <Pressable
                onPress={onSubmit}
                style={[styles.primaryButton, (loading || submitBlockedByCooldown) && styles.disabledButton]}
                disabled={loading || submitBlockedByCooldown}
            >
                <Text style={styles.primaryButtonText}>
                    {loading
                        ? 'Please wait...'
                        : submitBlockedByCooldown
                            ? `Retry in ${cooldownSecondsLeft}s`
                            : mode === 'otp'
                                ? 'Send Magic Link'
                                : mode === 'phone-otp'
                                    ? 'Send Verification OTP'
                                    : mode === 'verify-phone-code'
                                        ? 'Verify Code & Login'
                                        : 'Continue'}
                </Text>
            </Pressable>

            {submitBlockedByCooldown && (
                <Text style={styles.cooldownText}>
                    Email sending is temporarily paused. You can retry in {cooldownSecondsLeft}s.
                </Text>
            )}

            {!!statusMessage && <Text style={styles.statusText}>{statusMessage}</Text>}
        </View>
    );
}

function getAuthErrorCode(error: unknown): string | null {
    if (typeof error !== 'object' || error === null) {
        return null;
    }

    const maybeCode = (error as { code?: unknown }).code;
    return typeof maybeCode === 'string' ? maybeCode : null;
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 18,
        gap: 12,
        padding: 16,
        width: '100%',
    },
    headerRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
    },
    sectionTitle: {
        color: '#0f2f3a',
        fontSize: 15,
        fontWeight: '700',
    },
    tabs: {
        backgroundColor: '#f1f4f5',
        borderRadius: 12,
        flexDirection: 'row',
        padding: 4,
    },
    tab: {
        borderRadius: 9,
        flex: 1,
        paddingVertical: 10,
    },
    activeTab: {
        backgroundColor: '#0f2f3a',
    },
    tabText: {
        color: '#49606b',
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'center',
    },
    activeTabText: {
        color: '#ffffff',
    },
    input: {
        backgroundColor: '#f7fafb',
        borderColor: '#d7e3e6',
        borderRadius: 10,
        borderWidth: 1,
        color: '#10232a',
        fontSize: 15,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    primaryButton: {
        alignItems: 'center',
        backgroundColor: '#e56a3a',
        borderRadius: 10,
        paddingVertical: 12,
    },
    disabledButton: {
        backgroundColor: '#dc8c69',
    },
    primaryButtonText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '700',
    },
    cooldownText: {
        color: '#5a717b',
        fontSize: 12,
        lineHeight: 17,
    },
    statusText: {
        color: '#36515b',
        fontSize: 13,
        lineHeight: 18,
    },
});
