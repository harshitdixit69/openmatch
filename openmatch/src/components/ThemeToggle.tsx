import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';

export function ThemeToggle() {
    const { activeTheme, toggleTheme, colors } = useTheme();
    const isDark = activeTheme === 'dark';

    return (
        <Pressable
            onPress={toggleTheme}
            style={[styles.container, { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder }]}
            accessibilityRole="button"
            accessibilityLabel={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
            <View style={[styles.iconCircle, { backgroundColor: isDark ? '#2a2640' : '#f1f5f7' }]}>
                <Text style={styles.iconText}>{isDark ? '🌙' : '☀️'}</Text>
            </View>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
                {isDark ? 'Dark' : 'Light'}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        borderRadius: 20,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    iconCircle: {
        alignItems: 'center',
        borderRadius: 14,
        height: 28,
        justifyContent: 'center',
        width: 28,
    },
    iconText: {
        fontSize: 16,
    },
    label: {
        fontSize: 13,
        fontWeight: '600',
    },
});
