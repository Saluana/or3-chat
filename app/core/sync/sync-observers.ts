import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import type { InferHookParams } from '~/core/hooks/hook-types';

// Only independent observations. Phase/suppression/invalidation hooks must not
// use this whole-chain bound: a late callback can still have side effects.
type IndependentSyncAction =
    | 'sync.push:action:before'
    | 'sync.push:action:after'
    | 'sync.queue:action:full'
    | 'sync.retry:action'
    | 'sync.pull:action:received'
    | 'sync.pull:action:error'
    | 'sync.subscription:action:statusChange'
    | 'sync.subscription:action:maxRetriesExceeded';

const pending = new WeakMap<object, Map<IndependentSyncAction, Promise<void>>>();
const OBSERVER_WAIT_MS = 250;

/**
 * Preserve dispatch order/phase, but bound protocol waiting. An unresolved
 * observer chain retains just one slot per action/engine; subsequent events
 * are coalesced away until it settles. No background queue or late redispatch.
 */
export async function observeSyncAction<K extends IndependentSyncAction>(
    hooks: TypedHookEngine,
    name: K,
    ...args: InferHookParams<K>
): Promise<void> {
    const key = hooks._engine ?? hooks.doAction;
    let actions = pending.get(key);
    if (!actions) { actions = new Map(); pending.set(key, actions); }
    if (actions.has(name)) return;

    const dispatch = Promise.resolve().then(() => hooks.doAction(name, ...args))
        .catch(() => { console.warn('[sync-observers] Observer failed:', name); });
    actions.set(name, dispatch);
    void dispatch.then(() => { actions.delete(name); });
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
