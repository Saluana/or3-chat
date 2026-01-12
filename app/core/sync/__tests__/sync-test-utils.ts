import type { PendingOp } from '~~/shared/sync/types';

export type MemoryTable<T extends Record<string, unknown>> = {
    __rows: Map<string, T>;
    get: (id: string) => Promise<T | undefined>;
    put: (row: T) => Promise<void>;
    update: (id: string, patch: Partial<T>) => Promise<number>;
};

export function createMemoryTable<T extends Record<string, unknown>>(
    pkField: keyof T,
    initial: T[] = []
): MemoryTable<T> {
    const rows = new Map<string, T>();
    for (const row of initial) {
        const key = String(row[pkField]);
        rows.set(key, { ...row });
    }
    return {
        __rows: rows,
        async get(id: string) {
            return rows.get(id);
        },
        async put(row: T) {
            const key = String(row[pkField]);
            rows.set(key, { ...row });
        },
        async update(id: string, patch: Partial<T>) {
            const existing = rows.get(id);
            if (!existing) return 0;
            rows.set(id, { ...existing, ...patch });
            return 1;
        },
    };
}

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
                    return {
                        async sortBy(sortField: keyof PendingOp) {
                            return matchField(field, value).sort((a, b) => {
                                const left = a[sortField] as number;
                                const right = b[sortField] as number;
                                return left - right;
                            });
                        },
                        async count() {
                            return matchField(field, value).length;
                        },
                        async toArray() {
                            return matchField(field, value);
                        },
                        async modify(patch: Partial<PendingOp>) {
                            for (const row of matchField(field, value)) {
                                rows.set(row.id, { ...row, ...patch });
                            }
                        },
                    };
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
        async put(op: PendingOp) {
            rows.set(op.id, { ...op });
        },
    };
}

export function createMockDb<T extends Record<string, unknown>>(tables: T) {
    return {
        ...tables,
        table(name: string) {
            return (tables as Record<string, unknown>)[name] ?? null;
        },
    };
}
