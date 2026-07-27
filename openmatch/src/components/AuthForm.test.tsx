import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { AuthForm } from './AuthForm';
import { AuthScreen } from '../screens/AuthScreen';
import { supabase } from '../lib/supabase';

// Mock Supabase module
jest.mock('../lib/supabase', () => {
    return {
        supabase: {
            auth: {
                signInWithOtp: jest.fn(),
                verifyOtp: jest.fn(),
                signInWithPassword: jest.fn(),
                signUp: jest.fn(),
            },
        },
    };
});

describe('AuthForm Phone OTP Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders phone verification header and mobile number input field by default', () => {
        const { getByText, getByPlaceholderText } = render(<AuthForm />);

        expect(getByText('🔐 SECURE PHONE VERIFICATION')).toBeTruthy();
        expect(getByText('Enter your Mobile Number')).toBeTruthy();
        expect(getByPlaceholderText('98765 43210')).toBeTruthy();
        expect(getByText('Get Verification Code ➔')).toBeTruthy();
    });

    it('renders AuthScreen correctly with OpenMatch title and AuthForm child', () => {
        const { getByText, getByPlaceholderText } = render(<AuthScreen />);

        expect(getByText(/OpenMatch/)).toBeTruthy();
        expect(getByText('Fair matchmaking. AI-first. Verified phone authentication.')).toBeTruthy();
        expect(getByPlaceholderText('98765 43210')).toBeTruthy();
    });

    it('invokes supabase.auth.signInWithOtp on submitting valid phone number and advances to OTP verify step', async () => {
        (supabase.auth.signInWithOtp as jest.Mock).mockResolvedValue({
            data: { user: null, session: null },
            error: null,
        });

        const { getByPlaceholderText, getByText } = render(<AuthForm />);

        const phoneInput = getByPlaceholderText('98765 43210');
        fireEvent.changeText(phoneInput, '9876543210');

        const submitBtn = getByText('Get Verification Code ➔');
        await act(async () => {
            fireEvent.press(submitBtn);
        });

        await waitFor(() => {
            expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
                phone: '+919876543210',
                options: { shouldCreateUser: true },
            });
            expect(getByText('Verify 6-Digit OTP Code')).toBeTruthy();
            expect(getByPlaceholderText('1 2 3 4 5 6')).toBeTruthy();
        });
    });

    it('invokes supabase.auth.verifyOtp on submitting 6-digit verification code', async () => {
        (supabase.auth.signInWithOtp as jest.Mock).mockResolvedValue({
            data: { user: null, session: null },
            error: null,
        });
        (supabase.auth.verifyOtp as jest.Mock).mockResolvedValue({
            data: { user: { id: 'user-123' }, session: { access_token: 'token-123' } },
            error: null,
        });

        const { getByPlaceholderText, getByText } = render(<AuthForm />);

        // Step 1: Send OTP
        const phoneInput = getByPlaceholderText('98765 43210');
        fireEvent.changeText(phoneInput, '9876543210');

        await act(async () => {
            fireEvent.press(getByText('Get Verification Code ➔'));
        });

        // Step 2: Verify OTP
        await waitFor(() => {
            expect(getByPlaceholderText('1 2 3 4 5 6')).toBeTruthy();
        });

        const otpInput = getByPlaceholderText('1 2 3 4 5 6');
        fireEvent.changeText(otpInput, '123456');

        const verifyBtn = getByText('Verify Code & Sign In ➔');
        await act(async () => {
            fireEvent.press(verifyBtn);
        });

        await waitFor(() => {
            expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
                phone: '+919876543210',
                token: '123456',
                type: 'sms',
            });
        });
    });

    it('activates mock OTP fallback when Supabase phone provider is disabled', async () => {
        (supabase.auth.signInWithOtp as jest.Mock).mockResolvedValue({
            data: null,
            error: { code: 'phone_provider_disabled', message: 'Phone provider disabled in project' },
        });
        (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
            data: { session: { user: { id: 'mock-user-123' } } },
            error: null,
        });

        const { getByPlaceholderText, getByText } = render(<AuthForm />);

        const phoneInput = getByPlaceholderText('98765 43210');
        fireEvent.changeText(phoneInput, '9876543210');

        await act(async () => {
            fireEvent.press(getByText('Get Verification Code ➔'));
        });

        await waitFor(() => {
            expect(getByText('Verify 6-Digit OTP Code')).toBeTruthy();
            expect(getByText(/SMS OTP simulated \(Dev Mode\)/)).toBeTruthy();
        });

        // Verify with mock code '123456'
        const otpInput = getByPlaceholderText('1 2 3 4 5 6');
        fireEvent.changeText(otpInput, '123456');

        await act(async () => {
            fireEvent.press(getByText('Verify Code & Sign In ➔'));
        });

        await waitFor(() => {
            expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
                email: 'phone_919876543210@mock-phone-auth.openmatch.app',
                password: 'MockPhonePass_919876543210!',
            });
        });
    });

    it('allows changing phone number from OTP step back to phone input step', async () => {
        (supabase.auth.signInWithOtp as jest.Mock).mockResolvedValue({
            data: { user: null, session: null },
            error: null,
        });

        const { getByPlaceholderText, getByText } = render(<AuthForm />);

        fireEvent.changeText(getByPlaceholderText('98765 43210'), '9876543210');

        await act(async () => {
            fireEvent.press(getByText('Get Verification Code ➔'));
        });

        await waitFor(() => {
            expect(getByText('Change Number')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(getByText('Change Number'));
        });

        expect(getByText('Enter your Mobile Number')).toBeTruthy();
    });

    it('toggles to email fallback and back to phone input', async () => {
        const { getByText, getByPlaceholderText } = render(<AuthForm />);

        const toggleEmailBtn = getByText('Use Email & Password instead');
        fireEvent.press(toggleEmailBtn);

        expect(getByPlaceholderText('Email Address')).toBeTruthy();
        expect(getByPlaceholderText('Password')).toBeTruthy();

        const togglePhoneBtn = getByText('← Back to Phone Verification');
        fireEvent.press(togglePhoneBtn);

        expect(getByText('Enter your Mobile Number')).toBeTruthy();
    });
});
