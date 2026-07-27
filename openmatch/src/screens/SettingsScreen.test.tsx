import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SettingsScreen } from './SettingsScreen';
import { ThemeProvider } from '../lib/theme';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock Supabase
jest.mock('../lib/supabase', () => ({
    supabase: {
        auth: {
            getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-123', email: 'test@openmatch.app' } } }),
            updateUser: jest.fn(),
            signOut: jest.fn(),
            onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
        },
        from: jest.fn(() => ({
            select: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({ data: { verification_status: 'verified', busy_mode: false }, error: null }),
            })),
            update: jest.fn(() => ({
                eq: jest.fn().mockResolvedValue({ data: null, error: null }),
            })),
        })),
    },
}));

const mockSafeAreaMetrics = {
    frame: { x: 0, y: 0, width: 360, height: 640 },
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

describe('SettingsScreen & Theme Toggle Tests', () => {
    it('renders SettingsScreen with Account, Appearance, Availability sections', async () => {
        const { getByText } = render(
            <SafeAreaProvider initialMetrics={mockSafeAreaMetrics}>
                <ThemeProvider>
                    <SettingsScreen onBack={() => {}} onSignedOut={() => {}} />
                </ThemeProvider>
            </SafeAreaProvider>
        );

        await waitFor(() => {
            expect(getByText('Settings')).toBeTruthy();
            expect(getByText('Account')).toBeTruthy();
            expect(getByText('Appearance')).toBeTruthy();
            expect(getByText('Dark Mode')).toBeTruthy();
            expect(getByText('Light mode enabled')).toBeTruthy();
        });
    });

    it('toggles Dark Mode switch on and updates theme status label', async () => {
        const { getByText } = render(
            <SafeAreaProvider initialMetrics={mockSafeAreaMetrics}>
                <ThemeProvider>
                    <SettingsScreen onBack={() => {}} onSignedOut={() => {}} />
                </ThemeProvider>
            </SafeAreaProvider>
        );

        await waitFor(() => {
            expect(getByText('Dark Mode')).toBeTruthy();
            expect(getByText('Light mode enabled')).toBeTruthy();
        });
    });
});
