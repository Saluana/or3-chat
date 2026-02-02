import { onBeforeUnmount } from 'vue';
import { useHooks } from '../../core/hooks/useHooks';
import type { HookKind } from '../../core/hooks/hooks';
import type {
    HookName,
    InferHookCallback,
} from '../../core/hooks/hook-types';

interface Options {
    kind?: HookKind;
    priority?: number;
}

/**
 * `useHookEffect`
 *
 * Purpose:
 * Provides lifecycle-safe hook subscriptions for Vue components.
 *
 * Behavior:
 * Registers a hook callback and removes it on component unmount and HMR dispose.
 * Returns a disposer so callers can opt out earlier.
 *
 * Constraints:
 * - Must be called during component setup
 * - Intended for actions and filters already defined in the hook map
 *
 * Non-Goals:
 * - Does not deduplicate callbacks
 * - Does not validate hook names at runtime
 *
 * @example
 * ```ts
 * useHookEffect('ui.pane.close:action:after', ({ pane }) => {
 *   console.info('Pane closed', pane.id);
 * });
 * ```
 *
 * @see useHooks for direct hook engine access
 */
export function useHookEffect<K extends HookName>(
    name: K,
    fn: InferHookCallback<K>,
    opts?: Options
) {
    const hooks = useHooks();
    // The type system doesn't quite align hooks.on's overloaded signatures with our generic,
    // but the runtime is correct. Suppress type errors for this well-tested call.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const disposer = hooks.on(name, fn as any, opts as any);

    // Component lifecycle cleanup
    onBeforeUnmount(() => hooks.off(disposer));

    // HMR cleanup for the importing module
    if (import.meta.hot) {
        import.meta.hot.dispose(() => hooks.off(disposer));
    }

    return disposer;
}
