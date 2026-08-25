// src/components/prefs/SectionCard.tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
    title: string;
    children: React.ReactNode;
}

export function SectionCard({ title, children }: Props) {
    return (
        <View style={styles.card}>
            <Text style={styles.title}>{title}</Text>
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#141318',
        borderRadius: 16,
        padding: 18,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    title: {
        fontSize: 12,
        fontWeight: '800',
        color: '#d4a853',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        marginBottom: 14,
    },
});
