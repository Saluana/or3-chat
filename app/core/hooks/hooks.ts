import { reportError, err } from '~/utils/errors';
// Lightweight, type-safe hook engine for Nuxt/Vue apps
// - Supports actions (side-effects) and filters (value transform)
// - Priority scheduling (lower runs earlier)
// - Sync/async execution APIs
// - Error and timing wrappers
// - Optional wildcard matching via simple glob to RegExp

export type HookKind = 'action' | 'filter';

// Note: AnyFn uses `any` intentionally for runtime flexibility. Type safety is enforced
// at the typed wrapper layer (typed-hooks.ts) which provides compile-time guarantees.
type AnyFn = (...args: any[]) => any;

export interface RegisterOptions {
    priority?: number; // default 10
    acceptedArgs?: number; // reserved for compatibility, not used
}

export interface OnOptions extends RegisterOptions {
    kind?: HookKind;
}

interface CallbackEntry<F extends AnyFn = AnyFn> {
    fn: F;
    priority: number;
    id: number; // tiebreaker to preserve insertion order
    name: string; // original name/pattern used to register
}

interface CompiledPattern {
    pattern: string;
    regex: RegExp;
}

function globToRegExp(glob: string): RegExp {
    // Escape regex special chars, then replace '*' with '.*'
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}

function sortCallbacks<T extends CallbackEntry>(arr: T[]): T[] {
    return arr.sort((a, b) => a.priority - b.priority || a.id - b.id);
}

export interface HookEngine {
    // filters
    addFilter: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number,
        acceptedArgs?: number
    ) => void;
    removeFilter: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number
    ) => void;
    applyFilters: <T>(name: string, value: T, ...args: unknown[]) => Promise<T>;
    applyFiltersSync: <T>(name: string, value: T, ...args: unknown[]) => T;

    // actions
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
    doAction: (name: string, ...args: unknown[]) => Promise<void>;
    doActionSync: (name: string, ...args: unknown[]) => void;

    // utils
    hasFilter: (name?: string, fn?: AnyFn) => boolean | number;
    hasAction: (name?: string, fn?: AnyFn) => boolean | number;
    removeAllCallbacks: (priority?: number) => void;
    currentPriority: () => number | false;

    // ergonomics
    onceAction: (name: string, fn: AnyFn, priority?: number) => () => void;
    on: (name: string, fn: AnyFn, opts?: OnOptions) => () => void; // disposer
    off: (disposer: () => void) => void;

    // diagnostics (best-effort)
    _diagnostics: {
        timings: Record<string, number[]>; // name -> array of durations (ms)
        errors: Record<string, number>; // name -> error count
        callbacks(actionOrFilter?: HookKind): number; // total callbacks registered
    };
}

export function createHookEngine(): HookEngine {
    const DEFAULT_PRIORITY = 10;
    let counter = 0; // id tiebreaker
    const currentPriorityStack: number[] = [];

    // Separate stores for actions and filters
    const actions = new Map<string, CallbackEntry[]>();
    const filters = new Map<string, CallbackEntry[]>();

    // Wildcard registrations are stored separately with compiled regex for fast matching
    const actionWildcards: {
        pattern: CompiledPattern;
        entry: CallbackEntry;
    }[] = [];
    const filterWildcards: {
        pattern: CompiledPattern;
        entry: CallbackEntry;
    }[] = [];

    // Helpers to get matching callbacks (exact + wildcards)
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
                pattern: { pattern: name, regex: globToRegExp(name) },
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
            // any callbacks at all?
            return (
                Array.from(map.values()).some((a) => a.length > 0) ||
                wildcards.length > 0
            );
        }
        if (fn) {
            const arr = map.get(name) || [];
            const found = arr.find((e) => e.fn === fn);
            if (found) return found.priority;
            // also check wildcards matching the same original pattern string
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
            if (wc && wc.entry.priority === priority) wildcards.splice(i, 1);
        }
    }

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
        try {
            let value = initialValue;
            for (const { fn, priority } of cbs) {
                // Maintain current priority during execution
                if (currentPriorityStack.length)
                    currentPriorityStack[currentPriorityStack.length - 1] =
                        priority;
                const start =
                    typeof performance !== 'undefined' && performance.now
                        ? performance.now()
                        : Date.now();
                try {
                    if (isFilter) {
                        value = await fn(value, ...args);
                    } else {
                        await fn(...args);
                    }
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error(
                        `[hooks] Error in ${
                            isFilter ? 'filter' : 'action'
                        } "${name}":`,
                        err
                    );
                    recordError(name);
                } finally {
                    const end =
                        typeof performance !== 'undefined' && performance.now
                            ? performance.now()
                            : Date.now();
                    recordTiming(name, end - start);
                }
            }
            return value;
        } finally {
            currentPriorityStack.pop();
        }
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
        try {
            let value = initialValue;
            for (const { fn, priority } of cbs) {
                if (currentPriorityStack.length)
                    currentPriorityStack[currentPriorityStack.length - 1] =
                        priority;
                const start =
                    typeof performance !== 'undefined' && performance.now
                        ? performance.now()
                        : Date.now();
                try {
                    if (isFilter) {
                        value = fn(value, ...args);
                    } else {
                        fn(...args);
                    }
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error(
                        `[hooks] Error in ${
                            isFilter ? 'filter' : 'action'
                        } "${name}":`,
                        err
                    );
                    recordError(name);
                } finally {
                    const end =
                        typeof performance !== 'undefined' && performance.now
                            ? performance.now()
                            : Date.now();
                    recordTiming(name, end - start);
                }
            }
            return value;
        } finally {
            currentPriorityStack.pop();
        }
    }

    const diagnostics = {
        timings: {} as Record<string, number[]>,
        errors: {} as Record<string, number>,
        callbacks(kind?: HookKind) {
            const count = (
                map: Map<string, CallbackEntry[]>,
                wc: { pattern: CompiledPattern; entry: CallbackEntry }[]
            ) =>
                Array.from(map.values()).reduce((acc, a) => acc + a.length, 0) +
                wc.length;
            if (!kind)
                return (
                    count(actions, actionWildcards) +
                    count(filters, filterWildcards)
                );
            return kind === 'action'
                ? count(actions, actionWildcards)
                : count(filters, filterWildcards);
        },
    };

    const engine: HookEngine = {
        // filters
        addFilter(name, fn, priority, _acceptedArgs) {
            add(filters, filterWildcards, name, fn, priority);
        },
        removeFilter(name, fn, priority) {
            remove(filters, filterWildcards, name, fn, priority);
        },
        async applyFilters(name, value, ...args) {
            const cbs = getMatching(filters, filterWildcards, name);
            if (cbs.length === 0) return value;
            return (await callAsync(cbs, name, args, true, value)) as typeof value;
        },
        applyFiltersSync(name, value, ...args) {
            const cbs = getMatching(filters, filterWildcards, name);
            if (cbs.length === 0) return value;
            return callSync(cbs, name, args, true, value) as typeof value;
        },

        // actions
        addAction(name, fn, priority, _acceptedArgs) {
            add(actions, actionWildcards, name, fn, priority);
        },
        removeAction(name, fn, priority) {
            remove(actions, actionWildcards, name, fn, priority);
        },
        async doAction(name, ...args) {
            const cbs = getMatching(actions, actionWildcards, name);
            if (cbs.length === 0) return;
            await callAsync(cbs, name, args, false);
        },
        doActionSync(name, ...args) {
            const cbs = getMatching(actions, actionWildcards, name);
            if (cbs.length === 0) return;
            callSync(cbs, name, args, false);
        },

        // utils
        hasFilter(name?: string, fn?: AnyFn) {
            return has(filters, filterWildcards, name, fn);
        },
        hasAction(name?: string, fn?: AnyFn) {
            return has(actions, actionWildcards, name, fn);
        },
        removeAllCallbacks(priority?: number) {
            removeAll(actions, actionWildcards, priority);
            removeAll(filters, filterWildcards, priority);
        },
        currentPriority() {
            return currentPriorityStack.length
                ? currentPriorityStack[currentPriorityStack.length - 1]!
                : false;
        },

        // ergonomics
        onceAction(name: string, fn: AnyFn, priority?: number) {
            const wrapper = (...args: unknown[]) => {
                try {
                    fn(...args);
                } finally {
                    engine.removeAction(name, wrapper, priority);
                }
            };
            engine.addAction(name, wrapper, priority);
            return () => engine.removeAction(name, wrapper, priority);
        },
        on(name: string, fn: AnyFn, opts?: OnOptions) {
            const kind = opts?.kind ?? 'action';
            const priority = opts?.priority;
            if (kind === 'filter') engine.addFilter(name, fn, priority);
            else engine.addAction(name, fn, priority);
            return () => {
                if (kind === 'filter') engine.removeFilter(name, fn, priority);
                else engine.removeAction(name, fn, priority);
            };
        },
        off(disposer: () => void) {
            try {
                disposer();
            } catch (e) {
                // Disposer failures are non-critical; log silently
                reportError(err('ERR_INTERNAL', 'hook disposer failed'), {
                    silent: true,
                    tags: { domain: 'hooks', stage: 'off' },
                });
            }
        },

        _diagnostics: diagnostics,
    };

    return engine;
}

// HMR cleanup: prevent diagnostics from growing unbounded across reloads
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        // No need to clear the singleton hook engine itself (it's meant to persist),
        // but we should prevent diagnostic arrays from growing unbounded.
        // The global singleton is stored in plugins/hooks.client.ts as g.__NUXT_HOOKS__.
        // We'll access and clear the diagnostics if it exists.
        const g = globalThis as { __NUXT_HOOKS__?: HookEngine };
        if (g.__NUXT_HOOKS__?._diagnostics) {
            g.__NUXT_HOOKS__._diagnostics.timings = {};
            g.__NUXT_HOOKS__._diagnostics.errors = {};
        }
    });
}

// Convenience type for imports in .d.ts
export type { AnyFn as HookFn };
