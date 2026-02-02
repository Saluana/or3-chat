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
 * Provides reactive breakpoint state (mobile/tablet/desktop) with SSR-safe defaults
 * and shared listeners across all components.
 * 
 * Behavior:
 * - Returns consistent shape on both SSR and client (isMobile, isTablet, isDesktop, hydrated)
 * - Uses matchMedia to track breakpoints: mobile (≤768px), desktop (≥1024px), tablet (between)
 * - Shares a single set of listeners across all consuming components
 * - Implements ref-counting when called within Vue effect scopes for automatic cleanup
 * - On SSR: assumes desktop (isDesktop=true, isMobile=false) to prevent hydration mismatches
 * - On client: updates after hydration and sets hydrated=true
 * 
 * Constraints:
 * - Breakpoints are hardcoded (768px mobile, 1024px desktop)
 * - Requires browser environment for actual detection (SSR returns default desktop state)
 * - Ref-counting cleanup only works when called within a Vue effect scope
 * - If called outside a Vue scope, listeners remain active (no cleanup)
 * 
 * Non-Goals:
 * - Does not support custom breakpoint values
 * - Does not provide orientation detection
 * - Does not handle print media or other media types
 * 
 * @example
 * ```ts
 * // In a component
 * const { isMobile, isTablet, isDesktop, hydrated } = useResponsiveState();
 * 
 * // Conditionally render based on breakpoint
 * <div v-if="isMobile">Mobile view</div>
 * <div v-else-if="isTablet">Tablet view</div>
 * <div v-else>Desktop view</div>
 * 
 * // Wait for hydration before measuring
 * watch(hydrated, (isHydrated) => {
 *   if (isHydrated) {
 *     // Safe to measure DOM dimensions
 *   }
 * });
 * ```
 * 
 * @see ~/state/global for the legacy globalIsMobile ref (synced for backward compatibility)
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

/**
 * Type export for external consumers.
 * @deprecated Use ResponsiveState interface directly
 */
export type { ResponsiveState };
