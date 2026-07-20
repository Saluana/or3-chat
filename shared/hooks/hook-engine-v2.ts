import { ActivationTable } from '../plugins/activation-table';
import { HookDiagnostics } from './hook-diagnostics';
import { HookRecordStore, type HookRecord } from './hook-record-store';
import type {
    HookEngine,
    HookEngineOptions,
    HookFn,
    HookKind,
} from './hook-engine-core';

const DEFAULT_PRIORITY = 10;

export const LEGACY_HOOK_POLICY = Object.freeze({
    actionMode: 'series' as const,
    errorPolicy: 'continue' as const,
    filterMode: 'series' as const,
    timeoutMs: null,
    syncThenablePolicy: 'reject-and-continue' as const,
});

export type HookErrorPolicy =
    | 'continue'
    | 'stop'
    | 'aggregate'
    | 'rethrow'
    | 'fail-closed';

export interface HookExecutionPolicy {
    readonly actionMode?: 'series' | 'parallel';
    readonly errorPolicy?: HookErrorPolicy;
    readonly timeoutMs?: number | null;
}

export interface HookDefinition {
    readonly kind: HookKind;
    readonly name: string;
    readonly policy: Readonly<{
        actionMode: 'series' | 'parallel';
        errorPolicy: HookErrorPolicy;
        timeoutMs: number | null;
    }>;
}

export interface DefineHookInput {
    readonly kind: HookKind;
    readonly name: string;
    readonly policy?: HookExecutionPolicy;
}

export class HookCallbackTimeoutError extends Error {
    readonly code = 'hook-callback-timeout';
    readonly hookName: string;
    readonly timeoutMs: number;

    constructor(hookName: string, timeoutMs: number) {
        super(`Hook callback for ${hookName} timed out after ${timeoutMs}ms`);
        this.name = 'HookCallbackTimeoutError';
        this.hookName = hookName;
        this.timeoutMs = timeoutMs;
    }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { then?: unknown }).then === 'function'
    );
}

export interface HookEngineV2Runtime {
    readonly activationTable: ActivationTable;
    readonly diagnostics: HookDiagnostics;
    readonly records: HookRecordStore;
    defineHook(input: DefineHookInput): HookDefinition;
    inspectDefinitions(): readonly HookDefinition[];
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
    const definitions = new Map<string, HookDefinition>();
    const runtimeDiagnostics = new HookDiagnostics();
    const diagnostics = {
        timings: {} as Record<string, number[]>,
        errors: {} as Record<string, number>,
        callbacks(kind?: HookKind) {
            return records.visibleCount(kind);
        },
    };

    function recordTiming(name: string, ms: number): void {
        runtimeDiagnostics.recordTiming(name, ms);
        if (Object.hasOwn(diagnostics.timings, name)) {
            diagnostics.timings[name]!.push(ms);
            return;
        }
        diagnostics.timings[name] = [ms];
    }

    function recordError(name: string): void {
        runtimeDiagnostics.recordError(name);
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

    function definitionKey(kind: HookKind, name: string): string {
        return JSON.stringify([kind, name]);
    }

    function defineHook(input: DefineHookInput): HookDefinition {
        if (!input.name) throw new Error('Hook definition name is required');
        const actionMode = input.policy?.actionMode ?? 'series';
        const errorPolicy = input.policy?.errorPolicy ?? 'continue';
        const timeoutMs = input.policy?.timeoutMs ?? null;
        if (input.kind === 'filter' && actionMode === 'parallel') {
            throw new Error(
                'Parallel execution is only valid for action hooks',
            );
        }
        if (actionMode === 'parallel' && errorPolicy === 'stop') {
            throw new Error('Stop policy requires serial action execution');
        }
        if (input.kind === 'action' && errorPolicy === 'fail-closed') {
            throw new Error(
                'Fail-closed execution is only valid for filter hooks',
            );
        }
        if (
            timeoutMs !== null &&
            (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        ) {
            throw new Error('Hook timeout must be a positive finite number');
        }
        const definition = Object.freeze({
            kind: input.kind,
            name: input.name,
            policy: Object.freeze({ actionMode, errorPolicy, timeoutMs }),
        });
        definitions.set(definitionKey(input.kind, input.name), definition);
        return definition;
    }

    function getDefinition(
        kind: HookKind,
        name: string,
    ): HookDefinition | undefined {
        return definitions.get(definitionKey(kind, name));
    }

    function invokeWithTimeout<T>(
        name: string,
        timeoutMs: number | null,
        callback: () => T | PromiseLike<T>,
    ): Promise<T> {
        if (timeoutMs === null) return Promise.resolve().then(callback);
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new HookCallbackTimeoutError(name, timeoutMs)),
                timeoutMs,
            );
            Promise.resolve()
                .then(callback)
                .then(resolve, reject)
                .finally(() => clearTimeout(timer));
        });
    }

    async function callPolicySerial(
        callbacks: readonly HookRecord[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue: unknown,
        definition: HookDefinition,
    ): Promise<unknown> {
        currentPriorityStack.push(callbacks[0]?.priority ?? DEFAULT_PRIORITY);
        const errors: unknown[] = [];
        try {
            let value = initialValue;
            for (const { fn, priority } of callbacks) {
                currentPriorityStack[currentPriorityStack.length - 1] =
                    priority;
                const start = performance.now();
                try {
                    if (isFilter) {
                        value = await invokeWithTimeout(
                            name,
                            definition.policy.timeoutMs,
                            () => fn(value, ...args),
                        );
                    } else {
                        await invokeWithTimeout(
                            name,
                            definition.policy.timeoutMs,
                            () => fn(...args),
                        );
                    }
                } catch (error) {
                    recordError(name);
                    logCallbackError(error, name, isFilter);
                    errors.push(error);
                    if (definition.policy.errorPolicy === 'stop') break;
                    if (definition.policy.errorPolicy === 'rethrow')
                        throw error;
                    if (definition.policy.errorPolicy === 'fail-closed')
                        return false;
                } finally {
                    recordTiming(name, performance.now() - start);
                }
            }
            if (
                definition.policy.errorPolicy === 'aggregate' &&
                errors.length > 0
            ) {
                throw new AggregateError(errors, `Hook ${name} failed`);
            }
            return value;
        } finally {
            currentPriorityStack.pop();
        }
    }

    async function callPolicyParallelAction(
        callbacks: readonly HookRecord[],
        name: string,
        args: unknown[],
        definition: HookDefinition,
    ): Promise<void> {
        currentPriorityStack.push(callbacks[0]?.priority ?? DEFAULT_PRIORITY);
        try {
            const results = await Promise.all(
                callbacks.map(async ({ fn }) => {
                    const start = performance.now();
                    try {
                        await invokeWithTimeout(
                            name,
                            definition.policy.timeoutMs,
                            () => fn(...args),
                        );
                        return { ok: true as const };
                    } catch (error) {
                        recordError(name);
                        logCallbackError(error, name, false);
                        return { ok: false as const, error };
                    } finally {
                        recordTiming(name, performance.now() - start);
                    }
                }),
            );
            const errors = results.flatMap((result) =>
                result.ok ? [] : [result.error],
            );
            if (
                errors.length === 0 ||
                definition.policy.errorPolicy === 'continue'
            ) {
                return;
            }
            if (definition.policy.errorPolicy === 'aggregate') {
                throw new AggregateError(errors, `Hook ${name} failed`);
            }
            throw errors[0];
        } finally {
            currentPriorityStack.pop();
        }
    }

    function callPolicySync(
        callbacks: readonly HookRecord[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue: unknown,
        definition: HookDefinition,
    ): unknown {
        if (!isFilter && definition.policy.actionMode === 'parallel') {
            throw new Error(
                `Parallel hook ${name} requires asynchronous dispatch`,
            );
        }
        currentPriorityStack.push(callbacks[0]?.priority ?? DEFAULT_PRIORITY);
        const errors: unknown[] = [];
        try {
            let value = initialValue;
            for (const { fn, priority } of callbacks) {
                currentPriorityStack[currentPriorityStack.length - 1] =
                    priority;
                const start = performance.now();
                try {
                    const next = isFilter ? fn(value, ...args) : fn(...args);
                    if (isThenable(next)) {
                        throw new Error(
                            `Synchronous ${isFilter ? 'filter' : 'action'} callback returned a Promise`,
                        );
                    }
                    if (isFilter) value = next;
                } catch (error) {
                    recordError(name);
                    logCallbackError(error, name, isFilter);
                    errors.push(error);
                    if (definition.policy.errorPolicy === 'stop') break;
                    if (definition.policy.errorPolicy === 'rethrow')
                        throw error;
                    if (definition.policy.errorPolicy === 'fail-closed')
                        return false;
                } finally {
                    recordTiming(name, performance.now() - start);
                }
            }
            if (
                definition.policy.errorPolicy === 'aggregate' &&
                errors.length > 0
            ) {
                throw new AggregateError(errors, `Hook ${name} failed`);
            }
            return value;
        } finally {
            currentPriorityStack.pop();
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
            const definition = getDefinition('filter', name);
            if (definition) {
                return (await callPolicySerial(
                    callbacks,
                    name,
                    args,
                    true,
                    value,
                    definition,
                )) as typeof value;
            }
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
            const definition = getDefinition('filter', name);
            if (definition) {
                return callPolicySync(
                    callbacks,
                    name,
                    args,
                    true,
                    value,
                    definition,
                ) as typeof value;
            }
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
            const definition = getDefinition('action', name);
            if (definition) {
                if (definition.policy.actionMode === 'parallel') {
                    await callPolicyParallelAction(
                        callbacks,
                        name,
                        args,
                        definition,
                    );
                } else {
                    await callPolicySerial(
                        callbacks,
                        name,
                        args,
                        false,
                        undefined,
                        definition,
                    );
                }
                return;
            }
            await callAsync(callbacks, name, args, false);
        },
        doActionSync(name, ...args) {
            const callbacks = records.matching('action', name);
            if (callbacks.length === 0) return;
            const definition = getDefinition('action', name);
            if (definition) {
                callPolicySync(
                    callbacks,
                    name,
                    args,
                    false,
                    undefined,
                    definition,
                );
                return;
            }
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
        _runtimeV2: Object.freeze({
            activationTable,
            diagnostics: runtimeDiagnostics,
            records,
            defineHook,
            inspectDefinitions: () =>
                Object.freeze(Array.from(definitions.values())),
        }),
    };

    return engine;
}
