import { computed, watch, type Ref } from 'vue';
import { useScrollLock as useVueUseScrollLock } from '@vueuse/core';

type TargetResolver = () => HTMLElement | null | undefined;

interface UseScrollLockOptions {
    target?: TargetResolver;
    controlledState?: Ref<boolean>;
}

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
        isLocked: computed(() => isLockedRef.value),
    };
}

export type ScrollLockHandle = ReturnType<typeof useScrollLock>;
