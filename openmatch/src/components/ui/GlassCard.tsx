// src/components/ui/GlassCard.tsx
//
// Frosted-glass surface for the v2 UI. Uses expo-blur when available for a true
// glassmorphism blur, and always paints a translucent fill + hairline border so it
// still reads as "glass" on platforms/renderers where blur is unavailable.
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { radii, spacing, surfaceFor } from '../../lib/designSystem';
import { useTheme } from '../../lib/theme';

interface Props {
    children: React.ReactNode;
    /** Use the stronger, more opaque glass (for modals/sheets). */
    strong?: boolean;
    style?: StyleProp<ViewStyle>;
    padded?: boolean;
}

export function GlassCard({ children, strong = false, style, padded = true }: Props) {
    const { activeTheme } = useTheme();
    const surface = surfaceFor(activeTheme);

    return (
        <View
            style={[
                styles.base,
                {
                    backgroundColor: strong ? surface.glassStrong : surface.glass,
                    borderColor: surface.glassBorder,
                },
                padded && styles.padded,
                style,
            ]}
        >
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    base: {
        borderRadius: radii.lg,
        borderWidth: 1,
        overflow: 'hidden',
    },
    padded: {
        padding: spacing.lg,
    },
});

export default GlassCard;
