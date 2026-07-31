import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useResponsiveState, type ResponsiveState } from '../useResponsiveState';
import { effectScope } from 'vue';

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

    it('returns complete ResponsiveState interface with all fields', async () => {
        mockViewport(1024);

        const { useResponsiveState: useResponsiveState5 } = await import(
            '../useResponsiveState'
        );
        const state = useResponsiveState5();

        // Check that all required fields are present
        expect(state).toHaveProperty('isMobile');
        expect(state).toHaveProperty('isTablet');
        expect(state).toHaveProperty('isDesktop');
        expect(state).toHaveProperty('hydrated');

        // Check they are refs
        expect(state.isMobile.value).toBeDefined();
        expect(state.isTablet.value).toBeDefined();
        expect(state.isDesktop.value).toBeDefined();
        expect(state.hydrated.value).toBeDefined();
    });

    it('returns isDesktop = true for desktop viewport', async () => {
        mockViewport(1200);

        const { useResponsiveState: useResponsiveState6 } = await import(
            '../useResponsiveState'
        );
        const { isDesktop, isMobile } = useResponsiveState6();

        await waitForFrame();

        expect(isDesktop.value).toBe(true);
        expect(isMobile.value).toBe(false);
    });

    it('returns isTablet = true for tablet viewport', async () => {
        mockViewport(900);

        const { useResponsiveState: useResponsiveState7 } = await import(
            '../useResponsiveState'
        );
        const { isTablet, isMobile, isDesktop } = useResponsiveState7();

        await waitForFrame();

        expect(isTablet.value).toBe(true);
        expect(isMobile.value).toBe(false);
        expect(isDesktop.value).toBe(false);
    });

    it('sets hydrated to true after initial update', async () => {
        mockViewport(1024);

        const { useResponsiveState: useResponsiveState8 } = await import(
            '../useResponsiveState'
        );
        const { hydrated } = useResponsiveState8();

        // Should start false
        expect(hydrated.value).toBe(false);

        // Wait for requestAnimationFrame to update
        await waitForFrame();

        // Should now be true
        expect(hydrated.value).toBe(true);
    });

    it('reuses the same state instance for multiple calls', async () => {
        mockViewport(1024);

        const { useResponsiveState: useResponsiveState9 } = await import(
            '../useResponsiveState'
        );
        const state1 = useResponsiveState9();
        const state2 = useResponsiveState9();

        // Should be the exact same refs
        expect(state1.isMobile).toBe(state2.isMobile);
        expect(state1.isTablet).toBe(state2.isTablet);
        expect(state1.isDesktop).toBe(state2.isDesktop);
        expect(state1.hydrated).toBe(state2.hydrated);
    });

    it('cleans up listeners when all scopes dispose', async () => {
        mockViewport(1024);

        const { useResponsiveState: useResponsiveState10 } = await import(
            '../useResponsiveState'
        );
        
        const removeEventListenerSpy = vi.fn();
        window.matchMedia = vi.fn().mockReturnValue({
            matches: true,
            media: '',
            addEventListener: vi.fn(),
            removeEventListener: removeEventListenerSpy,
        });

        // Create two scopes
        const scope1 = effectScope();
        const scope2 = effectScope();

        let state1: ResponsiveState;
        let state2: ResponsiveState;

        scope1.run(() => {
            state1 = useResponsiveState10();
        });

        scope2.run(() => {
            state2 = useResponsiveState10();
        });

        // Dispose first scope - listeners should remain (count = 1)
        scope1.stop();
        expect(removeEventListenerSpy).not.toHaveBeenCalled();

        // Dispose second scope - listeners should be cleaned up (count = 0)
        scope2.stop();
        
        // Wait a tick for cleanup
        await new Promise(resolve => setTimeout(resolve, 0));
        
        // Listeners should have been removed (2 calls: mobile and desktop queries)
        expect(removeEventListenerSpy).toHaveBeenCalledTimes(2);
    });
});
