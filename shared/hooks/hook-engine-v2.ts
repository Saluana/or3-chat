import { ActivationTable } from '../plugins/activation-table';
import type { HookDiagnostics } from './hook-diagnostics';
import { createV1HookDiagnosticsAdapter } from './hook-diagnostics-compat';
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

function normalizeAcceptedArgs(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    if (value <= 0) return 0;
    return Math.floor(value);
}

function sliceActionArgs(
    args: unknown[],
    acceptedArgs: number | undefined
): unknown[] {
    const normalized = normalizeAcceptedArgs(acceptedArgs);
    if (normalized === undefined) return args;
    return args.slice(0, normalized);
}

function sliceFilterCallArgs(
    value: unknown,
    args: unknown[],
    acceptedArgs: number | undefined
): unknown[] {
    const normalized = normalizeAcceptedArgs(acceptedArgs);
    if (normalized === undefined) return [value, ...args];
    return [value, ...args].slice(0, normalized);
}

type PriorityAlsStore = number[];
interface PriorityAls {
    getStore(): PriorityAlsStore | undefined;
    run<T>(store: PriorityAlsStore, fn: () => T): T;
}

function createPriorityAls(): PriorityAls | null {
    try {
        const proc = (globalThis as { process?: unknown })?.process as
            | { getBuiltinModule?: (name: string) => unknown }
            | undefined;
        const ctor = (proc?.getBuiltinModule?.('async_hooks') as
            | { AsyncLocalStorage?: new () => PriorityAls }
            | undefined)?.AsyncLocalStorage;
        if (typeof ctor === 'function') return new ctor();
        const globalCtor = (globalThis as Record<string, unknown>)
            .AsyncLocalStorage as new () => PriorityAls;
        if (typeof globalCtor === 'function') return new globalCtor();
    } catch {
        // Async isolation unavailable; synchronous callback frames still support introspection.
    }
    return null;
}

function consumeThenableRejection(
    thenable: unknown,
    onRejection: (error: unknown) => void
): void {
    try {
        Promise.resolve(thenable).catch(onRejection);
    } catch {
        // Never let rejection tracking break dispatch.
    }
}

export interface HookEngineV2Runtime {
    readonly activationTable: ActivationTable;
    readonly diagnostics: HookDiagnostics;
    readonly records: HookRecordStore;
    defineHook(input: DefineHookInput): HookDefinition;
    inspectDefinitions(): readonly HookDefinition[];
    resetDiagnostics(): void;
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
    const priorityAls = createPriorityAls();
    const definitions = new Map<string, HookDefinition>();

    function invokeWithFallbackPriority<T>(priority: number, callback: () => T): T {
        if (priorityAls) return callback();
        currentPriorityStack.push(priority);
        try {
            return callback();
        } finally {
            currentPriorityStack.pop();
        }
    }

    function readCurrentPriority(): number | false {
        const store = priorityAls?.getStore();
        if (store && store.length > 0) return store[store.length - 1]!;
        return currentPriorityStack.length > 0
            ? currentPriorityStack[currentPriorityStack.length - 1]!
            : false;
    }

    function setRunningPriority(priority: number): void {
        const store = priorityAls?.getStore();
        if (store && store.length > 0) {
            store[store.length - 1] = priority;
            return;
        }
        currentPriorityStack[currentPriorityStack.length - 1] = priority;
    }

    function alsSeed(firstPriority: number): number[] {
        const parent = priorityAls?.getStore();
        return parent && parent.length > 0
            ? [...parent, firstPriority]
            : [firstPriority];
    }
    const diagnosticsAdapter = createV1HookDiagnosticsAdapter({
        callbacks: (kind) => records.visibleCount(kind),
    });
    const runtimeDiagnostics = diagnosticsAdapter.diagnostics;
    const diagnostics = diagnosticsAdapter.facade;

    function recordTiming(name: string, ms: number): void {
        diagnosticsAdapter.recordTiming(name, ms);
    }

    function recordError(name: string): void {
        diagnosticsAdapter.recordError(name);
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
        return `${kind === 'action' ? 'a' : 'f'}${name}`;
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

    function reportSyncThenable(
        thenable: unknown,
        name: string,
        isFilter: boolean
    ): void {
        recordError(name);
        logCallbackError(
            new Error(
                `Synchronous ${isFilter ? 'filter' : 'action'} callback returned a Promise`
            ),
            name,
            isFilter
        );
        consumeThenableRejection(thenable, (error) => {
            recordError(name);
            logCallbackError(error, name, isFilter);
        });
    }

    async function runPolicySerialBody(
        callbacks: readonly HookRecord[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue: unknown,
        definition: HookDefinition,
    ): Promise<unknown> {
        const errors: unknown[] = [];
        let value = initialValue;
        for (const { fn, priority, acceptedArgs } of callbacks) {
            if (priorityAls) setRunningPriority(priority);
            const start = performance.now();
            try {
                if (isFilter) {
                    value = await invokeWithTimeout(
                        name,
                        definition.policy.timeoutMs,
                        () => invokeWithFallbackPriority(priority, () =>
                            (fn as (...a: unknown[]) => unknown)(
                                ...sliceFilterCallArgs(
                                    value,
                                    args,
                                    acceptedArgs
                                )
                            )),
                    );
                } else {
                    await invokeWithTimeout(
                        name,
                        definition.policy.timeoutMs,
                        () => invokeWithFallbackPriority(priority, () =>
                            (fn as (...a: unknown[]) => unknown)(
                                ...sliceActionArgs(args, acceptedArgs)
                            )),
                    );
                }
            } catch (error) {
                recordError(name);
                logCallbackError(error, name, isFilter);
                errors.push(error);
                if (definition.policy.errorPolicy === 'stop') break;
                if (definition.policy.errorPolicy === 'rethrow') throw error;
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
    }

    async function callPolicySerial(
        callbacks: readonly HookRecord[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue: unknown,
        definition: HookDefinition,
    ): Promise<unknown> {
        const firstPriority =
            callbacks[0]?.priority ?? DEFAULT_PRIORITY;
        if (priorityAls) {
            return priorityAls.run(alsSeed(firstPriority), () =>
                runPolicySerialBody(
                    callbacks,
                    name,
                    args,
                    isFilter,
                    initialValue,
                    definition
                )
            );
        }
        return runPolicySerialBody(callbacks, name, args, isFilter, initialValue, definition);
    }

    async function callPolicyParallelAction(
        callbacks: readonly HookRecord[],
        name: string,
        args: unknown[],
        definition: HookDefinition,
    ): Promise<void> {
        const firstPriority =
            callbacks[0]?.priority ?? DEFAULT_PRIORITY;
        const runParallel = async () => {
            const results = await Promise.all(
                callbacks.map(async ({ fn, priority, acceptedArgs }) => {
                    const start = performance.now();
                    const invoke = async () => {
                        if (priorityAls) {
                            return priorityAls.run(
                                alsSeed(priority),
                                () =>
                                    invokeWithTimeout(
                                        name,
                                        definition.policy.timeoutMs,
                                        () =>
                                            (fn as (...a: unknown[]) => unknown)(
                                                ...sliceActionArgs(
                                                    args,
                                                    acceptedArgs
                                                )
                                            )
                                    )
                            );
                        }
                        return invokeWithTimeout(
                            name,
                            definition.policy.timeoutMs,
                            () => invokeWithFallbackPriority(priority, () =>
                                (fn as (...a: unknown[]) => unknown)(
                                    ...sliceActionArgs(args, acceptedArgs)
                                ))
                        );
                    };
                    try {
                        await invoke();
                        return { ok: true as const };
                    } catch (error) {
                        recordError(name);
                        logCallbackError(error, name, false);
                        return { ok: false as const, error };
                    } finally {
                        recordTiming(name, performance.now() - start);
                    }
                })
            );
            const errors = results.flatMap((result) =>
                result.ok ? [] : [result.error]
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
        };
        if (priorityAls) {
            return priorityAls.run(alsSeed(firstPriority), runParallel);
        }
        return runParallel();
    }

    function runPolicySyncBody(
        callbacks: readonly HookRecord[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue: unknown,
        definition: HookDefinition,
    ): unknown {
        const errors: unknown[] = [];
        let value = initialValue;
        for (const { fn, priority, acceptedArgs } of callbacks) {
            setRunningPriority(priority);
            const start = performance.now();
            try {
                const next = isFilter
                    ? (fn as (...a: unknown[]) => unknown)(
                          ...sliceFilterCallArgs(value, args, acceptedArgs)
                      )
                    : (fn as (...a: unknown[]) => unknown)(
                          ...sliceActionArgs(args, acceptedArgs)
                      );
                if (isThenable(next)) {
                    consumeThenableRejection(next, (error) => {
                        recordError(name);
                        logCallbackError(error, name, isFilter);
                    });
                    throw new Error(
                        `Synchronous ${isFilter ? 'filter' : 'action'} callback returned a Promise`
                    );
                }
                if (isFilter) value = next;
            } catch (error) {
                recordError(name);
                logCallbackError(error, name, isFilter);
                errors.push(error);
                if (definition.policy.errorPolicy === 'stop') break;
                if (definition.policy.errorPolicy === 'rethrow') throw error;
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
                `Parallel hook ${name} requires asynchronous dispatch`
            );
        }
        const firstPriority =
            callbacks[0]?.priority ?? DEFAULT_PRIORITY;
        if (priorityAls) {
            return priorityAls.run(alsSeed(firstPriority), () =>
                runPolicySyncBody(
                    callbacks,
                    name,
                    args,
                    isFilter,
                    initialValue,
                    definition
                )
            );
        }
        currentPriorityStack.push(firstPriority);
        try {
            return runPolicySyncBody(
                callbacks,
                name,
                args,
                isFilter,
                initialValue,
                definition
            );
        } finally {
            currentPriorityStack.pop();
        }
    }

    async function runAsyncBody(
        callbacks: readonly HookRecord[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue?: unknown,
    ): Promise<unknown> {
        let value = initialValue;
        for (const { fn, priority, acceptedArgs } of callbacks) {
            if (priorityAls) setRunningPriority(priority);
            const start = performance.now();
            try {
                if (isFilter) {
                    value = await invokeWithFallbackPriority(
                        priority,
                        () => (fn as (...a: unknown[]) => unknown)(
                            ...sliceFilterCallArgs(value, args, acceptedArgs)
                        )
                    );
                } else {
                    await invokeWithFallbackPriority(
                        priority,
                        () => (fn as (...a: unknown[]) => unknown)(
                            ...sliceActionArgs(args, acceptedArgs)
                        )
                    );
                }
            } catch (error) {
                recordError(name);
                logCallbackError(error, name, isFilter);
            } finally {
                recordTiming(name, performance.now() - start);
            }
        }
        return value;
    }

    async function callAsync(
        callbacks: readonly HookRecord[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue?: unknown,
    ): Promise<unknown> {
        const firstPriority =
            callbacks[0]?.priority ?? DEFAULT_PRIORITY;
        if (priorityAls) {
            return priorityAls.run(alsSeed(firstPriority), () =>
                runAsyncBody(callbacks, name, args, isFilter, initialValue)
            );
        }
        return runAsyncBody(callbacks, name, args, isFilter, initialValue);
    }

    function runSyncBody(
        callbacks: readonly HookRecord[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue?: unknown,
    ): unknown {
        let value = initialValue;
        for (const { fn, priority, acceptedArgs } of callbacks) {
            setRunningPriority(priority);
            const start = performance.now();
            try {
                if (isFilter) {
                    const next = (fn as (...a: unknown[]) => unknown)(
                        ...sliceFilterCallArgs(value, args, acceptedArgs)
                    );
                    if (isThenable(next)) {
                        reportSyncThenable(next, name, true);
                    } else {
                        value = next;
                    }
                } else {
                    const result = (fn as (...a: unknown[]) => unknown)(
                        ...sliceActionArgs(args, acceptedArgs)
                    );
                    if (isThenable(result)) {
                        reportSyncThenable(result, name, false);
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
    }

    function callSync(
        callbacks: readonly HookRecord[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue?: unknown,
    ): unknown {
        const firstPriority =
            callbacks[0]?.priority ?? DEFAULT_PRIORITY;
        if (priorityAls) {
            return priorityAls.run(alsSeed(firstPriority), () =>
                runSyncBody(callbacks, name, args, isFilter, initialValue)
            );
        }
        currentPriorityStack.push(firstPriority);
        try {
            return runSyncBody(callbacks, name, args, isFilter, initialValue);
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
            const definition = definitions.size
                ? getDefinition('filter', name)
                : undefined;
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
            const definition = definitions.size
                ? getDefinition('filter', name)
                : undefined;
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
            const definition = definitions.size
                ? getDefinition('action', name)
                : undefined;
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
            const definition = definitions.size
                ? getDefinition('action', name)
                : undefined;
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
            return readCurrentPriority();
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
            resetDiagnostics() {
                diagnostics.timings = {};
                diagnostics.errors = {};
            },
        }),
    };

    return engine;
}
