// src/components/prefs/HeightRangeRow.tsx
// DB always stores cm. Display toggles between cm and feet/inches.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { cmToFeetInches, feetInchesToCm } from '../../lib/partnerPreferences';

interface Props {
    min: number | null;  // cm
    max: number | null;  // cm
    onChange: (min: number | null, max: number | null) => void;
}

type Unit = 'cm' | 'ft';

export function HeightRangeRow({ min, max, onChange }: Props) {
    const [unit, setUnit] = useState<Unit>('cm');

    function display(cm: number | null): string {
        if (cm === null) return '';
        return unit === 'cm' ? String(cm) : cmToFeetInches(cm);
    }

    function parse(raw: string): number | null {
        if (!raw.trim()) return null;
        if (unit === 'cm') {
            const n = parseInt(raw, 10);
            return isNaN(n) ? null : n;
        }
        // expect "5'7"" or "5'7" format
        const match = raw.match(/^(\d+)'(\d+)"?$/);
        if (match) return feetInchesToCm(parseInt(match[1], 10), parseInt(match[2], 10));
        const n = parseInt(raw, 10);
        return isNaN(n) ? null : feetInchesToCm(n, 0);
    }

    const placeholder = unit === 'cm' ? '155' : "5'1\"";
    const maxPlaceholder = unit === 'cm' ? '185' : "6'1\"";

    return (
        <View style={styles.container}>
            <View style={styles.row}>
                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Min height</Text>
                    <TextInput
                        style={styles.input}
                        value={display(min)}
                        placeholder={placeholder}
                        placeholderTextColor="#bbb"
                        onChangeText={(t) => onChange(parse(t), max)}
                    />
                </View>
                <Text style={styles.dash}>–</Text>
                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Max height</Text>
                    <TextInput
                        style={styles.input}
                        value={display(max)}
                        placeholder={maxPlaceholder}
                        placeholderTextColor="#bbb"
                        onChangeText={(t) => onChange(min, parse(t))}
                    />
                </View>
                <View style={styles.unitToggle}>
                    {(['cm', 'ft'] as Unit[]).map((u) => (
                        <Pressable
                            key={u}
                            style={[styles.unitBtn, unit === u && styles.unitBtnActive]}
                            onPress={() => setUnit(u)}
                        >
                            <Text style={[styles.unitBtnText, unit === u && styles.unitBtnTextActive]}>
                                {u}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </View>
            {(min !== null || max !== null) && (
                <Text style={styles.hint}>
                    {min !== null ? cmToFeetInches(min) : '?'} – {max !== null ? cmToFeetInches(max) : '?'} ({min ?? '?'} – {max ?? '?'} cm)
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { gap: 6 },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
    },
    inputGroup: { flex: 1 },
    label: { fontSize: 11, color: '#999', marginBottom: 4 },
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
    dash: { fontSize: 18, color: '#999', paddingBottom: 10 },
    unitToggle: {
        flexDirection: 'row',
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: '#d0d0d0',
        overflow: 'hidden',
        marginBottom: 2,
    },
    unitBtn: {
        paddingHorizontal: 10,
        paddingVertical: 9,
        backgroundColor: '#fafafa',
    },
    unitBtnActive: { backgroundColor: '#123340' },
    unitBtnText: { fontSize: 12, color: '#666', fontWeight: '600' },
    unitBtnTextActive: { color: '#fff' },
    hint: { fontSize: 11, color: '#aaa', marginTop: 2 },
});
