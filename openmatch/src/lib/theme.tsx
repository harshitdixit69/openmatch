import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeColors {
    background: string;
    cardBackground: string;
    cardBorder: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    headerBackground: string;
    headerBorder: string;
    statusBar: 'light' | 'dark';
}

export const LIGHT_THEME_COLORS: ThemeColors = {
    // v2 futuristic light: cool cloud background, glassy cards, coral accent.
    background: '#f6f8ff',
    cardBackground: '#ffffff',
    cardBorder: '#e2e7f5',
    textPrimary: '#232a45',
    textSecondary: '#5a6488',
    textMuted: '#8a93b2',
    accent: '#ff6a3d',
    headerBackground: '#ffffff',
    headerBorder: '#e2e7f5',
    statusBar: 'dark',
};

export const DARK_THEME_COLORS: ThemeColors = {
    // v2 futuristic dark: deep space-navy, violet-tinted borders, warm coral accent.
    background: '#070912',
    cardBackground: '#121732',
    cardBorder: '#232b52',
    textPrimary: '#f4f6ff',
    textSecondary: '#aab2d5',
    textMuted: '#6f78a0',
    accent: '#ff6a3d',
    headerBackground: '#0c1020',
    headerBorder: '#1a2142',
    statusBar: 'light',
};

interface ThemeContextType {
    themeMode: ThemeMode;
    activeTheme: 'light' | 'dark';
    colors: ThemeColors;
    setThemeMode: (mode: ThemeMode) => Promise<void>;
    toggleTheme: () => Promise<void>;
}

const THEME_STORAGE_KEY = '@openmatch_theme_mode';

const ThemeContext = createContext<ThemeContextType>({
    themeMode: 'light',
    activeTheme: 'light',
    colors: LIGHT_THEME_COLORS,
    setThemeMode: async () => {},
    toggleTheme: async () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const systemColorScheme = useColorScheme();
    const [themeMode, setThemeModeState] = useState<ThemeMode>('light');

    useEffect(() => {
        AsyncStorage.getItem(THEME_STORAGE_KEY)
            .then((val) => {
                if (val === 'dark' || val === 'light' || val === 'system') {
                    setThemeModeState(val);
                }
            })
            .catch((err) => {
                console.warn('Failed to load theme preference:', err);
            });
    }, []);

    const activeTheme: 'light' | 'dark' =
        themeMode === 'system' ? (systemColorScheme === 'dark' ? 'dark' : 'light') : themeMode;

    const colors = activeTheme === 'dark' ? DARK_THEME_COLORS : LIGHT_THEME_COLORS;

    const setThemeMode = async (mode: ThemeMode) => {
        setThemeModeState(mode);
        try {
            await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
        } catch (err) {
            console.warn('Failed to persist theme preference:', err);
        }
    };

    const toggleTheme = async () => {
        const next = activeTheme === 'dark' ? 'light' : 'dark';
        await setThemeMode(next);
    };

    return React.createElement(
        ThemeContext.Provider,
        { value: { themeMode, activeTheme, colors, setThemeMode, toggleTheme } },
        children,
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}
