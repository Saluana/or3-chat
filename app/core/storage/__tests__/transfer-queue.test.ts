import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileTransfer } from '~~/shared/storage/types';
import type { FileMeta } from '~/db/schema';
import { FileTransferQueue } from '../transfer-queue';
import type { ObjectStorageProvider } from '../types';

const hookState = vi.hoisted(() => ({
    applyFilters: vi.fn(async (_name: string, payload: unknown) => payload),
    doAction: vi.fn(async () => undefined),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => hookState,
}));

class TableStub<T extends Record<string, any>> {
    private rows = new Map<string, T>();

    constructor(
        private keyField: keyof T,
        initial: T[] = []
    ) {
        initial.forEach((row) => {
            this.rows.set(String(row[this.keyField]), { ...row });
        });
    }

    async put(row: T): Promise<void> {
        this.rows.set(String(row[this.keyField]), { ...row });
    }

    async get(key: string): Promise<T | undefined> {
        return this.rows.get(String(key));
    }

    async update(key: string, patch: Partial<T>): Promise<number> {
        const existing = this.rows.get(String(key));
        if (!existing) return 0;
        this.rows.set(String(key), { ...existing, ...patch });
        return 1;
    }

    where(field: string) {
        return {
            equals: (value: unknown) => {
                const matches = Array.from(this.rows.values()).filter((row) => {
                    if (field === 'state') {
                        return row.state === value;
                    }
                    if (field === '[hash+direction]') {
                        const tuple = value as [string, string];
                        return row.hash === tuple[0] && row.direction === tuple[1];
                    }
                    return false;
                });
                return {
                    toArray: async () => matches,
                };
            },
        };
    }

    dump(): Map<string, T> {
        return this.rows;
    }
}

function createDbStub(meta: FileMeta, blob: Blob) {
    return {
        file_transfers: new TableStub<FileTransfer>('id'),
        file_meta: new TableStub<FileMeta>('hash', [meta]),
        file_blobs: new TableStub<{ hash: string; blob: Blob }>('hash', [
            { hash: meta.hash, blob },
        ]),
        transaction: async (
            _mode: string,
            _table: unknown,
            fn: () => Promise<void>
        ) => {
            await fn();
        },
    };
}

describe('FileTransferQueue', () => {
    beforeEach(() => {
        hookState.applyFilters.mockClear();
        hookState.doAction.mockClear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('marks uploads as failed after max attempts', async () => {
        const meta: FileMeta = {
            hash: `sha256:${'a'.repeat(64)}`,
            name: 'test.png',
            mime_type: 'image/png',
            kind: 'image',
            size_bytes: 10,
            ref_count: 1,
            created_at: 1,
            updated_at: 1,
            deleted: false,
            clock: 0,
        };

        const blob = new Blob(['hello']);
        const db = createDbStub(meta, blob);
        const provider: ObjectStorageProvider = {
            id: 'mock',
            displayName: 'Mock',
            supports: { presignedUpload: true, presignedDownload: true },
            async getPresignedUploadUrl() {
                return { url: 'https://example.com/upload', expiresAt: Date.now() };
            },
            async getPresignedDownloadUrl() {
                return { url: 'https://example.com/download', expiresAt: Date.now() };
            },
        };

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('', { status: 500 }))
        );

        const queue = new FileTransferQueue(db as any, provider, {
            maxAttempts: 1,
        });
        queue.setWorkspaceId('workspace-1');

        const transfer = await queue.enqueue(meta.hash, 'upload');
        expect(transfer).not.toBeNull();

        await expect(queue.waitForTransfer(transfer!.id)).rejects.toThrow(
            'Upload failed'
        );

        const stored = db.file_transfers.dump().get(transfer!.id);
        expect(stored?.state).toBe('failed');
        expect(stored?.attempts).toBe(1);
    });
});
