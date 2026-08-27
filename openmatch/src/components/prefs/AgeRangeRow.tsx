// src/components/prefs/AgeRangeRow.tsx
import React, { useMemo } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme, type ThemeColors } from '../../lib/theme';

interface Props {
    min: number | null;
    max: number | null;
    onChange: (min: number | null, max: number | null) => void;
}

export function AgeRangeRow({ min, max, onChange }: Props) {
    const { colors } = useTheme();
    const styles = useMemo(() => makeStyles(colors), [colors]);
    function parseAge(raw: string): number | null {
        const n = parseInt(raw, 10);
        if (isNaN(n)) return null;
        return n;
    }

    return (
        <View style={styles.row}>
            <View style={styles.inputGroup}>
                <Text style={styles.label}>Min age</Text>
                <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    maxLength={2}
                    value={min !== null ? String(min) : ''}
                    placeholder="18"
                    placeholderTextColor={colors.textMuted}
                    onChangeText={(t) => onChange(parseAge(t), max)}
                />
            </View>
            <Text style={styles.dash}>–</Text>
            <View style={styles.inputGroup}>
                <Text style={styles.label}>Max age</Text>
                <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    maxLength={2}
                    value={max !== null ? String(max) : ''}
                    placeholder="45"
                    placeholderTextColor={colors.textMuted}
                    onChangeText={(t) => onChange(min, parseAge(t))}
                />
            </View>
            <Text style={styles.unit}>yrs</Text>
        </View>
    );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
    },
    inputGroup: {
        flex: 1,
    },
    label: {
        fontSize: 11,
        color: c.textMuted,
        marginBottom: 4,
    },
    input: {
        borderWidth: 1.5,
        borderColor: c.cardBorder,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
        color: c.textPrimary,
        backgroundColor: c.background,
        textAlign: 'center',
    },
    dash: {
        fontSize: 18,
        color: c.textMuted,
        paddingBottom: 10,
    },
    unit: {
        fontSize: 13,
        color: c.textSecondary,
        paddingBottom: 12,
    },
});
