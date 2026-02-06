import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import { getWriteTxTableNames, nowSec } from '~/db/util';
import { HookBridge, _resetHookBridge } from '../hook-bridge';
import { _resetHLC } from '../hlc';

const hooksMock = vi.hoisted(() => ({
    doAction: vi.fn(async () => undefined),
    applyFiltersSync: vi.fn((_: string, value: string[]) => value),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: hooksMock.doAction,
        _engine: {
            applyFiltersSync: hooksMock.applyFiltersSync,
        },
    }),
}));

describe('atomic sync capture integration', () => {
    let db: Or3DB;
    let bridge: HookBridge;

    beforeEach(async () => {
        hooksMock.doAction.mockClear();
        hooksMock.applyFiltersSync.mockClear();
        _resetHLC();
        _resetHookBridge();
        db = new Or3DB(`or3-test-sync-${Date.now()}-${Math.random()}`);
        await db.open();
        bridge = new HookBridge(db);
        bridge.start();
    });

    afterEach(async () => {
        _resetHookBridge();
        _resetHLC();
        if (db) {
            db.close();
            await db.delete();
        }
    });

    it('captures put operations atomically for synced tables', async () => {
        const now = nowSec();
        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'threads'),
            async () => {
                await db.threads.put({
                    id: 't-1',
                    title: 'Thread',
                    created_at: now,
                    updated_at: now,
                    status: 'ready',
                    deleted: false,
                    pinned: false,
                    clock: 1,
                    forked: false,
                    last_message_at: null,
                    parent_thread_id: null,
                    anchor_message_id: null,
                    anchor_index: null,
                    branch_mode: null,
                    project_id: null,
                    system_prompt_id: null,
                });
            }
        );

        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'messages'),
            async () => {
                await db.messages.put({
                    id: 'm-1',
                    thread_id: 't-1',
                    role: 'assistant',
                    index: 0,
                    created_at: now,
                    updated_at: now,
                    deleted: false,
                    clock: 1,
                    data: { content: 'hello' },
                    pending: false,
                    error: null,
                    file_hashes: null,
                });
            }
        );

        await db.transaction('rw', getWriteTxTableNames(db, 'kv'), async () => {
            await db.kv.put({
                id: 'kv:theme_selection',
                name: 'theme_selection',
                value: 'retro',
                deleted: false,
                created_at: now,
                updated_at: now,
                clock: 1,
            });
        });

        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'file_meta'),
            async () => {
                await db.file_meta.put({
                    hash: 'a'.repeat(64),
                    name: 'image.png',
                    mime_type: 'image/png',
                    kind: 'image',
                    size_bytes: 100,
                    width: 10,
                    height: 10,
                    ref_count: 1,
                    created_at: now,
                    updated_at: now,
                    deleted: false,
                    clock: 1,
                });
            }
        );

        const ops = await db.pending_ops.toArray();
        expect(ops).toHaveLength(4);
        expect(new Set(ops.map((op) => op.tableName))).toEqual(
            new Set(['threads', 'messages', 'kv', 'file_meta'])
        );
        expect(ops.every((op) => op.status === 'pending')).toBe(true);
    });

    it('captures delete operations with tombstones when transaction includes tombstones', async () => {
        const now = nowSec();
        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'messages'),
            async () => {
                await db.messages.put({
                    id: 'm-delete',
                    thread_id: 't-1',
                    role: 'assistant',
                    index: 1,
                    created_at: now,
                    updated_at: now,
                    deleted: false,
                    clock: 1,
                    data: { content: 'bye' },
                    pending: false,
                    error: null,
                    file_hashes: null,
                });
            }
        );

        await db.pending_ops.clear();
        await db.tombstones.clear();

        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'messages', { includeTombstones: true }),
            async () => {
                await db.messages.delete('m-delete');
            }
        );

        const ops = await db.pending_ops.toArray();
        const tombstones = await db.tombstones.toArray();
        expect(ops).toHaveLength(1);
        expect(ops[0]?.operation).toBe('delete');
        expect(ops[0]?.pk).toBe('m-delete');
        expect(tombstones).toHaveLength(1);
        expect(tombstones[0]?.id).toBe('messages:m-delete');
    });
});
