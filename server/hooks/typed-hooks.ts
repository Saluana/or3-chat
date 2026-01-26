import type { HookEngine, HookKind, OnOptions } from './hook-engine';
import type {
    AdminActionHookName,
    AdminHookKey,
    InferAdminHookCallback,
    InferAdminHookParams,
    InferAdminHookReturn,
} from './admin-hook-types';

type Tail<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : [];

export interface TypedAdminHookEngine {
    addAction<K extends AdminActionHookName>(
        name: K,
        callback: InferAdminHookCallback<K>,
        priority?: number
    ): void;

    removeAction<K extends AdminActionHookName>(
        name: K,
        callback: InferAdminHookCallback<K>,
        priority?: number
    ): void;

    doAction<K extends AdminActionHookName>(
        name: K,
        ...args: InferAdminHookParams<K>
    ): Promise<void>;

    doActionSync<K extends AdminActionHookName>(
        name: K,
        ...args: InferAdminHookParams<K>
    ): void;

    on<K extends AdminHookKey>(
        name: K,
        callback: InferAdminHookCallback<K>,
        opts?: OnOptions & { kind?: K extends AdminActionHookName ? 'action' : HookKind }
    ): () => void;

    off(disposer: () => void): void;

    onceAction<K extends AdminActionHookName>(
        name: K,
        callback: InferAdminHookCallback<K>,
        priority?: number
    ): () => void;

    readonly _engine: HookEngine;
    readonly _diagnostics: HookEngine['_diagnostics'];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function createTypedAdminHookEngine(
    engine: HookEngine
): TypedAdminHookEngine {
    return {
        addAction: (name, callback, priority) =>
            engine.addAction(name as any, callback as any, priority),
        removeAction: (name, callback, priority) =>
            engine.removeAction(name as any, callback as any, priority),
        doAction: (name, ...args) =>
            engine.doAction(name as any, ...(args as any)),
        doActionSync: (name, ...args) =>
            engine.doActionSync(name as any, ...(args as any)),
        on: (name, callback, opts) => {
            const kind = (opts?.kind ??
                (name.includes(':filter:') ? 'filter' : 'action')) as HookKind;
            const merged = { ...opts, kind } as OnOptions;
            return engine.on(name as any, callback as any, merged);
        },
        off: (disposer) => engine.off(disposer),
        onceAction: (name, callback, priority) =>
            engine.onceAction(name as any, callback as any, priority),
        _engine: engine,
        _diagnostics: engine._diagnostics,
    };
}
