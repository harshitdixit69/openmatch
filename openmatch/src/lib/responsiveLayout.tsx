import { createContext, useContext, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { EdgeInsets, useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Centralised responsive-layout helpers so every screen shares the same
 * breakpoints, max content width, and safe-area / tab-bar spacing rules.
 * This keeps the app readable on small phones, large phones, tablets and the
 * web preview without repeating magic numbers in each screen.
 */

// Caps how wide the primary content column can grow. On tablets and the web
// preview this keeps text line-lengths comfortable instead of edge-to-edge.
export const MAX_CONTENT_WIDTH = 640;

// Width breakpoints (in dp). Below `COMPACT_WIDTH` we stack headers, shrink
// paddings, and use tighter typography.
const COMPACT_WIDTH = 430;
const NARROW_WIDTH = 360;

// Height breakpoint used to switch the swipe feed into its condensed layout.
const COMPACT_HEIGHT = 760;

export type ResponsiveLayout = {
    width: number;
    height: number;
    insets: EdgeInsets;
    /** True on narrow phones where side-by-side headers should stack. */
    isCompactWidth: boolean;
    /** True on very narrow phones (small Androids, split-screen web). */
    isNarrowWidth: boolean;
    /** True on short viewports (landscape phones, short web previews). */
    isCompactHeight: boolean;
    /** Convenience flag: either dimension is constrained. */
    isCompact: boolean;
    /** Horizontal gutter that scales down on the smallest screens. */
    horizontalPadding: number;
    /** Largest width the content column should occupy. */
    maxContentWidth: number;
    /** Actual content width after clamping to `maxContentWidth`. */
    contentWidth: number;
};

/**
 * Reactive layout info derived from the window size and safe-area insets.
 * Re-renders automatically on rotation / window resize.
 */
export function useResponsiveLayout(): ResponsiveLayout {
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();

    return useMemo(() => {
        const isCompactWidth = width < COMPACT_WIDTH;
        const isNarrowWidth = width < NARROW_WIDTH;
        const isCompactHeight = height < COMPACT_HEIGHT;
        const horizontalPadding = isNarrowWidth ? 16 : 20;
        const contentWidth = Math.min(width, MAX_CONTENT_WIDTH);

        return {
            width,
            height,
            insets,
            isCompactWidth,
            isNarrowWidth,
            isCompactHeight,
            isCompact: isCompactWidth || isCompactHeight,
            horizontalPadding,
            maxContentWidth: MAX_CONTENT_WIDTH,
            contentWidth,
        };
    }, [width, height, insets]);
}

/**
 * A reusable style fragment for centering a max-width content column. Spread it
 * onto the outermost content wrapper of a screen.
 */
export function centeredContentStyle() {
    return {
        alignSelf: 'center' as const,
        width: '100%' as const,
        maxWidth: MAX_CONTENT_WIDTH,
    };
}

/**
 * The amount of vertical space (in dp) the bottom tab bar occupies, including
 * the device home-indicator inset. Scrollable screens add this to their bottom
 * content padding so nothing hides behind the tab bar.
 *
 * Provided by `MainTabsScreen`, which owns the tab bar and measures its height.
 */
export const TabBarSpacingContext = createContext<number>(0);

export function useTabBarSpacing(): number {
    return useContext(TabBarSpacingContext);
}
