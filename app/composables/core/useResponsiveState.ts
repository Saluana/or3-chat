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

    // Delay initial update until after Vue hydration to prevent mismatch
    // Use nextTick + requestAnimationFrame to ensure DOM is fully hydrated
    if (typeof window !== 'undefined') {
        // Schedule update after current render cycle
        requestAnimationFrame(() => {
            updateBreakpoints();
            hydrated.value = true;
        });
    }

    return {
        isMobile,
        isTablet,
        hydrated,
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
