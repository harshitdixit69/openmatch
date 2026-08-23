// src/components/ui/AuroraBackground.tsx
//
// Full-bleed animated-feeling backdrop for v2 screens: a soft aurora gradient with a
// couple of blurred colour "orbs" to give depth. Purely decorative — render it as the
// first child of a screen container with the real content layered on top.
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { gradients, palette } from '../../lib/designSystem';
import { useTheme } from '../../lib/theme';

interface Props {
    children?: React.ReactNode;
    style?: StyleProp<ViewStyle>;
}

export function AuroraBackground({ children, style }: Props) {
    const { activeTheme } = useTheme();
    const isDark = activeTheme === 'dark';
    const base = isDark ? gradients.auroraDark : gradients.auroraLight;

    return (
        <View style={[styles.root, style]}>
            <LinearGradient
                colors={base as unknown as readonly [string, string, ...string[]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
            />
            {/* Decorative colour orbs (blurred by large radius + low opacity). */}
            <View
                style={[
                    styles.orb,
                    styles.orbTop,
                    { backgroundColor: palette.violet, opacity: isDark ? 0.28 : 0.14 },
                ]}
            />
            <View
                style={[
                    styles.orb,
                    styles.orbBottom,
                    { backgroundColor: palette.coral, opacity: isDark ? 0.22 : 0.12 },
                ]}
            />
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, overflow: 'hidden' },
    orb: {
        position: 'absolute',
        width: 320,
        height: 320,
        borderRadius: 160,
    },
    orbTop: { top: -120, right: -80 },
    orbBottom: { bottom: -140, left: -100 },
});

export default AuroraBackground;
