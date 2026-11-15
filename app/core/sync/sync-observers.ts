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

// Callback metadata in the existing registry, not a second listener registry.
const synchronous = Symbol.for('or3.sync-phase-observer');

/** Reviewed host-only synchronous phase/invalidation work must receive every event. */
export function synchronousSyncObserver<T extends (...args: never[]) => void>(callback: T): T {
    return Object.assign(callback, { [synchronous]: true });
}

const pending = new WeakMap<object, Map<SyncObservationAction, Promise<void>>>();
const OBSERVER_WAIT_MS = 250;

/**
 * Invoke all listeners in registry order/phase, but bound completion waiting. An unresolved
 * observer chain retains just one slot per action/engine; subsequent events
 * are coalesced away until it settles, except synchronous host phase work.
 * No background queue or late listener invocation.
 */
export async function observeSyncAction<K extends SyncObservationAction>(
    hooks: TypedHookEngine,
    name: K,
    ...args: InferHookParams<K>
): Promise<void> {
    const key = hooks._engine ?? hooks.doAction;
    let actions = pending.get(key);
    if (!actions) { actions = new Map(); pending.set(key, actions); }
    const engine = hooks._engine;
    if (actions.has(name)) {
        // Never delay start/complete suppression or post-commit invalidation.
        // Only the reviewed synchronous callbacks run again; no async backlog.
        await engine?._dispatchActionObservers(name, args, callback =>
            synchronous in callback);
        return;
    }

    let settle!: () => void;
    const dispatch = new Promise<void>(resolve => { settle = resolve; });
    actions.set(name, dispatch);
    void dispatch.then(() => { actions.delete(name); });
    try {
        // Invoke in this phase, before yielding: no delayed start callbacks can
        // run after complete or after a stop/workspace change.
        const completion = engine
            ? engine._dispatchActionObservers(name, args, () => true)
            : hooks.doAction(name, ...args);
        void Promise.resolve(completion).catch(() => {
            console.warn('[sync-observers] Observer failed:', name);
        }).then(settle);
    } catch {
        console.warn('[sync-observers] Observer failed:', name);
        settle();
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
