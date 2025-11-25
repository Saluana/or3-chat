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
 * Register a callback to a hook name and clean up on unmount and HMR.
 * Typed by hook name for great DX. Returns a disposer you can call manually.
 */
export function useHookEffect<K extends HookName>(
    name: K,
    fn: InferHookCallback<K>,
    opts?: Options
) {
    const hooks = useHooks();
    // The type system doesn't quite align hooks.on's overloaded signatures with our generic,
    // but the runtime is correct. Suppress type errors for this well-tested call.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    const disposer = hooks.on(name, fn as any, opts as any);

    // Component lifecycle cleanup
    onBeforeUnmount(() => hooks.off(disposer));

    // HMR cleanup for the importing module
    if (import.meta.hot) {
        import.meta.hot.dispose(() => hooks.off(disposer));
    }

    return disposer;
}
