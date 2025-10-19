import { useBreakpoints } from '@vueuse/core';
import { computed } from 'vue';

/**
 * Centralised responsive state helper to keep mobile/desktop logic consistent.
 * - Mobile: viewport width ≤ 768px
 * - Tablet: 769px – 1023px (reserved for future refinements)
 */
export function useResponsiveState() {
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
