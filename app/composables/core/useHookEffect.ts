import { onBeforeUnmount } from 'vue';
import { useHooks } from '../../core/hooks/useHooks';
import type { HookKind } from '../../core/hooks/hooks';
import type {
    HookName,
    ActionHookName,
    FilterHookName,
    InferHookCallback,
} from '../../core/hooks/hook-types';

interface Options<K extends HookName = HookName> {
    kind?:
        | HookKind
        | (K extends ActionHookName
              ? 'action'
              : K extends FilterHookName
              ? 'filter'
              : HookKind);
    priority?: number;
}

/**
 * Register a callback to a hook name and clean up on unmount and HMR.
 * Typed by hook name for great DX. Returns a disposer you can call manually.
 */
export function useHookEffect<K extends HookName>(
    name: K,
    fn: InferHookCallback<K>,
    opts?: Options<K>
) {
    const hooks = useHooks();
    const disposer = hooks.on(name, fn as any, opts as any);

    // Component lifecycle cleanup
    onBeforeUnmount(() => hooks.off(disposer));

    // HMR cleanup for the importing module
    if (import.meta.hot) {
        import.meta.hot.dispose(() => hooks.off(disposer));
    }

    return disposer;
}
