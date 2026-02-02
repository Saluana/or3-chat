import { ref, onScopeDispose, type Ref, getCurrentScope } from 'vue';
import { isMobile as globalIsMobile } from '~/state/global';

/**
 * Explicit interface for responsive state return value.
 * Ensures consistent shape across SSR and client.
 */
export interface ResponsiveState {
    isMobile: Ref<boolean>;
    isTablet: Ref<boolean>;
    isDesktop: Ref<boolean>;
    hydrated: Ref<boolean>;
}

/**
 * Shared state and listener management for reference counting.
 */
interface ResponsiveStateRegistry {
    state: ResponsiveState | null;
    mobileQuery: MediaQueryList | null;
    desktopQuery: MediaQueryList | null;
    updateBreakpoints: (() => void) | null;
    consumerCount: number;
}

// Cache the shared state so all consumers get the same reactive refs.
// This allows PageShell and other components to share a single breakpoint listener.
let registry: ResponsiveStateRegistry = {
    state: null,
    mobileQuery: null,
    desktopQuery: null,
    updateBreakpoints: null,
    consumerCount: 0,
};

/**
 * Creates the responsive state with a simple matchMedia listener and syncs to global isMobile.
 * Only called once per app; result is cached and reused.
 */
function createResponsiveState(): ResponsiveState {
    // Simple reactive ref for mobile state - starts false to match SSR
    const isMobile = ref(false);
    const isTablet = ref(false);
    const isDesktop = ref(false);
    const hydrated = ref(false);

    // Set up matchMedia listeners for different breakpoints
    const mobileQuery = window.matchMedia('(max-width: 768px)');
    const desktopQuery = window.matchMedia('(min-width: 1024px)');

    const updateBreakpoints = () => {
        const mobile = mobileQuery.matches;
        const desktop = desktopQuery.matches;

        isMobile.value = mobile;
        isDesktop.value = desktop;
        isTablet.value = !mobile && !desktop;

        // Sync to global ref for backward compatibility
        globalIsMobile.value = mobile;
    };

    // Listen for changes
    mobileQuery.addEventListener('change', updateBreakpoints);
    desktopQuery.addEventListener('change', updateBreakpoints);

    // Store in registry for cleanup
    registry.mobileQuery = mobileQuery;
    registry.desktopQuery = desktopQuery;
    registry.updateBreakpoints = updateBreakpoints;

    // Delay initial update until after Vue hydration to prevent mismatch
    // Use nextTick + requestAnimationFrame to ensure DOM is fully hydrated
    if (typeof window !== 'undefined') {
        // Schedule update after current render cycle
        requestAnimationFrame(() => {
            updateBreakpoints();
            hydrated.value = true;
        });
    }

    // HMR cleanup: remove listeners on module disposal
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            cleanupListeners();
        });
    }

    return {
        isMobile,
        isTablet,
        isDesktop,
        hydrated,
    };
}

/**
 * Cleanup media query listeners.
 */
function cleanupListeners(): void {
    if (registry.mobileQuery && registry.desktopQuery && registry.updateBreakpoints) {
        registry.mobileQuery.removeEventListener('change', registry.updateBreakpoints);
        registry.desktopQuery.removeEventListener('change', registry.updateBreakpoints);
    }
    registry.mobileQuery = null;
    registry.desktopQuery = null;
    registry.updateBreakpoints = null;
    registry.state = null;
    registry.consumerCount = 0;
}

/**
 * `useResponsiveState`
 *
 * Purpose:
 * Provides reactive breakpoint state with SSR-safe defaults.
 *
 * Behavior:
 * Uses shared `matchMedia` listeners, ref-counted cleanup, and syncs to the
 * legacy `globalIsMobile` ref for backward compatibility.
 *
 * Constraints:
 * - Breakpoints are fixed at 768px and 1024px
 * - Requires browser APIs for live updates
 *
 * Non-Goals:
 * - Does not support custom breakpoint configuration
 * - Does not detect orientation or print media
 *
 * @example
 * ```ts
 * const { isMobile, hydrated } = useResponsiveState();
 * watch(hydrated, (ready) => {
 *   if (ready && isMobile.value) {
 *     // Measure mobile layout
 *   }
 * });
 * ```
 *
 * @see ~/state/global for the legacy `globalIsMobile` ref
 */
export function useResponsiveState(): ResponsiveState {
    // During SSR, assume desktop (not mobile) to match what we conditionally render
    // This prevents hydration mismatches
    if (typeof window === 'undefined') {
        return {
            isMobile: ref(false),
            isTablet: ref(false),
            isDesktop: ref(true),  // Desktop assumed on SSR
            hydrated: ref(false),  // Never hydrated on server
        };
    }

    // Lazy-initialize shared state on first client-side call
    if (!registry.state) {
        registry.state = createResponsiveState();
    }

    // Increment consumer count
    registry.consumerCount++;

    // Add ref-counted cleanup if called within a Vue scope
    const scope = getCurrentScope();
    if (scope) {
        onScopeDispose(() => {
            registry.consumerCount--;
            // When last consumer disposes, clean up listeners
            if (registry.consumerCount === 0) {
                cleanupListeners();
            }
        });
    }

    return registry.state;
}
