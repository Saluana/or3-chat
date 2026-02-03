/**
 * @module server/hooks/hook-engine.ts
 *
 * Purpose:
 * Core event dispatch and data transformation engine.
 * Implements a WordPress-style hook system with two primitives:
 *
 * 1. **Actions**: Fire-and-forget event bus. (e.g. "user created", "server started")
 * 2. **Filters**: Pipeline for modifying data. (e.g. "modify outgoing message", "validate config")
 *
 * Architecture:
 * - In-memory, synchronous or asynchronous execution.
 * - Priority-based execution order (lower numbers run earlier).
 * - Wildcard support (`*`) for broad listeners.
 * - Diagnostic tracking for timing and error rates.
 *
 * Invariants:
 * - Filter chains must pass the value to the next callback.
 * - Errors in callbacks are caught and logged, they do NOT crash the caller (unless fatal).
 * - Execution order is stable: Priority ASC, then Registration Order.
 */

export type HookKind = 'action' | 'filter';

type AnyFn = (...args: unknown[]) => unknown;

export interface RegisterOptions {
    priority?: number;
    acceptedArgs?: number;
}

export interface OnOptions extends RegisterOptions {
    kind?: HookKind;
}

interface CallbackEntry<F extends AnyFn = AnyFn> {
    fn: F;
    priority: number;
    id: number;
    name: string;
}

interface CompiledPattern {
    pattern: string;
    regex: RegExp;
}

function globToRegExp(glob: string): RegExp {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}

const regexCache = new Map<string, RegExp>();

function getRegex(glob: string): RegExp {
    let regex = regexCache.get(glob);
    if (!regex) {
        regex = globToRegExp(glob);
        regexCache.set(glob, regex);
    }
    return regex;
}

function sortCallbacks<T extends CallbackEntry>(arr: T[]): T[] {
    return arr.sort((a, b) => a.priority - b.priority || a.id - b.id);
}

/**
 * Purpose:
 * Public contract for interaction with the hook system.
 */
export interface HookEngine {
    /**
     * Purpose:
     * Registers a filter function to transform a value.
     *
     * @param name - The hook name (e.g., 'system.config:filter:settings').
     * @param fn - The transformation function (must return a value).
     * @param priority - Execution order (default 10). Lower runs first.
     */
    addFilter: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number,
        acceptedArgs?: number
    ) => void;

    /**
     * Purpose:
     * Unregisters a previously added filter.
     * Must pass the exact function reference used during registration.
     */
    removeFilter: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number
    ) => void;

    /**
     * Purpose:
     * Runs a value through all registered filters for a given hook name asynchronously.
     *
     * @param name - The hook name.
     * @param value - The initial value to be transformed.
     * @param args - Additional context arguments passed to filters (read-only).
     * @returns The final transformed value.
     */
    applyFilters: <T>(name: string, value: T, ...args: unknown[]) => Promise<T>;

    /**
     * Purpose:
     * Synchronous version of `applyFilters`.
     *
     * Constraints:
     * - All registered filters MUST be synchronous. If an async filter is encountered,
     *   it will return a Promise instead of the value, likely breaking the pipeline.
     */
    applyFiltersSync: <T>(name: string, value: T, ...args: unknown[]) => T;

    /**
     * Purpose:
     * Registers an action listener to observe an event.
     *
     * @param name - The hook name (e.g., 'user:action:login').
     * @param fn - The callback function (void return).
     * @param priority - Execution order (default 10).
     */
    addAction: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number,
        acceptedArgs?: number
    ) => void;

    removeAction: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number
    ) => void;

    /**
     * Purpose:
     * Triggers an action event asynchronously.
     * Awaits all listeners (sequentially by priority).
     */
    doAction: (name: string, ...args: unknown[]) => Promise<void>;

    /**
     * Purpose:
     * Triggers an action event synchronously.
     *
     * Constraints:
     * - Does not await async listeners; they execute as "fire-and-forget" promises
     *   unless the caller explicitly handles them (which this method does not).
     */
    doActionSync: (name: string, ...args: unknown[]) => void;

    /**
     * Use to check if any listeners are registered.
     * Returns `true` (or priority number) if found, `false` otherwise.
     */
    hasFilter: (name?: string, fn?: AnyFn) => boolean | number;
    hasAction: (name?: string, fn?: AnyFn) => boolean | number;

    /**
     * Nuclear option: Clears all callbacks.
     * Use with caution, mostly for testing teardown.
     */
    removeAllCallbacks: (priority?: number) => void;

    currentPriority: () => number | false;

    /**
     * Registers a one-time action listener. Automatically removes itself after first run.
     */
    onceAction: (name: string, fn: AnyFn, priority?: number) => () => void;

    /**
     * Purpose:
     * Universal registration method supporting both actions and filters.
     * Returns a disposer function for easy cleanup.
     *
     * @example
     * ```ts
     * const dispose = hooks.on('my.event', () => console.log('fired!'));
     * // ... later
     * dispose();
     * ```
     */
    on: (name: string, fn: AnyFn, opts?: OnOptions) => () => void;
    off: (disposer: () => void) => void;

    _diagnostics: {
        timings: Record<string, number[] | undefined>;
        errors: Record<string, number>;
        callbacks(actionOrFilter?: HookKind): number;
    };
}

export function createHookEngine(): HookEngine {
    const DEFAULT_PRIORITY = 10;
    let counter = 0;
    const currentPriorityStack: number[] = [];

    const actions = new Map<string, CallbackEntry[]>();
    const filters = new Map<string, CallbackEntry[]>();

    const actionWildcards: { pattern: CompiledPattern; entry: CallbackEntry }[] = [];
    const filterWildcards: { pattern: CompiledPattern; entry: CallbackEntry }[] = [];

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
                if (pattern.regex.test(name)) list.push(entry);
            }
        }
        return sortCallbacks(list);
    }

    function add(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name: string,
        fn: AnyFn,
        priority?: number
    ) {
        const p = typeof priority === 'number' ? priority : DEFAULT_PRIORITY;
        const entry: CallbackEntry = { fn, priority: p, id: ++counter, name };
        if (name.includes('*')) {
            wildcards.push({
                pattern: { pattern: name, regex: getRegex(name) },
                entry,
            });
        } else {
            const arr = map.get(name) || [];
            arr.push(entry);
            map.set(name, arr);
        }
    }

    function remove(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name: string,
        fn: AnyFn,
        priority?: number
    ) {
        const p = typeof priority === 'number' ? priority : undefined;
        if (name.includes('*')) {
            const idx = wildcards.findIndex(
                (wc) =>
                    wc.pattern.pattern === name &&
                    wc.entry.fn === fn &&
                    (p === undefined || wc.entry.priority === p)
            );
            if (idx >= 0) wildcards.splice(idx, 1);
        } else {
            const arr = map.get(name);
            if (!arr) return;
            const filtered = arr.filter(
                (e) => !(e.fn === fn && (p === undefined || e.priority === p))
            );
            if (filtered.length) map.set(name, filtered);
            else map.delete(name);
        }
    }

    function has(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name?: string,
        fn?: AnyFn
    ): boolean | number {
        if (!name) {
            return (
                Array.from(map.values()).some((a) => a.length > 0) ||
                wildcards.length > 0
            );
        }
        if (fn) {
            const arr = map.get(name) || [];
            const found = arr.find((e) => e.fn === fn);
            if (found) return found.priority;
            const wc = wildcards.find(
                (wc) => wc.pattern.pattern === name && wc.entry.fn === fn
            );
            return wc ? wc.entry.priority : false;
        }
        const arr = map.get(name) || [];
        const any =
            arr.length > 0 ||
            wildcards.some((wc) => wc.pattern.regex.test(name));
        return any;
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
        for (const [k, arr] of map) {
            const filtered = arr.filter((e) => e.priority !== priority);
            if (filtered.length) map.set(k, filtered);
            else map.delete(k);
        }
        for (let i = wildcards.length - 1; i >= 0; i--) {
            const wc = wildcards[i];
            if (!wc) continue;
            if (wc.entry.priority === priority) wildcards.splice(i, 1);
        }
    }

    const diagnostics = {
        timings: {} as Record<string, number[] | undefined>,
        errors: {} as Record<string, number>,
        callbacks(actionOrFilter?: HookKind) {
            if (!actionOrFilter) {
                const a =
                    Array.from(actions.values()).reduce((n, v) => n + v.length, 0) +
                    actionWildcards.length;
                const f =
                    Array.from(filters.values()).reduce((n, v) => n + v.length, 0) +
                    filterWildcards.length;
                return a + f;
            }
            if (actionOrFilter === 'action') {
                return (
                    Array.from(actions.values()).reduce((n, v) => n + v.length, 0) +
                    actionWildcards.length
                );
            }
            return (
                Array.from(filters.values()).reduce((n, v) => n + v.length, 0) +
                filterWildcards.length
            );
        },
    };

    function recordTiming(name: string, ms: number) {
        (diagnostics.timings[name] ||= []).push(ms);
    }

    function recordError(name: string) {
        diagnostics.errors[name] = (diagnostics.errors[name] || 0) + 1;
    }

    async function callAsync(
        cbs: CallbackEntry[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue?: unknown
    ) {
        {
            const firstPriority =
                cbs.length > 0 ? cbs[0]!.priority : DEFAULT_PRIORITY;
            currentPriorityStack.push(firstPriority);
        }
        let value = initialValue;
        for (const cb of cbs) {
            currentPriorityStack[currentPriorityStack.length - 1] = cb.priority;
            const start = performance.now();
            try {
                if (isFilter) {
                    value = await cb.fn(value, ...args);
                } else {
                    await cb.fn(...args);
                }
            } catch (e) {
                recordError(name);
                try {
                    console.error('[admin-hooks]', name, e);
                } catch {
                    /* ignore */
                }
            } finally {
                recordTiming(name, performance.now() - start);
            }
        }
        currentPriorityStack.pop();
        return value;
    }

    function callSync(
        cbs: CallbackEntry[],
        name: string,
        args: unknown[],
        isFilter: boolean,
        initialValue?: unknown
    ) {
        {
            const firstPriority =
                cbs.length > 0 ? cbs[0]!.priority : DEFAULT_PRIORITY;
            currentPriorityStack.push(firstPriority);
        }
        let value = initialValue;
        for (const cb of cbs) {
            currentPriorityStack[currentPriorityStack.length - 1] = cb.priority;
            const start = performance.now();
            try {
                if (isFilter) {
                    value = cb.fn(value, ...args);
                } else {
                    cb.fn(...args);
                }
            } catch (e) {
                recordError(name);
                try {
                    console.error('[admin-hooks]', name, e);
                } catch {
                    /* ignore */
                }
            } finally {
                recordTiming(name, performance.now() - start);
            }
        }
        currentPriorityStack.pop();
        return value;
    }

    return {
        addFilter(name, fn, priority) {
            add(filters, filterWildcards, name, fn, priority);
        },
        removeFilter(name, fn, priority) {
            remove(filters, filterWildcards, name, fn, priority);
        },
        applyFilters(name, value, ...args) {
            const cbs = getMatching(filters, filterWildcards, name);
            return callAsync(cbs, name, args, true, value) as Promise<unknown> as Promise<typeof value>;
        },
        applyFiltersSync(name, value, ...args) {
            const cbs = getMatching(filters, filterWildcards, name);
            return callSync(cbs, name, args, true, value) as typeof value;
        },
        addAction(name, fn, priority) {
            add(actions, actionWildcards, name, fn, priority);
        },
        removeAction(name, fn, priority) {
            remove(actions, actionWildcards, name, fn, priority);
        },
        doAction(name, ...args) {
            const cbs = getMatching(actions, actionWildcards, name);
            return callAsync(cbs, name, args, false) as Promise<void>;
        },
        doActionSync(name, ...args) {
            const cbs = getMatching(actions, actionWildcards, name);
            callSync(cbs, name, args, false);
        },
        hasFilter(name, fn) {
            return has(filters, filterWildcards, name, fn);
        },
        hasAction(name, fn) {
            return has(actions, actionWildcards, name, fn);
        },
        removeAllCallbacks(priority) {
            removeAll(actions, actionWildcards, priority);
            removeAll(filters, filterWildcards, priority);
        },
        currentPriority() {
            return currentPriorityStack.length
                ? currentPriorityStack[currentPriorityStack.length - 1]!
                : false;
        },
        onceAction(name, fn, priority) {
            const disposer = () => {
                this.removeAction(name, fn, priority);
            };
            this.addAction(
                name,
                async (...args: unknown[]) => {
                    disposer();
                    await fn(...args);
                },
                priority
            );
            return disposer;
        },
        on(name, fn, opts) {
            const kind =
                opts?.kind ??
                (name.includes(':filter:') ? 'filter' : 'action');
            const priority = opts?.priority;
            if (kind === 'filter') {
                this.addFilter(name, fn, priority);
                return () => this.removeFilter(name, fn, priority);
            }
            this.addAction(name, fn, priority);
            return () => this.removeAction(name, fn, priority);
        },
        off(disposer) {
            disposer();
        },
        _diagnostics: diagnostics,
    };
}
