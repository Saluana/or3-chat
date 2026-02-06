import type { PendingOp } from '~~/shared/sync/types';

/**
 * Internal API.
 *
 * Purpose:
 * Minimal in-memory table interface used to unit test sync components without Dexie.
 *
 * Constraints:
 * - Only implements the methods exercised by HookBridge/OutboxManager tests
 */
export type MemoryTable<T extends Record<string, unknown>> = {
    __rows: Map<string, T>;
    get: (id: string) => Promise<T | undefined>;
    bulkGet: (ids: string[]) => Promise<(T | undefined)[]>;
    put: (row: T) => Promise<void>;
    add: (row: T) => Promise<string>;
    update: (id: string, patch: Partial<T>) => Promise<number>;
    hook: (event: string, callback: Function) => void;
};

/**
 * Internal API.
 *
 * Purpose:
 * Create a Dexie-like in-memory table implementation for tests.
 *
 * Behavior:
 * - Stores rows in a Map keyed by the provided primary key field
 * - Supports a small hook system to simulate Dexie `creating` hooks
 *
 * Constraints:
 * - Not a full Dexie emulator; intended only for sync unit tests
 */
export function createMemoryTable<T extends Record<string, unknown>>(
    pkField: keyof T,
    initial: T[] = []
): MemoryTable<T> {
    const rows = new Map<string, T>();
    const hooks = new Map<string, Function[]>();

    for (const row of initial) {
        const key = String(row[pkField]);
        rows.set(key, { ...row });
    }

    const triggerHooks = (event: string, ...args: unknown[]) => {
        const h = hooks.get(event) || [];
        for (const cb of h) {
            cb(...args);
        }
    };

    return {
        __rows: rows,
        async get(id: string) {
            return rows.get(id);
        },
        async bulkGet(ids: string[]) {
            return ids.map(id => rows.get(id));
        },
        async put(row: T) {
            const key = String(row[pkField]);
            rows.set(key, { ...row });
        },
        async add(row: T) {
            const key = String(row[pkField] ?? crypto.randomUUID());
            const newRow = { ...row, [pkField]: key } as T;
            
            // Mock transaction for HookBridge
            const tx = {
                table: (name: string) => {
                    // This is a bit of a hack but needed for HookBridge to find pending_ops/tombstones
                    // when called inside a hook. We'll rely on global mock DB for this.
                    return (global as Record<string, unknown>).__MOCK_DB__ ? (
                        (global as unknown as Record<string, Record<string, unknown>>).__MOCK_DB__ as { table: (n: string) => unknown }
                    ).table(name) : null;
                }
            };

            triggerHooks('creating', key, newRow, tx);
            rows.set(key, newRow);
            return key;
        },
        async update(id: string, patch: Partial<T>) {
            const existing = rows.get(id);
            if (!existing) return 0;
            const updated = { ...existing, ...patch };
            rows.set(id, updated);
            return 1;
        },
        hook(event: string, callback: Function) {
            if (!hooks.has(event)) hooks.set(event, []);
            hooks.get(event)!.push(callback);
        },
    };
}

/**
 * Internal API.
 *
 * Purpose:
 * Create a minimal `pending_ops` table mock with the subset of query APIs used by sync tests.
 */
export function createPendingOpsTable(initial: PendingOp[] = []) {
    const rows = new Map<string, PendingOp>();
    for (const op of initial) {
        rows.set(op.id, { ...op });
    }
    const list = () => Array.from(rows.values());
    const matchField = <K extends keyof PendingOp>(field: K, value: PendingOp[K]) =>
        list().filter((row) => row[field] === value);

    return {
        __rows: rows,
        where<K extends keyof PendingOp>(field: K) {
            return {
                equals(value: PendingOp[K]) {
                    const getMatches = () => matchField(field, value);

                    const collection = {
                        async sortBy(sortField: keyof PendingOp) {
                            return getMatches().sort((a, b) => {
                                const left = a[sortField] as number;
                                const right = b[sortField] as number;
                                return left - right;
                            });
                        },
                        async count() {
                            return getMatches().length;
                        },
                        async toArray() {
                            return getMatches();
                        },
                        async modify(patch: Partial<PendingOp>) {
                            for (const row of getMatches()) {
                                rows.set(row.id, { ...row, ...patch });
                            }
                        },
                        limit(n: number) {
                            return {
                                ...collection,
                                async toArray() {
                                    return getMatches().slice(0, n);
                                },
                            };
                        },
                    };
                    return collection;
                },
            };
        },
        async bulkPut(ops: PendingOp[]) {
            for (const op of ops) {
                rows.set(op.id, { ...op });
            }
        },
        async delete(id: string) {
            rows.delete(id);
        },
        async bulkDelete(ids: string[]) {
            for (const id of ids) {
                rows.delete(id);
            }
        },
        async put(op: PendingOp) {
            rows.set(op.id, { ...op });
        },
    };
}

/**
 * Internal API.
 *
 * Purpose:
 * Create a minimal DB object with `table()` and `transaction()` used by sync unit tests.
 *
 * Constraints:
 * - Exposes the db on `global.__MOCK_DB__` to support HookBridge hook callbacks
 */
export function createMockDb<T extends Record<string, unknown>>(tables: T) {
    const db = {
        ...tables,
        name: 'mock-db',
        table(name: string) {
            return (tables as Record<string, unknown>)[name] ?? null;
        },
        async transaction(mode: string, tableNames: string[], callback: (tx: { mode: string; tableNames: string[]; table: (n: string) => unknown }) => Promise<unknown>) {
            const tx = {
                mode,
                tableNames,
                table: (name: string) => db.table(name),
            };
            return callback(tx);
        },
    };
    // Expose globally for the 'add' hook hack
    (global as Record<string, unknown>).__MOCK_DB__ = db;
    return db;
}
