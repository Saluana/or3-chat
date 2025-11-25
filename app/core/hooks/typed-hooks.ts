// Typed Hook Engine wrapper — Types-first, zero runtime overhead.
// Delegates to the existing HookEngine, preserving all behavior.

import type { HookEngine, HookKind, OnOptions } from '~/core/hooks/hooks';
import type {
    ActionHookName,
    FilterHookName,
    HookName,
    InferHookCallback,
    InferHookParams,
    InferHookReturn,
} from '~/core/hooks/hook-types';

// Utility: Tail of a tuple
type Tail<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : [];

/**
 * Typed wrapper around HookEngine providing full type inference for
 * actions, filters, and unified on/off ergonomics. Purely types-level.
 */
export interface TypedHookEngine {
    // Actions (registration)
    /**
     * Register an action callback for a known hook name.
     * await hooks.doAction('ui.pane.blur:action', {
     *   pane,
     *   index: 0,
     * });
     * @example
     * hooks.addAction('ai.chat.send:action:before', (ctx) => {
     *   console.log(ctx.modelId);
     * });
     */
    addAction<K extends ActionHookName>(
        name: K,
        callback: InferHookCallback<K>,
        priority?: number
    ): void;

    removeAction<K extends ActionHookName>(
        name: K,
        callback: InferHookCallback<K>,
        priority?: number
    ): void;

    // Actions (execution)
    /**
     * Execute an action asynchronously.
     * @example
     * await hooks.doAction('ui.pane.blur:action', {
     *   pane,
     *   index: 0,
     * });
     */
    doAction<K extends ActionHookName>(
        name: K,
        ...args: InferHookParams<K>
    ): Promise<void>;

    doActionSync<K extends ActionHookName>(
        name: K,
        ...args: InferHookParams<K>
    ): void;

    // Filters (registration)
    /**
     * Register a filter callback. Must return the value type.
     * @example
     * hooks.addFilter('ui.chat.message:filter:outgoing', (value) => value.trim());
     */
    addFilter<K extends FilterHookName>(
        name: K,
        callback: InferHookCallback<K>,
        priority?: number
    ): void;

    removeFilter<K extends FilterHookName>(
        name: K,
        callback: InferHookCallback<K>,
        priority?: number
    ): void;

    // Filters (execution)
    /**
     * Apply filters asynchronously to a value.
     * @example
     * const text = await hooks.applyFilters('ui.chat.message:filter:outgoing', input);
     */
    applyFilters<K extends FilterHookName>(
        name: K,
        value: InferHookParams<K>[0],
        ...args: Tail<InferHookParams<K>>
    ): Promise<InferHookReturn<K>>;

    applyFiltersSync<K extends FilterHookName>(
        name: K,
        value: InferHookParams<K>[0],
        ...args: Tail<InferHookParams<K>>
    ): InferHookReturn<K>;

    // Unified API (typed by hook name)
    /**
     * Register either an action or a filter based on the hook name.
     * @example
     * const off = hooks.on('files.attach:filter:input', (payload) => payload, { kind: 'filter' });
     */
    on<K extends HookName>(
        name: K,
        callback: InferHookCallback<K>,
        opts?: OnOptions & {
            // infer sensible default kind when provided
            kind?: K extends ActionHookName
                ? 'action'
                : K extends FilterHookName
                ? 'filter'
                : 'action' | 'filter';
        }
    ): () => void;

    off(disposer: () => void): void;

    onceAction<K extends ActionHookName>(
        name: K,
        callback: InferHookCallback<K>,
        priority?: number
    ): () => void;

    // Diagnostics + passthrough
    hasAction<K extends ActionHookName>(
        name?: K,
        fn?: InferHookCallback<K>
    ): boolean | number;
    hasFilter<K extends FilterHookName>(
        name?: K,
        fn?: InferHookCallback<K>
    ): boolean | number;
    removeAllCallbacks(priority?: number): void;
    currentPriority(): number | false;

    readonly _engine: HookEngine;
    readonly _diagnostics: HookEngine['_diagnostics'];
}

/**
 * Create a typed wrapper around an existing HookEngine.
 * Zero-cost at runtime; only types improve.
 */
export function createTypedHookEngine(engine: HookEngine): TypedHookEngine {
    return {
        // Actions
        addAction: (name, callback, priority) =>
            engine.addAction(name as any, callback as any, priority),
        removeAction: (name, callback, priority) =>
            engine.removeAction(name as any, callback as any, priority),
        doAction: (name, ...args) =>
            engine.doAction(name as any, ...(args as any)),
        doActionSync: (name, ...args) =>
            engine.doActionSync(name as any, ...(args as any)),

        // Filters
        addFilter: (name, callback, priority) =>
            engine.addFilter(name as any, callback as any, priority),
        removeFilter: (name, callback, priority) =>
            engine.removeFilter(name as any, callback as any, priority),
        applyFilters: (name, value, ...args) =>
            engine.applyFilters(
                name as any,
                value as any,
                ...(args as any)
            ) as any,
        applyFiltersSync: (name, value, ...args) =>
            engine.applyFiltersSync(
                name as any,
                value as any,
                ...(args as any)
            ),

        // Unified
        on: (name, callback, opts) => {
            const kind = (opts?.kind ??
                (name.includes(':filter:') ? 'filter' : 'action')) as HookKind;
            const merged = { ...opts, kind } as OnOptions;
            return engine.on(name as any, callback as any, merged);
        },
        off: (disposer) => engine.off(disposer),
        onceAction: (name, callback, priority) =>
            engine.onceAction(name as any, callback as any, priority),

        // Utilities
        hasAction: (name, fn) => engine.hasAction(name as any, fn as any),
        hasFilter: (name, fn) => engine.hasFilter(name as any, fn as any),
        removeAllCallbacks: (priority) => engine.removeAllCallbacks(priority),
        currentPriority: () => engine.currentPriority(),

        // Direct access
        _engine: engine,
        _diagnostics: engine._diagnostics,
    };
}
