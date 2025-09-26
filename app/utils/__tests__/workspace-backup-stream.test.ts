import { Blob } from 'node:buffer';
import { describe, it, expect, vi } from 'vitest';

vi.mock('dexie', () => ({
    default: {
        getByKeyPath: (row: Record<string, any>, keyPath?: string) => {
            if (!keyPath) return undefined;
            if (keyPath.includes('.')) {
                return keyPath.split('.').reduce((value, part) => {
                    return value?.[part];
                }, row as any);
            }
            return row[keyPath];
        },
    },
}));

import { streamWorkspaceExportToWritable } from '~/utils/workspace-backup-stream';

interface TableRow {
    [key: string]: any;
}

interface TableStub {
    name: string;
    schema: { primKey: { keyPath: string | null; name: string } };
    count(): Promise<number>;
    limit(count: number): CollectionStub;
    where(selector: string): {
        above(key: any): { limit(count: number): CollectionStub };
    };
}

interface CollectionStub {
    toArray(): Promise<TableRow[]>;
    primaryKeys(): Promise<any[]>;
}

function createCollection(
    table: TableStubImpl,
    startIndex: number,
    count: number
): CollectionStub {
    return {
        async toArray() {
            return table.rows.slice(startIndex, startIndex + count);
        },
        async primaryKeys() {
            return table.rows
                .slice(startIndex, startIndex + count)
                .map((row) => table.getKey(row));
        },
    };
}

class TableStubImpl implements TableStub {
    public readonly schema: TableStub['schema'];

    constructor(
        public readonly name: string,
        private readonly keyPath: string | null,
        public readonly rows: TableRow[]
    ) {
        this.schema = {
            primKey: {
                keyPath,
                name: keyPath ?? '_id',
            },
        };
    }

    async count(): Promise<number> {
        return this.rows.length;
    }

    limit(count: number): CollectionStub {
        return createCollection(this, 0, count);
    }

    where(selector: string) {
        if (selector !== ':id') {
            throw new Error('Unsupported selector in stub');
        }
        return {
            above: (key: any) => {
                const startIndex = this.rows.findIndex((row) => {
                    return this.getKey(row) > key;
                });
                const resolvedIndex = startIndex === -1 ? this.rows.length : startIndex;
                return {
                    limit: (count: number) =>
                        createCollection(this, resolvedIndex, count),
                };
            },
        };
    }

    getKey(row: TableRow) {
        if (!this.keyPath) return undefined;
        return row[this.keyPath];
    }
}

describe('workspace backup export stream', () => {
    it('splits large file blobs into manageable chunks', async () => {
        const blobs = Array.from({ length: 3 }, (_, idx) => ({
            hash: `hash-${idx}`,
            blob: new Blob([new Uint8Array(300_000).fill(97)]),
        }));

        const fileBlobsTable = new TableStubImpl('file_blobs', 'hash', blobs);

        const tables = [fileBlobsTable];
        const db = {
            name: 'test-db',
            verno: 1,
            tables,
            table(name: string) {
                const found = tables.find((table) => table.name === name);
                if (!found) {
                    throw new Error(`Unknown table ${name}`);
                }
                return found;
            },
        } as any;

        const writes: Uint8Array[] = [];
        const writer = {
            write: vi.fn(async (chunk: Uint8Array) => {
                writes.push(chunk);
            }),
            close: vi.fn(async () => {}),
            releaseLock: vi.fn(() => {}),
        };

        const progressUpdates: Array<{
            completedRows: number;
            totalRows: number;
        }> = [];

        await streamWorkspaceExportToWritable({
            db,
            writable: writer as any,
            chunkSize: 500,
            onProgress: (progress) => {
                progressUpdates.push({
                    completedRows: progress.completedRows,
                    totalRows: progress.totalRows,
                });
            },
        });

        expect(writer.close).toHaveBeenCalledTimes(1);
        expect(writer.releaseLock).toHaveBeenCalledTimes(1);

        const decoder = new TextDecoder();
        const serialized = writes
            .map((chunk) => decoder.decode(chunk))
            .join('')
            .trim();

        const lines = serialized
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line));

        const rowsEntries = lines.filter(
            (entry) => entry.type === 'rows' && entry.table === 'file_blobs'
        );

        expect(rowsEntries).toHaveLength(3);
        for (const entry of rowsEntries) {
            expect(entry.rows).toHaveLength(1);
        }

        expect(progressUpdates.length).toBeGreaterThanOrEqual(3);
        const finalProgress = progressUpdates.at(-1)!;
        expect(finalProgress.completedRows).toBe(3);
        expect(finalProgress.totalRows).toBe(3);
    });
});
