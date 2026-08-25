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
    background: '#f8f6f3',
    cardBackground: '#ffffff',
    cardBorder: '#e8e2da',
    textPrimary: '#1a1a1a',
    textSecondary: '#5c5c5c',
    textMuted: '#9a9a9a',
    accent: '#c8903e',
    headerBackground: '#ffffff',
    headerBorder: '#ebe5dd',
    statusBar: 'dark',
};

export const DARK_THEME_COLORS: ThemeColors = {
    background: '#0a0a0c',
    cardBackground: '#141318',
    cardBorder: '#1e1d26',
    textPrimary: '#f0ece4',
    textSecondary: '#8e8a9e',
    textMuted: '#5a5770',
    accent: '#d4a853',
    headerBackground: '#111015',
    headerBorder: '#1e1d26',
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
    themeMode: 'dark',
    activeTheme: 'dark',
    colors: DARK_THEME_COLORS,
    setThemeMode: async () => {},
    toggleTheme: async () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const systemColorScheme = useColorScheme();
    const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');

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
