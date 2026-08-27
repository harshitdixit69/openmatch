// src/components/prefs/SectionCard.tsx
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, type ThemeColors } from '../../lib/theme';

interface Props {
    title: string;
    children: React.ReactNode;
}

export function SectionCard({ title, children }: Props) {
    const { colors } = useTheme();
    const styles = useMemo(() => makeStyles(colors), [colors]);
    return (
        <View style={styles.card}>
            <Text style={styles.title}>{title}</Text>
            {children}
        </View>
    );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
    card: {
        backgroundColor: c.cardBackground,
        borderRadius: 14,
        padding: 16,
        marginBottom: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.cardBorder,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 2,
    },
    title: {
        fontSize: 13,
        fontWeight: '600',
        color: c.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginBottom: 12,
    },
});
