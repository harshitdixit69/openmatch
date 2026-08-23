/**
 * Pure helpers for deciding when a horizontally scrollable row should show
 * "there is more content this way" affordances.
 *
 * Kept out of the screen component so the edge-case logic (tiny overflows,
 * fractional layout widths, bounce/overscroll) is testable without rendering
 * a full screen.
 */

export type ScrollMetrics = {
    /** Current horizontal scroll offset. */
    offsetX: number;
    /** Width of the visible viewport. */
    viewportWidth: number;
    /** Total width of the scrollable content. */
    contentWidth: number;
};

export type ScrollAffordances = {
    canScrollLeft: boolean;
    canScrollRight: boolean;
};

/**
 * Ignore sub-pixel and rounding noise, plus a couple of px of slack so a row
 * that overflows by a hair doesn't flash an arrow the user can't meaningfully use.
 */
const EDGE_THRESHOLD = 4;

export function getScrollAffordances({
    offsetX,
    viewportWidth,
    contentWidth,
}: ScrollMetrics): ScrollAffordances {
    // Nothing measured yet, or content fits entirely: no affordances.
    if (viewportWidth <= 0 || contentWidth <= 0) {
        return { canScrollLeft: false, canScrollRight: false };
    }

    const maxOffset = contentWidth - viewportWidth;
    if (maxOffset <= EDGE_THRESHOLD) {
        return { canScrollLeft: false, canScrollRight: false };
    }

    return {
        // Clamp against negative offsets from iOS bounce/overscroll.
        canScrollLeft: offsetX > EDGE_THRESHOLD,
        canScrollRight: offsetX < maxOffset - EDGE_THRESHOLD,
    };
}

/**
 * Target offset for one "page" of scrolling when an arrow is tapped.
 * Advances by ~75% of a viewport so at least one chip stays visible as an
 * anchor, and clamps to the content bounds.
 */
export function getScrollStepOffset(
    { offsetX, viewportWidth, contentWidth }: ScrollMetrics,
    direction: 'left' | 'right'
): number {
    if (viewportWidth <= 0 || contentWidth <= 0) return 0;

    const maxOffset = Math.max(0, contentWidth - viewportWidth);
    const step = viewportWidth * 0.75;
    const target = direction === 'right' ? offsetX + step : offsetX - step;

    return Math.min(Math.max(target, 0), maxOffset);
}
