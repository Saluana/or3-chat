import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';

type TargetResolver = () => HTMLElement | null | undefined;

interface UseScrollLockOptions {
    target?: TargetResolver;
    controlledState?: Ref<boolean>;
}

export function useScrollLock(options: UseScrollLockOptions = {}) {
    const internalLocked = ref(false);
    let previousOverflow: string | null = null;
    let lockedElement: HTMLElement | null = null;

    function resolveTarget(): HTMLElement | null {
        if (typeof window === 'undefined') return null;
        if (options.target) {
            return options.target() ?? null;
        }
        return document.body;
    }

    function performLock() {
        if (internalLocked.value) return;
        const target = resolveTarget();
        if (!target) return;

        lockedElement = target;
        previousOverflow = target.style.overflow || '';
        target.style.overflow = 'hidden';
        internalLocked.value = true;
    }

    function performUnlock() {
        if (!internalLocked.value) return;
        const target = lockedElement ?? resolveTarget();
        if (target) {
            target.style.overflow = previousOverflow ?? '';
        }
        lockedElement = null;
        previousOverflow = null;
        internalLocked.value = false;
    }

    function lock() {
        performLock();
    }

    function unlock() {
        performUnlock();
    }

    if (options.controlledState) {
        watch(
            options.controlledState,
            (next) => {
                if (next) {
                    performLock();
                } else {
                    performUnlock();
                }
            },
            { immediate: true }
        );
    }

    onBeforeUnmount(() => {
        performUnlock();
    });

    return {
        lock,
        unlock,
        isLocked: computed(() => internalLocked.value),
    };
}

export type ScrollLockHandle = ReturnType<typeof useScrollLock>;
