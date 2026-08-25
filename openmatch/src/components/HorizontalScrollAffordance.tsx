import { ReactNode, useCallback, useRef, useState } from 'react';
import { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, View, ViewStyle } from 'react-native';

import { getScrollAffordances, getScrollStepOffset, ScrollMetrics } from '../lib/scrollAffordance';

type Props = {
    children: ReactNode;
    contentContainerStyle?: ViewStyle;
    style?: ViewStyle;
    /** Background colour the edge fade blends into. Should match the parent card. */
    fadeColor?: string;
    /** Colour of the chevron glyph. Should contrast with `fadeColor`. */
    chevronColor?: string;
    /** Border colour of the circular arrow button. */
    arrowBorderColor?: string;
    arrowAccessibilityLabelPrefix?: string;
};

/**
 * A horizontal ScrollView that surfaces left/right chevrons (plus an edge fade)
 * whenever there is off-screen content in that direction.
 *
 * Without this, an overflowing row looks identical to a complete one — the
 * native scrollbar is hidden and, on web, there is no touch momentum to hint
 * that the row scrolls at all.
 */
export function HorizontalScrollAffordance({
    children,
    contentContainerStyle,
    style,
    fadeColor = '#ffffff',
    chevronColor = '#121732',
    arrowBorderColor = '#e2e7f5',
    arrowAccessibilityLabelPrefix = 'options',
}: Props) {
    const scrollRef = useRef<ScrollView>(null);
    const metricsRef = useRef<ScrollMetrics>({ offsetX: 0, viewportWidth: 0, contentWidth: 0 });
    const [affordances, setAffordances] = useState({ canScrollLeft: false, canScrollRight: false });

    const sync = useCallback((next: Partial<ScrollMetrics>) => {
        metricsRef.current = { ...metricsRef.current, ...next };
        const computed = getScrollAffordances(metricsRef.current);
        setAffordances((prev) =>
            prev.canScrollLeft === computed.canScrollLeft && prev.canScrollRight === computed.canScrollRight
                ? prev
                : computed
        );
    }, []);

    const handleScroll = useCallback(
        (event: NativeSyntheticEvent<NativeScrollEvent>) => {
            sync({ offsetX: event.nativeEvent.contentOffset.x });
        },
        [sync]
    );

    const handleLayout = useCallback(
        (event: LayoutChangeEvent) => {
            sync({ viewportWidth: event.nativeEvent.layout.width });
        },
        [sync]
    );

    const handleContentSizeChange = useCallback(
        (contentWidth: number) => {
            sync({ contentWidth });
        },
        [sync]
    );

    const step = useCallback((direction: 'left' | 'right') => {
        const target = getScrollStepOffset(metricsRef.current, direction);
        scrollRef.current?.scrollTo({ x: target, animated: true });
    }, []);

    return (
        <View style={[styles.wrapper, style]}>
            <ScrollView
                ref={scrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                onLayout={handleLayout}
                onContentSizeChange={handleContentSizeChange}
                contentContainerStyle={contentContainerStyle}
            >
                {children}
            </ScrollView>

            {affordances.canScrollLeft ? (
                <EdgeAffordance
                    side="left"
                    fadeColor={fadeColor}
                    chevronColor={chevronColor}
                    arrowBorderColor={arrowBorderColor}
                    onPress={() => step('left')}
                    accessibilityLabel={`Show previous ${arrowAccessibilityLabelPrefix}`}
                />
            ) : null}

            {affordances.canScrollRight ? (
                <EdgeAffordance
                    side="right"
                    fadeColor={fadeColor}
                    chevronColor={chevronColor}
                    arrowBorderColor={arrowBorderColor}
                    onPress={() => step('right')}
                    accessibilityLabel={`Show more ${arrowAccessibilityLabelPrefix}`}
                />
            ) : null}
        </View>
    );
}

function EdgeAffordance({
    side,
    fadeColor,
    chevronColor,
    arrowBorderColor,
    onPress,
    accessibilityLabel,
}: {
    side: 'left' | 'right';
    fadeColor: string;
    chevronColor: string;
    arrowBorderColor: string;
    onPress: () => void;
    accessibilityLabel: string;
}) {
    // Stacked translucent slices approximate a gradient without pulling in
    // expo-linear-gradient just for this row.
    const slices = [0.25, 0.55, 0.8, 1];

    return (
        <View
            pointerEvents="box-none"
            style={[styles.edge, side === 'left' ? styles.edgeLeft : styles.edgeRight]}
        >
            <View pointerEvents="none" style={styles.fadeStack}>
                {(side === 'left' ? slices : [...slices].reverse()).map((opacity, index) => (
                    <View
                        key={index}
                        style={{ backgroundColor: fadeColor, flex: 1, opacity }}
                    />
                ))}
            </View>

            <Pressable
                onPress={onPress}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                style={[styles.arrowButton, { backgroundColor: fadeColor, borderColor: arrowBorderColor }]}
            >
                <View
                    style={[
                        styles.chevron,
                        { borderColor: chevronColor },
                        side === 'left' ? styles.chevronLeft : styles.chevronRight,
                    ]}
                />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        position: 'relative',
    },
    edge: {
        alignItems: 'center',
        bottom: 0,
        flexDirection: 'row',
        position: 'absolute',
        top: 0,
        width: 44,
    },
    edgeLeft: {
        justifyContent: 'flex-start',
        left: 0,
    },
    edgeRight: {
        justifyContent: 'flex-end',
        right: 0,
    },
    fadeStack: {
        bottom: 0,
        flexDirection: 'row',
        left: 0,
        position: 'absolute',
        right: 0,
        top: 0,
    },
    arrowButton: {
        alignItems: 'center',
        borderRadius: 999,
        borderWidth: 1,
        height: 28,
        justifyContent: 'center',
        width: 28,
    },
    chevron: {
        borderRightWidth: 2,
        borderTopWidth: 2,
        height: 8,
        width: 8,
    },
    chevronLeft: {
        marginLeft: 3,
        transform: [{ rotate: '-135deg' }],
    },
    chevronRight: {
        marginRight: 3,
        transform: [{ rotate: '45deg' }],
    },
});
