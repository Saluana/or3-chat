import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useResponsiveState } from '../useResponsiveState';

function mockViewport(width: number) {
    Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: width,
    });

    window.matchMedia = vi.fn().mockImplementation((query: string) => {
        const minMatch = query.match(/\(min-width:\s*(\d+)px\)/);
        const maxMatch = query.match(/\(max-width:\s*(\d+)px\)/);

        let matches = true;

        if (minMatch) {
            matches = matches && width >= Number(minMatch[1]);
        }

        if (maxMatch) {
            matches = matches && width <= Number(maxMatch[1]);
        }

        return {
            matches,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        };
    });

    window.dispatchEvent(new Event('resize'));
}

describe('useResponsiveState', () => {
    beforeEach(() => {
        mockViewport(1024);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns isMobile = false when viewport > 768px', () => {
        mockViewport(1024);

        const { isMobile } = useResponsiveState();
        expect(isMobile.value).toBe(false);
    });

    it('returns isMobile = true when viewport ≤ 768px', () => {
        mockViewport(768);

        const { isMobile } = useResponsiveState();
        expect(isMobile.value).toBe(true);
    });

    it('returns isMobile = true when viewport < 768px (small mobile)', () => {
        mockViewport(375);

        const { isMobile } = useResponsiveState();
        expect(isMobile.value).toBe(true);
    });

    it('keeps isMobile = false when viewport exceeds 768px threshold', () => {
        mockViewport(769);

        const { isMobile } = useResponsiveState();
        expect(isMobile.value).toBe(false);
    });
});
