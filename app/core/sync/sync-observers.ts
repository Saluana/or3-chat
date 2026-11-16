import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import type { InferHookParams } from '~/core/hooks/hook-types';

// Only observations: persistence, page receipts, capture and filters stay awaited.
type SyncObservationAction =
    | 'sync.bootstrap:action:start'
    | 'sync.bootstrap:action:progress'
    | 'sync.bootstrap:action:complete'
    | 'sync.bootstrap:action:error'
    | 'sync.rescan:action:starting'
    | 'sync.rescan:action:completed'
    | 'sync.pull:action:applied'
    | 'sync.conflict:action:detected'
    | 'sync.error:action'
    | 'sync.push:action:before'
    | 'sync.push:action:after'
    | 'sync.queue:action:full'
    | 'sync.retry:action'
    | 'sync.pull:action:received'
    | 'sync.pull:action:error'
    | 'sync.subscription:action:statusChange'
    | 'sync.subscription:action:maxRetriesExceeded';

const pending = new WeakMap<object, Map<SyncObservationAction, Promise<void>>>();
const OBSERVER_WAIT_MS = 250;

/**
 * Invoke all listeners in registry order/phase, but bound completion waiting. An unresolved
 * callback retains one slot per action/engine; only that callback's repeats
 * are coalesced away until it settles. Ready listeners receive every event.
 * No background queue or late listener invocation.
 */
export async function observeSyncAction<K extends SyncObservationAction>(
    hooks: Omit<TypedHookEngine, '_engine'> & { readonly _engine?: TypedHookEngine['_engine'] },
    name: K,
    ...args: InferHookParams<K>
): Promise<void> {
    const engine = hooks._engine;
    let dispatch: Promise<void>;
    if (engine) {
        // Invoke now, in this phase. The engine bounds each listener independently.
        dispatch = engine._dispatchActionObservers(name, args);
    } else {
        // Preserve the aggregate bound for engine-less dispatch adapters.
        const key = hooks.doAction;
        let actions = pending.get(key);
        if (!actions) { actions = new Map(); pending.set(key, actions); }
        if (actions.has(name)) return;
        let settle!: () => void;
        dispatch = new Promise<void>(resolve => { settle = resolve; });
        actions.set(name, dispatch);
        void dispatch.then(() => { actions.delete(name); });
        try {
            void Promise.resolve(hooks.doAction(name, ...args)).catch(() => {
                console.warn('[sync-observers] Observer failed:', name);
            }).then(settle);
        } catch {
            console.warn('[sync-observers] Observer failed:', name);
            settle();
        }
    }
    let timer!: ReturnType<typeof setTimeout>;
    try {
        await Promise.race([dispatch, new Promise<void>(resolve => {
            timer = setTimeout(() => {
                console.warn('[sync-observers] Observer wait expired:', name);
                resolve();
            }, OBSERVER_WAIT_MS);
        })]);
    } finally { clearTimeout(timer); }
}
