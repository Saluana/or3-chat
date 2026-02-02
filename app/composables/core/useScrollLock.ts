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
 * Provides a composable for locking/unlocking scroll on a target element (default: document.body).
 * Wraps VueUse's useScrollLock with a more opinionated API and controlled state support.
 * 
 * Behavior:
 * - Lazily resolves target element via computed getter
 * - Exposes `lock()` and `unlock()` methods for imperative control
 * - Exposes `isLocked` as a readonly ref for reactive reads
 * - Supports controlled state via `controlledState` option (two-way sync)
 * 
 * Constraints:
 * - Only works in browser environment (returns null target on SSR)
 * - Target must be resolvable at time of lock/unlock
 * - Controlled state watches fire immediately (immediate: true)
 * 
 * Non-Goals:
 * - Does not provide scroll position restoration
 * - Does not handle nested scroll containers automatically
 * - Does not prevent touch-based scrolling (iOS Safari limitations)
 * 
 * @example
 * ```ts
 * // Basic usage
 * const { lock, unlock, isLocked } = useScrollLock();
 * 
 * // Lock scroll
 * lock();
 * console.log(isLocked.value); // true
 * 
 * // Unlock scroll
 * unlock();
 * 
 * // Custom target
 * const { lock } = useScrollLock({
 *   target: () => document.querySelector('.modal-container')
 * });
 * 
 * // Controlled state
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
