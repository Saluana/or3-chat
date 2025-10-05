/**
 * useObservedElementSize
 * Thin wrapper over VueUse useElementSize for naming consistency.
 * Requirement: 3.4 (Resize via VueUse), 3.11 (VueUse adoption), 4 (Docs)
 */
import { useElementSize } from '@vueuse/core';
import type { Ref } from 'vue';

export function useObservedElementSize(el: Ref<HTMLElement | null>) {
    return useElementSize(el);
}
