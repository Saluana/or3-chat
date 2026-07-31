import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    evictWorkspaceDb,
    getDb,
    setActiveWorkspaceDb,
} from '../client';
import type { FileMeta, Message } from '../schema';
import {
    addFilesToMessage,
    removeFileFromMessage,
} from '../message-files';
import { parseFileHashes } from '../files-util';

const hooks = vi.hoisted(() => {
    const filters = new Map<
        string,
        Array<(value: unknown) => unknown | Promise<unknown>>
    >();
    return {
        addFilter(
            name: string,
            filter: (value: unknown) => unknown | Promise<unknown>
        ) {
            const registered = filters.get(name) ?? [];
            registered.push(filter);
            filters.set(name, registered);
        },
        clear() {
            filters.clear();
        },
        async applyFilters(name: string, initial: unknown) {
            let value = initial;
            for (const filter of filters.get(name) ?? []) {
                value = await filter(value);
            }
            return value;
        },
        async doAction() {},
    };
});

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => hooks,
}));

const TEST_HASH = `sha256:${'a'.repeat(64)}`;

vi.mock('~/utils/hash', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/utils/hash')>();
    return {
        ...actual,
        computeFileHash: vi.fn(async () => TEST_HASH),
    };
});

let workspaceId = '';

function message(id: string, fileHashes?: string[]): Message {
    return {
        id,
        thread_id: 'thread-1',
        role: 'user',
        index: 0,
        created_at: 1,
        updated_at: 1,
        deleted: false,
        clock: 0,
        file_hashes: fileHashes ? JSON.stringify(fileHashes) : undefined,
    };
}

function fileMeta(
    hash = TEST_HASH,
    refCount = 0
): FileMeta {
    return {
        hash,
        name: 'attachment.txt',
        mime_type: 'text/plain',
        kind: 'image',
        size_bytes: 4,
        ref_count: refCount,
        created_at: 1,
        updated_at: 1,
        deleted: false,
        clock: 0,
    };
}

async function storedHashes(messageId: string): Promise<string[]> {
    const stored = await getDb().messages.get(messageId);
    return parseFileHashes(stored?.file_hashes);
}

beforeEach(async () => {
    hooks.clear();
    workspaceId = `file-ref-count-${crypto.randomUUID()}`;
    const db = setActiveWorkspaceDb(workspaceId);
    await db.open();
});

afterEach(async () => {
    const dbName = `or3-db-${workspaceId}`;
    setActiveWorkspaceDb(null);
    evictWorkspaceDb(workspaceId);
    await Dexie.delete(dbName);
});

describe('message file ref_count integrity', () => {
    it('increments a hash attachment once and keeps duplicate attachment idempotent', async () => {
        const db = getDb();
        await db.messages.put(message('message-1'));
        await db.file_meta.put(fileMeta());

        await addFilesToMessage('message-1', [
            { type: 'hash', hash: TEST_HASH },
        ]);
        await addFilesToMessage('message-1', [
            { type: 'hash', hash: TEST_HASH },
        ]);

        expect(await storedHashes('message-1')).toEqual([TEST_HASH]);
        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(1);
    });

    it('reconciles a hook-pruned Blob addition back to zero references', async () => {
        const db = getDb();
        await db.messages.put(message('message-1'));
        hooks.addFilter(
            'db.messages.files.validate:filter:hashes',
            () => []
        );

        await addFilesToMessage('message-1', [
            {
                type: 'blob',
                blob: new Blob(['same']),
                name: 'attachment.txt',
            },
        ]);

        expect(await storedHashes('message-1')).toEqual([]);
        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(0);
        expect(await db.file_blobs.count()).toBe(1);
    });

    it('serializes concurrent identical Blob creation into one row with one count per live edge', async () => {
        const db = getDb();
        await db.messages.bulkPut([
            message('message-1'),
            message('message-2'),
        ]);
        const blob = new Blob(['same']);

        await Promise.all([
            addFilesToMessage('message-1', [
                { type: 'blob', blob, name: 'one.txt' },
            ]),
            addFilesToMessage('message-2', [
                { type: 'blob', blob, name: 'two.txt' },
            ]),
        ]);

        expect(await db.file_meta.count()).toBe(1);
        expect(await db.file_blobs.count()).toBe(1);
        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(2);
        expect(await storedHashes('message-1')).toEqual([TEST_HASH]);
        expect(await storedHashes('message-2')).toEqual([TEST_HASH]);
    });

    it('decrements once per removed live edge and ignores repeated removal', async () => {
        const db = getDb();
        await db.messages.bulkPut([
            message('message-1', [TEST_HASH]),
            message('message-2', [TEST_HASH]),
        ]);
        await db.file_meta.put(fileMeta(TEST_HASH, 2));

        await removeFileFromMessage('message-1', TEST_HASH);
        await removeFileFromMessage('message-1', TEST_HASH);

        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(1);
        expect(await storedHashes('message-1')).toEqual([]);

        await removeFileFromMessage('message-2', TEST_HASH);

        expect((await db.file_meta.get(TEST_HASH))?.ref_count).toBe(0);
        expect(await storedHashes('message-2')).toEqual([]);
    });
});
