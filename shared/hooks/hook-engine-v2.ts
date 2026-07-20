import { ActivationTable } from '../plugins/activation-table';
import { HookRecordStore, type HookRecord } from './hook-record-store';
import type {
    HookEngine,
    HookEngineOptions,
    HookFn,
    HookKind,
} from './hook-engine-core';

const DEFAULT_PRIORITY = 10;

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { then?: unknown }).then === 'function'
    );
}

export interface HookEngineV2Runtime {
    readonly activationTable: ActivationTable;
    readonly records: HookRecordStore;
}

export interface HookEngineV2 extends HookEngine {
    readonly _runtimeV2: HookEngineV2Runtime;
}

/** Legacy-compatible serial executors backed by the owner-aware V2 record store. */
export function createHookEngineV2(
    options: HookEngineOptions & {
        activationTable?: ActivationTable;
        recordStore?: HookRecordStore;
    } = {},
): HookEngineV2 {
    const activationTable = options.activationTable ?? new ActivationTable();
    const records =
        options.recordStore ?? new HookRecordStore({ activationTable });
    const resolveOnKind =
        options.resolveOnKind ??
        ((_name: string, explicitKind: HookKind | undefined) =>
            explicitKind ?? 'action');
    const currentPriorityStack: number[] = [];
    const diagnostics = {
        timings: {} as Record<string, number[]>,
        errors: {} as Record<string, number>,
        callbacks(kind?: HookKind) {
            return records.visibleCount(kind);
        },
    };

    function recordTiming(name: string, ms: number): void {
        if (Object.hasOwn(diagnostics.timings, name)) {
            diagnostics.timings[name]!.push(ms);
            return;
        }
        diagnostics.timings[name] = [ms];
    }

    function recordError(name: string): void {
        diagnostics.errors[name] = Object.hasOwn(diagnostics.errors, name)
            ? diagnostics.errors[name]! + 1
            : 1;
    }

    function logCallbackError(
        error: unknown,
        name: string,
        isFilter: boolean,
    ): void {
        if (!options.logCallbackError) return;
        try {
            options.logCallbackError({ error, isFilter, name });
        } catch {
            // Logging failures must never break hook execution.
        }
    }

    async function callAsync(
        callbacks: readonly HookRecord[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue?: unknown,
    ): Promise<unknown> {
        currentPriorityStack.push(callbacks[0]?.priority ?? DEFAULT_PRIORITY);
        try {
            let value = initialValue;
            for (const { fn, priority } of callbacks) {
                currentPriorityStack[currentPriorityStack.length - 1] =
                    priority;
                const start = performance.now();
                try {
                    if (isFilter) value = await fn(value, ...args);
                    else await fn(...args);
                } catch (error) {
                    recordError(name);
                    logCallbackError(error, name, isFilter);
                } finally {
                    recordTiming(name, performance.now() - start);
                }
            }
            return value;
        } finally {
            currentPriorityStack.pop();
        }
    }

    function callSync(
        callbacks: readonly HookRecord[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue?: unknown,
    ): unknown {
        currentPriorityStack.push(callbacks[0]?.priority ?? DEFAULT_PRIORITY);
        try {
            let value = initialValue;
            for (const { fn, priority } of callbacks) {
                currentPriorityStack[currentPriorityStack.length - 1] =
                    priority;
                const start = performance.now();
                try {
                    if (isFilter) {
                        const next = fn(value, ...args);
                        if (isThenable(next)) {
                            recordError(name);
                            logCallbackError(
                                new Error(
                                    'Synchronous filter callback returned a Promise',
                                ),
                                name,
                                true,
                            );
                        } else {
                            value = next;
                        }
                    } else {
                        const result = fn(...args);
                        if (isThenable(result)) {
                            recordError(name);
                            logCallbackError(
                                new Error(
                                    'Synchronous action callback returned a Promise',
                                ),
                                name,
                                false,
                            );
                        }
                    }
                } catch (error) {
                    recordError(name);
                    logCallbackError(error, name, isFilter);
                } finally {
                    recordTiming(name, performance.now() - start);
                }
            }
            return value;
        } finally {
            currentPriorityStack.pop();
        }
    }

    const engine: HookEngineV2 = {
        addFilter(name, fn, priority, acceptedArgs) {
            records.registerLegacy({
                kind: 'filter',
                name,
                fn,
                priority,
                acceptedArgs,
            });
        },
        removeFilter(name, fn, priority) {
            records.removeLegacy({ kind: 'filter', name, fn, priority });
        },
        async applyFilters(name, value, ...args) {
            const callbacks = records.matching('filter', name);
            if (callbacks.length === 0) return value;
            return (await callAsync(
                callbacks,
                name,
                args,
                true,
                value,
            )) as typeof value;
        },
        applyFiltersSync(name, value, ...args) {
            const callbacks = records.matching('filter', name);
            if (callbacks.length === 0) return value;
            return callSync(callbacks, name, args, true, value) as typeof value;
        },
        addAction(name, fn, priority, acceptedArgs) {
            records.registerLegacy({
                kind: 'action',
                name,
                fn,
                priority,
                acceptedArgs,
            });
        },
        removeAction(name, fn, priority) {
            records.removeLegacy({ kind: 'action', name, fn, priority });
        },
        async doAction(name, ...args) {
            const callbacks = records.matching('action', name);
            if (callbacks.length === 0) return;
            await callAsync(callbacks, name, args, false);
        },
        doActionSync(name, ...args) {
            const callbacks = records.matching('action', name);
            if (callbacks.length === 0) return;
            callSync(callbacks, name, args, false);
        },
        hasFilter(name?: string, fn?: HookFn) {
            return records.has('filter', name, fn);
        },
        hasAction(name?: string, fn?: HookFn) {
            return records.has('action', name, fn);
        },
        removeAllCallbacks(priority?: number) {
            records.removeAllLegacy(priority);
        },
        currentPriority() {
            return currentPriorityStack.length > 0
                ? currentPriorityStack[currentPriorityStack.length - 1]!
                : false;
        },
        onceAction(name, fn, priority) {
            let settled = false;
            const wrapper = (...args: unknown[]) => {
                if (settled) return;
                settled = true;
                engine.removeAction(name, wrapper, priority);
                const result = fn(...args);
                if (isThenable(result)) {
                    return Promise.resolve(result).catch((error) => {
                        recordError(name);
                        logCallbackError(error, name, false);
                    });
                }
                return result;
            };
            engine.addAction(name, wrapper, priority);
            return () => engine.removeAction(name, wrapper, priority);
        },
        on(name, fn, onOptions) {
            const kind = resolveOnKind(name, onOptions?.kind);
            const priority = onOptions?.priority;
            if (kind === 'filter') {
                engine.addFilter(name, fn, priority, onOptions?.acceptedArgs);
                return () => engine.removeFilter(name, fn, priority);
            }
            engine.addAction(name, fn, priority, onOptions?.acceptedArgs);
            return () => engine.removeAction(name, fn, priority);
        },
        off(disposer) {
            if (!options.onOffError) {
                disposer();
                return;
            }
            try {
                disposer();
            } catch (error) {
                options.onOffError(error);
            }
        },
        _diagnostics: diagnostics,
        _runtimeV2: Object.freeze({ activationTable, records }),
    };

    return engine;
}
