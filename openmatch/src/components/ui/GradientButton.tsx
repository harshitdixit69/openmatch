// src/components/ui/GradientButton.tsx
//
// Primary v2 call-to-action: a pill button filled with a brand gradient and a soft glow.
// Falls back gracefully (solid coral) if a gradient variant isn't provided.
import React from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleProp,
    StyleSheet,
    Text,
    TextStyle,
    View,
    ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { gradients, glow, radii, spacing, typography, palette } from '../../lib/designSystem';

type GradientVariant = keyof typeof gradients;

interface Props {
    label: string;
    onPress?: () => void;
    variant?: GradientVariant;
    disabled?: boolean;
    loading?: boolean;
    /** Optional leading glyph/emoji or icon element. */
    icon?: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    /** Full width by default; set false to hug content. */
    fullWidth?: boolean;
}

export function GradientButton({
    label,
    onPress,
    variant = 'primary',
    disabled = false,
    loading = false,
    icon,
    style,
    textStyle,
    fullWidth = true,
}: Props) {
    const colors = gradients[variant] ?? gradients.primary;
    const glowColor = colors[colors.length - 1];
    const isInert = disabled || loading;

    return (
        <Pressable
            onPress={isInert ? undefined : onPress}
            disabled={isInert}
            accessibilityRole="button"
            accessibilityState={{ disabled: isInert, busy: loading }}
            style={({ pressed }) => [
                styles.wrapper,
                fullWidth && styles.fullWidth,
                !isInert && glow(glowColor, 0.45, 18),
                pressed && !isInert && styles.pressed,
                isInert && styles.disabled,
                style,
            ]}
        >
            <LinearGradient
                colors={colors as unknown as readonly [string, string, ...string[]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.gradient}
            >
                {loading ? (
                    <ActivityIndicator size="small" color={palette.white} />
                ) : (
                    <View style={styles.content}>
                        {icon ? <View style={styles.icon}>{icon}</View> : null}
                        <Text style={[styles.label, textStyle]} numberOfLines={1}>
                            {label}
                        </Text>
                    </View>
                )}
            </LinearGradient>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        borderRadius: radii.pill,
        overflow: 'hidden',
    },
    fullWidth: { width: '100%' },
    pressed: { transform: [{ scale: 0.98 }], opacity: 0.95 },
    disabled: { opacity: 0.5 },
    gradient: {
        minHeight: 52,
        paddingHorizontal: spacing.xl,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    icon: { marginRight: 2 },
    label: {
        ...typography.heading,
        color: palette.white,
        letterSpacing: 0.3,
    },
});

export default GradientButton;
