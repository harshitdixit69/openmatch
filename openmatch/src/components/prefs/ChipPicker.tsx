// src/components/prefs/ChipPicker.tsx
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { HorizontalScrollAffordance } from '../HorizontalScrollAffordance';

interface Props<T extends string> {
    options: readonly T[];
    labels?: Partial<Record<T, string>>;
    selected: T | null;
    onSelect: (value: T) => void;
}

export function ChipPicker<T extends string>({ options, labels, selected, onSelect }: Props<T>) {
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

const styles = StyleSheet.create({
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
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    chipSelected: {
        borderColor: '#d4a853',
        backgroundColor: '#d4a853',
    },
    chipText: {
        fontSize: 13,
        color: '#8e8a9e',
        fontWeight: '500',
    },
    chipTextSelected: {
        color: '#0a0a0c',
        fontWeight: '800',
    },
});
