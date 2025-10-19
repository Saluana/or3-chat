import { watch, ref, Ref, onBeforeUnmount } from 'vue';

/**
 * Composable for locking/unlocking body scroll.
 * Useful for overlays, modals, and other fixed-position elements.
 *
 * @param isLocked - Ref<boolean> that controls lock state
 * @param target - Optional DOM element to lock (default: document.body)
 * @returns {ScrollLockHandle} Object with manual lock/unlock methods
 */
export function useScrollLock(isLocked?: Ref<boolean>, target?: HTMLElement) {
  if (!import.meta.client) {
    return {
      lock: () => {},
      unlock: () => {},
    };
  }

  const lockedElement = target || (typeof document !== 'undefined' ? document.body : null);
  const previousOverflow = ref<string | null>(null);

  function lock() {
    if (!lockedElement) return;
    previousOverflow.value = lockedElement.style.overflow;
    lockedElement.style.overflow = 'hidden';
  }

  function unlock() {
    if (!lockedElement) return;
    if (previousOverflow.value !== null) {
      lockedElement.style.overflow = previousOverflow.value;
    } else {
      lockedElement.style.overflow = '';
    }
    previousOverflow.value = null;
  }

  // If isLocked ref is provided, watch it and auto-lock/unlock
  if (isLocked) {
    watch(
      isLocked,
      (locked) => {
        if (locked) {
          lock();
        } else {
          unlock();
        }
      },
      { immediate: true }
    );
  }

  // Cleanup on unmount
  onBeforeUnmount(() => {
    unlock();
  });

  return {
    lock,
    unlock,
  };
}

export type ScrollLockHandle = ReturnType<typeof useScrollLock>;
