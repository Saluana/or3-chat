import { computed, watch, readonly, type Ref } from 'vue';
import { useScrollLock as useVueUseScrollLock } from '@vueuse/core';

type TargetResolver = () => HTMLElement | null | undefined;

interface UseScrollLockOptions {
    target?: TargetResolver;
    controlledState?: Ref<boolean>;
}

/**
 * `useScrollLock`
 *
 * Purpose:
 * Locks and unlocks scroll on a target element, defaulting to `document.body`.
 *
 * Behavior:
 * Wraps VueUse `useScrollLock` with an imperative API and optional controlled
 * state sync for UI components.
 *
 * Constraints:
 * - Client-only behavior, target must exist at lock time
 * - Controlled state is applied immediately
 *
 * Non-Goals:
 * - Does not restore scroll position
 * - Does not handle nested scroll containers automatically
 *
 * @example
 * ```ts
 * const { lock, unlock } = useScrollLock();
 * lock();
 * unlock();
 *
 * const isModalOpen = ref(false);
 * useScrollLock({ controlledState: isModalOpen });
 * ```
 *
 * @see https://vueuse.org/core/useScrollLock/
 */
export function useScrollLock(options: UseScrollLockOptions = {}) {
    // VueUse accepts a getter for the target, facilitating lazy resolution
    const element = computed(() => {
        if (typeof window === 'undefined') return null;
        if (options.target) {
            return options.target() ?? null;
        }
        return document.body;
    });

    const isLockedRef = useVueUseScrollLock(element);

    function lock() {
        isLockedRef.value = true;
    }

    function unlock() {
        isLockedRef.value = false;
    }

    if (options.controlledState) {
        watch(
            options.controlledState,
            (val) => {
                isLockedRef.value = val;
            },
            { immediate: true }
        );
    }

    return {
        lock,
        unlock,
        isLocked: readonly(isLockedRef),
    };
}

export type ScrollLockHandle = ReturnType<typeof useScrollLock>;
