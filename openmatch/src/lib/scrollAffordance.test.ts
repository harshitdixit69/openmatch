import { getScrollAffordances, getScrollStepOffset } from './scrollAffordance';

describe('getScrollAffordances', () => {
    it('shows nothing before layout has been measured', () => {
        expect(getScrollAffordances({ offsetX: 0, viewportWidth: 0, contentWidth: 0 })).toEqual({
            canScrollLeft: false,
            canScrollRight: false,
        });
    });

    it('shows nothing when the content fits the viewport', () => {
        expect(getScrollAffordances({ offsetX: 0, viewportWidth: 400, contentWidth: 320 })).toEqual({
            canScrollLeft: false,
            canScrollRight: false,
        });
    });

    it('ignores a sub-threshold overflow', () => {
        expect(getScrollAffordances({ offsetX: 0, viewportWidth: 400, contentWidth: 402 })).toEqual({
            canScrollLeft: false,
            canScrollRight: false,
        });
    });

    it('shows only the right arrow at the start of an overflowing row', () => {
        expect(getScrollAffordances({ offsetX: 0, viewportWidth: 300, contentWidth: 600 })).toEqual({
            canScrollLeft: false,
            canScrollRight: true,
        });
    });

    it('shows both arrows mid-scroll', () => {
        expect(getScrollAffordances({ offsetX: 150, viewportWidth: 300, contentWidth: 600 })).toEqual({
            canScrollLeft: true,
            canScrollRight: true,
        });
    });

    it('shows only the left arrow at the end of the row', () => {
        expect(getScrollAffordances({ offsetX: 300, viewportWidth: 300, contentWidth: 600 })).toEqual({
            canScrollLeft: true,
            canScrollRight: false,
        });
    });

    it('treats negative overscroll as being at the start', () => {
        expect(getScrollAffordances({ offsetX: -20, viewportWidth: 300, contentWidth: 600 })).toEqual({
            canScrollLeft: false,
            canScrollRight: true,
        });
    });
});

describe('getScrollStepOffset', () => {
    const metrics = { offsetX: 0, viewportWidth: 300, contentWidth: 600 };

    it('advances by three quarters of a viewport', () => {
        expect(getScrollStepOffset(metrics, 'right')).toBe(225);
    });

    it('clamps to the end of the content', () => {
        expect(getScrollStepOffset({ ...metrics, offsetX: 250 }, 'right')).toBe(300);
    });

    it('clamps to zero when scrolling left from the start', () => {
        expect(getScrollStepOffset({ ...metrics, offsetX: 100 }, 'left')).toBe(0);
    });

    it('steps back from the end', () => {
        expect(getScrollStepOffset({ ...metrics, offsetX: 300 }, 'left')).toBe(75);
    });

    it('returns zero when nothing has been measured', () => {
        expect(getScrollStepOffset({ offsetX: 0, viewportWidth: 0, contentWidth: 0 }, 'right')).toBe(0);
    });
});
