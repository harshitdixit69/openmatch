// src/components/prefs/ChipPicker.tsx
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { HorizontalScrollAffordance } from '../HorizontalScrollAffordance';
import { useTheme, type ThemeColors } from '../../lib/theme';

interface Props<T extends string> {
    options: readonly T[];
    labels?: Partial<Record<T, string>>;
    selected: T | null;
    onSelect: (value: T) => void;
}

export function ChipPicker<T extends string>({ options, labels, selected, onSelect }: Props<T>) {
    const styles = useThemedStyles();
    return (
        <HorizontalScrollAffordance contentContainerStyle={styles.row} arrowAccessibilityLabelPrefix="options">
            {options.map((opt) => {
                const isSelected = selected === opt;
                return (
                    <Pressable
                        key={opt}
                        style={[styles.chip, isSelected && styles.chipSelected]}
                        onPress={() => onSelect(opt)}
                    >
                        <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                            {labels?.[opt] ?? opt}
                        </Text>
                    </Pressable>
                );
            })}
        </HorizontalScrollAffordance>
    );
}

interface MultiProps<T extends string> {
    options: readonly T[];
    labels?: Partial<Record<T, string>>;
    selected: T[];
    onToggle: (value: T) => void;
}

export function MultiChipPicker<T extends string>({ options, labels, selected, onToggle }: MultiProps<T>) {
    const styles = useThemedStyles();
    return (
        <HorizontalScrollAffordance contentContainerStyle={styles.row} arrowAccessibilityLabelPrefix="options">
            {options.map((opt) => {
                const isSelected = selected.includes(opt);
                return (
                    <Pressable
                        key={opt}
                        style={[styles.chip, isSelected && styles.chipSelected]}
                        onPress={() => onToggle(opt)}
                    >
                        <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                            {labels?.[opt] ?? opt}
                        </Text>
                    </Pressable>
                );
            })}
        </HorizontalScrollAffordance>
    );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
    row: {
        flexDirection: 'row',
        flexWrap: 'nowrap',
        gap: 8,
        paddingRight: 4,
    },
    chip: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1.5,
        borderColor: c.cardBorder,
        backgroundColor: c.background,
    },
    chipSelected: {
        borderColor: c.accent,
        backgroundColor: c.accent,
    },
    chipText: {
        fontSize: 13,
        color: c.textSecondary,
        fontWeight: '500',
    },
    chipTextSelected: {
        color: '#fff',
    },
});

function useThemedStyles() {
    const { colors } = useTheme();
    return useMemo(() => makeStyles(colors), [colors]);
}
