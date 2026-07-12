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
        backgroundColor: '#fff',
        borderRadius: 14,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 2,
    },
    title: {
        fontSize: 13,
        fontWeight: '600',
        color: '#666',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginBottom: 12,
    },
});
