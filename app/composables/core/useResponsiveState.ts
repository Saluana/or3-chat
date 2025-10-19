import { computed, ref } from 'vue';
import { isMobile as globalIsMobile } from '~/state/global';

// Cache the shared state so all consumers get the same reactive refs.
// This allows PageShell and other components to share a single breakpoint listener.
let sharedState: ReturnType<typeof createResponsiveState> | null = null;

/**
 * Creates the responsive state with a simple matchMedia listener and syncs to global isMobile.
 * Only called once per app; result is cached and reused.
 */
function createResponsiveState() {
    // Simple reactive ref for mobile state
    const isMobile = ref(false);
    const isTablet = ref(false);
    const isDesktop = ref(false);

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

        console.log('[useResponsiveState] breakpoint update:', {
            isMobile: mobile,
            isTablet: !mobile && !desktop,
            isDesktop: desktop,
            width: window.innerWidth,
        });
    };

    // Initial update
    updateBreakpoints();

    // Listen for changes
    mobileQuery.addEventListener('change', updateBreakpoints);
    desktopQuery.addEventListener('change', updateBreakpoints);

    return {
        isMobile,
        isTablet,
    };
}

/**
 * Centralised responsive state helper to keep mobile/desktop logic consistent.
 * - Mobile: viewport width ≤ 768px
 * - Tablet: 769px – 1023px (reserved for future refinements)
 *
 * SSR-safe: assumes desktop during SSR to prevent hydration mismatches.
 * The client will update to the correct state after hydration.
 *
 * Multiple calls return the same cached refs, ensuring all components stay in sync.
 */
export function useResponsiveState() {
    // During SSR, assume desktop (not mobile) to match what we conditionally render
    // This prevents hydration mismatches
    if (typeof window === 'undefined') {
        return {
            isMobile: ref(false),
            isTablet: ref(false),
        };
    }

    // Lazy-initialize shared state on first client-side call
    if (!sharedState) {
        sharedState = createResponsiveState();
    }

    return sharedState;
}

export type ResponsiveState = ReturnType<typeof useResponsiveState>;
