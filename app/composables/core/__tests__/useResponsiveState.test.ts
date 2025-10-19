import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useResponsiveState } from '../useResponsiveState';

// We need to access and reset the internal cache between tests
// This is a bit of a hack, but necessary since we cache the shared state globally
let clearSharedState: (() => void) | null = null;

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
    beforeEach(async () => {
        mockViewport(1024);
        // Reset the composable cache before each test by reloading the module
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Helper to wait for requestAnimationFrame
    const waitForFrame = () =>
        new Promise((resolve) => requestAnimationFrame(resolve));

    it('returns isMobile = false when viewport > 768px', async () => {
        mockViewport(1024);

        const { useResponsiveState: useResponsiveState1 } = await import(
            '../useResponsiveState'
        );
        const { isMobile } = useResponsiveState1();

        // Wait for requestAnimationFrame to update the value
        await waitForFrame();

        expect(isMobile.value).toBe(false);
    });

    it('returns isMobile = true when viewport ≤ 768px', async () => {
        mockViewport(768);

        const { useResponsiveState: useResponsiveState2 } = await import(
            '../useResponsiveState'
        );
        const { isMobile } = useResponsiveState2();

        // Wait for requestAnimationFrame to update the value
        await waitForFrame();

        expect(isMobile.value).toBe(true);
    });

    it('returns isMobile = true when viewport < 768px (small mobile)', async () => {
        mockViewport(375);

        const { useResponsiveState: useResponsiveState3 } = await import(
            '../useResponsiveState'
        );
        const { isMobile } = useResponsiveState3();

        // Wait for requestAnimationFrame to update the value
        await waitForFrame();

        expect(isMobile.value).toBe(true);
    });

    it('keeps isMobile = false when viewport exceeds 768px threshold', async () => {
        mockViewport(769);

        const { useResponsiveState: useResponsiveState4 } = await import(
            '../useResponsiveState'
        );
        const { isMobile } = useResponsiveState4();

        // Wait for requestAnimationFrame to update the value
        await waitForFrame();

        expect(isMobile.value).toBe(false);
    });
});
