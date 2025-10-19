import { useBreakpoints } from '@vueuse/core';
import { computed, ref } from 'vue';

/**
 * Centralised responsive state helper to keep mobile/desktop logic consistent.
 * - Mobile: viewport width ≤ 768px
 * - Tablet: 769px – 1023px (reserved for future refinements)
 *
 * SSR-safe: assumes desktop during SSR to prevent hydration mismatches.
 * The client will update to the correct state after hydration.
 */
export function useResponsiveState() {
    // During SSR, assume desktop (not mobile) to match what we conditionally render
    // This prevents hydration mismatches
    if (!import.meta.client) {
        return {
            isMobile: ref(false),
            isTablet: ref(false),
        };
    }

    const breakpoints = useBreakpoints({
        mobile: 0,
        tablet: 768,
        desktop: 1024,
    });

    const isMobile = breakpoints.smallerOrEqual('tablet');
    const isDesktop = breakpoints.greaterOrEqual('desktop');
    const isTablet = computed(() => !isMobile.value && !isDesktop.value);

    return {
        isMobile,
        isTablet,
    };
}

export type ResponsiveState = ReturnType<typeof useResponsiveState>;
