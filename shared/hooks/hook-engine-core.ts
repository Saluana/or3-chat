import {
    HOOK_DIAGNOSTIC_SAMPLE_CAPACITY,
    HOOK_DIAGNOSTIC_SERIES_CAPACITY,
} from './hook-diagnostics';

export type HookKind = 'action' | 'filter';

export type HookFn = (...args: unknown[]) => unknown;

export interface RegisterOptions {
    priority?: number;
    acceptedArgs?: number;
}

export interface OnOptions extends RegisterOptions {
    kind?: HookKind;
}

interface CallbackEntry<F extends HookFn = HookFn> {
    fn: F;
    priority: number;
    acceptedArgs?: number;
    id: number;
    name: string;
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
    if (acceptedArgs === undefined) return args;
    return args.slice(0, acceptedArgs);
}

function sliceFilterCallArgs(
    value: unknown,
    args: unknown[],
    acceptedArgs: number | undefined
): unknown[] {
    if (acceptedArgs === undefined) return [value, ...args];
    return [value, ...args].slice(0, acceptedArgs);
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

interface CompiledPattern {
    pattern: string;
    regex: RegExp;
}

export interface HookEngine {
    addFilter: <F extends HookFn>(
        name: string,
        fn: F,
        priority?: number,
        acceptedArgs?: number
    ) => void;
    removeFilter: <F extends HookFn>(
        name: string,
        fn: F,
        priority?: number
    ) => void;
    applyFilters: <T>(name: string, value: T, ...args: unknown[]) => Promise<T>;
    applyFiltersSync: <T>(name: string, value: T, ...args: unknown[]) => T;

    addAction: <F extends HookFn>(
        name: string,
        fn: F,
        priority?: number,
        acceptedArgs?: number
    ) => void;
    removeAction: <F extends HookFn>(
        name: string,
        fn: F,
        priority?: number
    ) => void;
    doAction: (name: string, ...args: unknown[]) => Promise<void>;
    doActionSync: (name: string, ...args: unknown[]) => void;

    hasFilter: (name?: string, fn?: HookFn) => boolean | number;
    hasAction: (name?: string, fn?: HookFn) => boolean | number;
    removeAllCallbacks: (priority?: number) => void;
    currentPriority: () => number | false;

    onceAction: (name: string, fn: HookFn, priority?: number) => () => void;
    on: (name: string, fn: HookFn, opts?: OnOptions) => () => void;
    off: (disposer: () => void) => void;

    _diagnostics: {
        timings: Record<string, number[]>;
        errors: Record<string, number>;
        callbacks(actionOrFilter?: HookKind): number;
    };
}

export interface HookEngineErrorContext {
    error: unknown;
    isFilter: boolean;
    name: string;
}

export interface HookEngineOptions {
    logCallbackError?: (context: HookEngineErrorContext) => void;
    resolveOnKind?: (name: string, explicitKind: HookKind | undefined) => HookKind;
    onOffError?: (error: unknown) => void;
}

function globToRegExp(glob: string): RegExp {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}

const regexCache = new Map<string, RegExp>();
const REGEX_CACHE_CAPACITY = 512;

function getRegex(glob: string): RegExp {
    let regex = regexCache.get(glob);
    if (regex) {
        regexCache.delete(glob);
        regexCache.set(glob, regex);
        return regex;
    }
    regex = globToRegExp(glob);
    regexCache.set(glob, regex);
    while (regexCache.size > REGEX_CACHE_CAPACITY) {
        const oldestGlob = regexCache.keys().next().value as string | undefined;
        if (!oldestGlob) break;
        regexCache.delete(oldestGlob);
    }
    return regex;
}

function sortCallbacks<T extends CallbackEntry>(arr: T[]): T[] {
    return arr.sort((a, b) => a.priority - b.priority || a.id - b.id);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { then?: unknown }).then === 'function'
    );
}

export function createHookEngine(options: HookEngineOptions = {}): HookEngine {
    const DEFAULT_PRIORITY = 10;
    const resolveOnKind =
        options.resolveOnKind ??
        ((_name: string, explicitKind: HookKind | undefined) =>
            explicitKind ?? 'action');
    let counter = 0;
    const currentPriorityStack: number[] = [];
    const priorityAls = createPriorityAls();

    function invokeWithFallbackPriority<T>(priority: number, callback: () => T): T {
        if (priorityAls) return callback();
        currentPriorityStack.push(priority);
        try {
            return callback();
        } finally {
            currentPriorityStack.pop();
        }
    }

    const actions = new Map<string, CallbackEntry[]>();
    const filters = new Map<string, CallbackEntry[]>();
    const actionWildcards: {
        pattern: CompiledPattern;
        entry: CallbackEntry;
    }[] = [];
    const filterWildcards: {
        pattern: CompiledPattern;
        entry: CallbackEntry;
    }[] = [];

    function getMatching(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name: string
    ): CallbackEntry[] {
        const list = map.get(name)
            ? [...(map.get(name) as CallbackEntry[])]
            : [];
        if (wildcards.length) {
            for (const { pattern, entry } of wildcards) {
                if (pattern.regex.test(name)) {
                    list.push(entry);
                }
            }
        }
        return sortCallbacks(list);
    }

    function add(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name: string,
        fn: HookFn,
        priority?: number,
        acceptedArgs?: number
    ) {
        const nextPriority =
            typeof priority === 'number' ? priority : DEFAULT_PRIORITY;
        const entry: CallbackEntry = {
            fn,
            priority: nextPriority,
            acceptedArgs: normalizeAcceptedArgs(acceptedArgs),
            id: ++counter,
            name,
        };
        if (name.includes('*')) {
            wildcards.push({
                pattern: { pattern: name, regex: getRegex(name) },
                entry,
            });
            return;
        }

        const list = map.get(name) || [];
        list.push(entry);
        map.set(name, list);
    }

    function remove(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name: string,
        fn: HookFn,
        priority?: number
    ) {
        const expectedPriority =
            typeof priority === 'number' ? priority : undefined;

        if (name.includes('*')) {
            const index = wildcards.findIndex(
                (entry) =>
                    entry.pattern.pattern === name &&
                    entry.entry.fn === fn &&
                    (expectedPriority === undefined ||
                        entry.entry.priority === expectedPriority)
            );
            if (index >= 0) {
                wildcards.splice(index, 1);
            }
            return;
        }

        const list = map.get(name);
        if (!list) {
            return;
        }

        const filtered = list.filter(
            (entry) =>
                !(
                    entry.fn === fn &&
                    (expectedPriority === undefined ||
                        entry.priority === expectedPriority)
                )
        );

        if (filtered.length > 0) {
            map.set(name, filtered);
        } else {
            map.delete(name);
        }
    }

    function has(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name?: string,
        fn?: HookFn
    ): boolean | number {
        if (!name) {
            return (
                Array.from(map.values()).some((entries) => entries.length > 0) ||
                wildcards.length > 0
            );
        }

        if (fn) {
            const existing = (map.get(name) || []).find((entry) => entry.fn === fn);
            if (existing) {
                return existing.priority;
            }

            const wildcard = wildcards.find(
                (entry) =>
                    entry.pattern.pattern === name && entry.entry.fn === fn
            );
            return wildcard ? wildcard.entry.priority : false;
        }

        return (
            (map.get(name) || []).length > 0 ||
            wildcards.some((entry) => entry.pattern.regex.test(name))
        );
    }

    function removeAll(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        priority?: number
    ) {
        if (priority === undefined) {
            map.clear();
            wildcards.length = 0;
            return;
        }

        for (const [name, entries] of map) {
            const filtered = entries.filter((entry) => entry.priority !== priority);
            if (filtered.length > 0) {
                map.set(name, filtered);
            } else {
                map.delete(name);
            }
        }

        for (let index = wildcards.length - 1; index >= 0; index--) {
            const entry = wildcards[index];
            if (entry && entry.entry.priority === priority) {
                wildcards.splice(index, 1);
            }
        }
    }

    const diagnostics = {
        timings: {} as Record<string, number[]>,
        errors: {} as Record<string, number>,
        callbacks(kind?: HookKind) {
            const count = (
                map: Map<string, CallbackEntry[]>,
                wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[]
            ) =>
                Array.from(map.values()).reduce(
                    (total, entries) => total + entries.length,
                    0
                ) + wildcards.length;

            if (!kind) {
                return (
                    count(actions, actionWildcards) +
                    count(filters, filterWildcards)
                );
            }

            return kind === 'action'
                ? count(actions, actionWildcards)
                : count(filters, filterWildcards);
        },
    };

    function recordTiming(name: string, ms: number) {
        if (Object.hasOwn(diagnostics.timings, name)) {
            const samples = diagnostics.timings[name]!;
            if (samples.length >= HOOK_DIAGNOSTIC_SAMPLE_CAPACITY) {
                samples.shift();
            }
            samples.push(ms);
            return;
        }
        if (
            Object.keys(diagnostics.timings).length >=
            HOOK_DIAGNOSTIC_SERIES_CAPACITY
        ) {
            return;
        }
        diagnostics.timings[name] = [ms];
    }

    function recordError(name: string) {
        if (Object.hasOwn(diagnostics.errors, name)) {
            diagnostics.errors[name] = diagnostics.errors[name]! + 1;
            return;
        }
        if (
            Object.keys(diagnostics.errors).length >=
            HOOK_DIAGNOSTIC_SERIES_CAPACITY
        ) {
            return;
        }
        diagnostics.errors[name] = 1;
    }

    function logCallbackError(error: unknown, name: string, isFilter: boolean) {
        if (!options.logCallbackError) {
            return;
        }

        try {
            options.logCallbackError({
                error,
                isFilter,
                name,
            });
        } catch {
            // Logging failures must never break hook execution.
        }
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
        // The surrounding try/catch cannot observe a later rejection, so
        // consume it here and route it through the same error reporting.
        consumeThenableRejection(thenable, (error) => {
            recordError(name);
            logCallbackError(error, name, isFilter);
        });
    }

    async function runAsyncBody(
        callbacks: CallbackEntry[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue?: unknown
    ) {
        let value = initialValue;
        for (const { fn, priority, acceptedArgs } of callbacks) {
            if (priorityAls) {
                const store = priorityAls.getStore();
                if (store && store.length > 0) {
                    store[store.length - 1] = priority;
                }
            }
            const start = performance.now();
            try {
                if (isFilter) {
                    const callArgs = sliceFilterCallArgs(
                        value,
                        args,
                        acceptedArgs
                    );
                    value = await invokeWithFallbackPriority(
                        priority,
                        () => (fn as (...a: unknown[]) => unknown)(...callArgs)
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
        callbacks: CallbackEntry[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue?: unknown
    ) {
        const firstPriority =
            callbacks.length > 0 ? callbacks[0]!.priority : DEFAULT_PRIORITY;
        if (priorityAls) {
            const parent = priorityAls.getStore();
            const seed =
                parent && parent.length > 0
                    ? [...parent, firstPriority]
                    : [firstPriority];
            return priorityAls.run(seed, () =>
                runAsyncBody(callbacks, name, args, isFilter, initialValue)
            );
        }
        return runAsyncBody(callbacks, name, args, isFilter, initialValue);
    }

    function runSyncBody(
        callbacks: CallbackEntry[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue?: unknown
    ) {
        let value = initialValue;
        for (const { fn, priority, acceptedArgs } of callbacks) {
            if (priorityAls) {
                const store = priorityAls.getStore();
                if (store && store.length > 0) {
                    store[store.length - 1] = priority;
                }
            } else {
                currentPriorityStack[currentPriorityStack.length - 1] =
                    priority;
            }
            const start = performance.now();
            try {
                if (isFilter) {
                    const callArgs = sliceFilterCallArgs(
                        value,
                        args,
                        acceptedArgs
                    );
                    const next = (fn as (...a: unknown[]) => unknown)(
                        ...callArgs
                    );
                    if (isThenable(next)) {
                        reportSyncThenable(next, name, true);
                        // Keep previous value; sync APIs must not accept thenables.
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
        callbacks: CallbackEntry[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue?: unknown
    ) {
        const firstPriority =
            callbacks.length > 0 ? callbacks[0]!.priority : DEFAULT_PRIORITY;
        if (priorityAls) {
            const parent = priorityAls.getStore();
            const seed =
                parent && parent.length > 0
                    ? [...parent, firstPriority]
                    : [firstPriority];
            return priorityAls.run(seed, () =>
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

    const engine: HookEngine = {
        addFilter(name, fn, priority, acceptedArgs?) {
            add(filters, filterWildcards, name, fn, priority, acceptedArgs);
        },
        removeFilter(name, fn, priority) {
            remove(filters, filterWildcards, name, fn, priority);
        },
        async applyFilters(name, value, ...args) {
            const callbacks = getMatching(filters, filterWildcards, name);
            if (callbacks.length === 0) {
                return value;
            }

            return (await callAsync(
                callbacks,
                name,
                args,
                true,
                value
            )) as typeof value;
        },
        applyFiltersSync(name, value, ...args) {
            const callbacks = getMatching(filters, filterWildcards, name);
            if (callbacks.length === 0) {
                return value;
            }

            return callSync(callbacks, name, args, true, value) as typeof value;
        },
        addAction(name, fn, priority, acceptedArgs?) {
            add(actions, actionWildcards, name, fn, priority, acceptedArgs);
        },
        removeAction(name, fn, priority) {
            remove(actions, actionWildcards, name, fn, priority);
        },
        async doAction(name, ...args) {
            const callbacks = getMatching(actions, actionWildcards, name);
            if (callbacks.length === 0) {
                return;
            }

            await callAsync(callbacks, name, args, false);
        },
        doActionSync(name, ...args) {
            const callbacks = getMatching(actions, actionWildcards, name);
            if (callbacks.length === 0) {
                return;
            }

            callSync(callbacks, name, args, false);
        },
        hasFilter(name?: string, fn?: HookFn) {
            return has(filters, filterWildcards, name, fn);
        },
        hasAction(name?: string, fn?: HookFn) {
            return has(actions, actionWildcards, name, fn);
        },
        removeAllCallbacks(priority?: number) {
            removeAll(actions, actionWildcards, priority);
            removeAll(filters, filterWildcards, priority);
        },
        currentPriority() {
            const store = priorityAls?.getStore();
            if (store && store.length > 0) {
                return store[store.length - 1]!;
            }
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
                    // Ensure async onceAction participates in doAction awaiting
                    // and records failures instead of leaving unhandled rejections.
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
        on(name, fn, opts) {
            const kind = resolveOnKind(name, opts?.kind);
            const priority = opts?.priority;
            const acceptedArgs = opts?.acceptedArgs;

            if (kind === 'filter') {
                engine.addFilter(name, fn, priority, acceptedArgs);
                return () => engine.removeFilter(name, fn, priority);
            }

            engine.addAction(name, fn, priority, acceptedArgs);
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
    };

    return engine;
}
