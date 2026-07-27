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
    background: '#eff6f8',
    cardBackground: '#ffffff',
    cardBorder: '#d7e3e6',
    textPrimary: '#0e2e3a',
    textSecondary: '#4a6670',
    textMuted: '#829198',
    accent: '#e56a3a',
    headerBackground: '#ffffff',
    headerBorder: '#e5e5e5',
    statusBar: 'dark',
};

export const DARK_THEME_COLORS: ThemeColors = {
    background: '#0d0c0f',
    cardBackground: '#16151a',
    cardBorder: '#2a2640',
    textPrimary: '#ffffff',
    textSecondary: '#9e9bb0',
    textMuted: '#6c6880',
    accent: '#d4b373',
    headerBackground: '#16151a',
    headerBorder: '#2a2640',
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
