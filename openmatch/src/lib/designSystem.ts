// src/lib/designSystem.ts
//
// OpenMatch v2 "futuristic" design system.
//
// A single source of truth for the redesigned UI: colour palette, gradients, glassmorphism
// surfaces, spacing/radii scales, typography and glow shadows. Screens should consume these
// tokens instead of hardcoding hex values, so the whole app can evolve consistently and the
// light/dark themes stay in lockstep.
//
// Design direction:
//   * Deep space-navy backgrounds with subtle aurora gradients
//   * Glass (frosted, translucent) cards with hairline borders
//   * A warm coral -> magenta primary gradient (keeps brand warmth, adds energy)
//   * Electric cyan/violet secondary accents for "smart"/AI surfaces
//   * Soft outer glows instead of hard drop shadows
//
// NOTE: React Native core has no gradient primitive; use `expo-linear-gradient`
// (<LinearGradient colors={gradient.primary} ... />) with the arrays exported here.

import { Platform, TextStyle, ViewStyle } from 'react-native';

// ── Core palette ────────────────────────────────────────────────────────────
export const palette = {
    // Brand
    coral: '#ff6a3d',
    coralBright: '#ff8a5c',
    magenta: '#ff4d8d',
    violet: '#7c5cff',
    cyan: '#22d3ee',
    mint: '#34e0a1',
    amber: '#ffc24b',
    rose: '#ff5470',

    // Space-navy neutrals (dark)
    ink900: '#070912',
    ink800: '#0c1020',
    ink700: '#121732',
    ink600: '#1a2142',
    ink500: '#232b52',

    // Light neutrals
    cloud50: '#f6f8ff',
    cloud100: '#eef1fb',
    cloud200: '#e2e7f5',
    slate400: '#8a93b2',
    slate600: '#5a6488',
    slate800: '#232a45',

    white: '#ffffff',
    black: '#000000',
};

// ── Gradients (arrays for expo-linear-gradient) ──────────────────────────────
export const gradients = {
    /** Primary CTA / brand — warm coral into magenta. */
    primary: ['#ff6a3d', '#ff4d8d'] as const,
    /** AI / "smart" surfaces — electric violet into cyan. */
    smart: ['#7c5cff', '#22d3ee'] as const,
    /** Premium / VIP — gold-amber into rose. */
    premium: ['#ffc24b', '#ff5470'] as const,
    /** Aurora backdrop for dark screens (very subtle, low opacity when layered). */
    auroraDark: ['#0c1020', '#151a3a', '#0c1020'] as const,
    /** Aurora backdrop for light screens. */
    auroraLight: ['#f6f8ff', '#eef1fb', '#e8ecfb'] as const,
    /** Success. */
    success: ['#34e0a1', '#22d3ee'] as const,
};

// ── Spacing scale (4pt grid) ─────────────────────────────────────────────────
export const spacing = {
    xxs: 2,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
    xxxl: 48,
} as const;

// ── Radii ────────────────────────────────────────────────────────────────────
export const radii = {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 22,
    pill: 999,
} as const;

// ── Semantic surfaces per theme ──────────────────────────────────────────────
export interface FuturisticSurface {
    /** Base screen background. */
    background: string;
    /** Frosted-glass card fill (semi-translucent). */
    glass: string;
    /** Stronger glass for elevated sheets/modals. */
    glassStrong: string;
    /** Hairline border on glass. */
    glassBorder: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    /** On-gradient text (always near-white). */
    onAccent: string;
}

export const DARK_SURFACE: FuturisticSurface = {
    background: palette.ink900,
    glass: 'rgba(28, 34, 66, 0.55)',
    glassStrong: 'rgba(28, 34, 66, 0.82)',
    glassBorder: 'rgba(124, 92, 255, 0.22)',
    textPrimary: '#f4f6ff',
    textSecondary: '#aab2d5',
    textMuted: '#6f78a0',
    onAccent: '#ffffff',
};

export const LIGHT_SURFACE: FuturisticSurface = {
    background: palette.cloud50,
    glass: 'rgba(255, 255, 255, 0.72)',
    glassStrong: 'rgba(255, 255, 255, 0.92)',
    glassBorder: 'rgba(124, 92, 255, 0.16)',
    textPrimary: palette.slate800,
    textSecondary: palette.slate600,
    textMuted: palette.slate400,
    onAccent: '#ffffff',
};

export function surfaceFor(theme: 'light' | 'dark'): FuturisticSurface {
    return theme === 'dark' ? DARK_SURFACE : LIGHT_SURFACE;
}

// ── Typography ────────────────────────────────────────────────────────────────
export const typography = {
    display: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 } as TextStyle,
    title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 } as TextStyle,
    heading: { fontSize: 18, fontWeight: '700' } as TextStyle,
    body: { fontSize: 15, fontWeight: '500' } as TextStyle,
    caption: { fontSize: 13, fontWeight: '500' } as TextStyle,
    /** All-caps eyebrow/label. */
    eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4 } as TextStyle,
} as const;

// ── Glow shadows ──────────────────────────────────────────────────────────────
// Soft coloured outer glows. On Android, elevation approximates depth.
export function glow(color: string, opacity = 0.5, radius = 20): ViewStyle {
    return Platform.select<ViewStyle>({
        ios: {
            shadowColor: color,
            shadowOpacity: opacity,
            shadowRadius: radius,
            shadowOffset: { width: 0, height: 8 },
        },
        android: { elevation: 10 },
        default: {
            // web
            shadowColor: color,
            shadowOpacity: opacity,
            shadowRadius: radius,
            shadowOffset: { width: 0, height: 8 },
        },
    }) as ViewStyle;
}

/** Ready-made glass card style for a given theme. */
export function glassCard(theme: 'light' | 'dark'): ViewStyle {
    const s = surfaceFor(theme);
    return {
        backgroundColor: s.glass,
        borderColor: s.glassBorder,
        borderWidth: 1,
        borderRadius: radii.lg,
        padding: spacing.lg,
    };
}

export const designSystem = {
    palette,
    gradients,
    spacing,
    radii,
    typography,
    surfaceFor,
    glow,
    glassCard,
};

export default designSystem;
