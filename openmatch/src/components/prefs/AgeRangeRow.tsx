// src/components/prefs/AgeRangeRow.tsx
import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

interface Props {
    min: number | null;
    max: number | null;
    onChange: (min: number | null, max: number | null) => void;
}

export function AgeRangeRow({ min, max, onChange }: Props) {
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
                    placeholderTextColor="#bbb"
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
                    placeholderTextColor="#bbb"
                    onChangeText={(t) => onChange(min, parseAge(t))}
                />
            </View>
            <Text style={styles.unit}>yrs</Text>
        </View>
    );
}

const styles = StyleSheet.create({
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
        color: '#999',
        marginBottom: 4,
    },
    input: {
        borderWidth: 1.5,
        borderColor: '#d0d0d0',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
        color: '#111',
        backgroundColor: '#fafafa',
        textAlign: 'center',
    },
    dash: {
        fontSize: 18,
        color: '#999',
        paddingBottom: 10,
    },
    unit: {
        fontSize: 13,
        color: '#666',
        paddingBottom: 12,
    },
});
