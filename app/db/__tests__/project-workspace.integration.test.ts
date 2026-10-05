import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../client';
import {
    readProjectWorkspace,
    saveProjectSettings,
    saveProjectMemory,
    saveProjectSource,
    deleteProjectWorkspace,
    moveChatToProject,
    resolveChatProject,
} from '../project-workspace';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import {
    buildProjectContext,
    assertProjectToolAllowed,
    finalizeProjectReceipt,
} from '~/utils/projects/context';

vi.mock('../../core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_: string, value: unknown) => value,
        doAction: async () => {},
    }),
}));

// Failure inventory before production code: ambiguous legacy owners; stale edits;
// deleted projects; aborted/workspace-revoked writes; replacement loss; missing
// originals; retention leaks; internal records exposed as ordinary documents.
// This suite owns real Dexie transactions; UI journeys own browser/render behavior.
const db = getDb();
let revoked = false;
const scope = (): WorkspaceOperationScope => ({
    db,
    workspaceId: 'local',
    generation: 0,
    subject: null,
    writable: true,
    signal: new AbortController().signal,
    assertCurrent() {
        if (revoked) throw new Error('revoked');
    },
});
const project = (id: string, data: unknown[] = []) => ({
    id,
    name: id,
    data,
    clock: 0,
    created_at: 1,
    updated_at: 1,
    deleted: false,
});

beforeEach(async () => {
    revoked = false;
    await db.open();
    await Promise.all([
        db.projects.clear(),
        db.threads.clear(),
        db.posts.clear(),
        db.file_meta.clear(),
    ]);
    await db.projects.bulkPut([project('a'), project('b')]);
});

describe('persistent project workspace', () => {
    // Destructive failure inventory: stale/revoked deletion must roll back;
    // deleting a project must retain chats/catalog originals and release internal owners.
    it('deletes project policy atomically while retaining underlying work', async () => {
        await db.threads.put({
            id: 'retained-chat',
            project_id: 'a',
            clock: 0,
            created_at: 1,
            updated_at: 1,
            deleted: false,
            status: 'ready',
            forked: false,
            pinned: false,
        });
        await saveProjectMemory(scope(), 'a', { text: 'Old fact' });
        await expect(deleteProjectWorkspace(scope(), 'a', 100)).rejects.toThrow(
            'changed',
        );
        expect((await db.projects.get('a'))?.deleted).toBe(false);
        await deleteProjectWorkspace(scope(), 'a', 0);
        expect((await db.projects.get('a'))?.deleted).toBe(true);
        expect((await db.threads.get('retained-chat'))?.project_id).toBeNull();
        expect((await db.threads.get('retained-chat'))?.deleted).toBe(false);
        expect(
            (
                await db.posts
                    .where('postType')
                    .equals('or3:project-memory')
                    .first()
            )?.deleted,
        ).toBe(true);
    });

    it('captures only the owning project context and enforces disabled and out-of-project tool reads', async () => {
        await db.threads.bulkPut(
            ['a', 'b'].map((project_id) => ({
                id: 'chat-' + project_id,
                project_id,
                clock: 0,
                created_at: 1,
                updated_at: 1,
                deleted: false,
                status: 'ready',
                forked: false,
                pinned: false,
            })),
        );
        for (const id of ['a', 'b']) {
            const state = await readProjectWorkspace(db, id);
            await saveProjectSettings(
                scope(),
                id,
                {
                    ...state.settings,
                    instructions: 'Instructions ' + id,
                    tools: { dangerous: { mode: 'disabled', resources: [] } },
                },
                null,
            );
            await saveProjectMemory(scope(), id, {
                text: 'Decision ' + id,
                kind: 'decision',
            });
        }
        const snapshot = await buildProjectContext(
            scope(),
            'chat-a',
            'help',
            false,
        );
        expect(snapshot?.receipt.instructions).toBe('Instructions a');
        expect(snapshot?.receipt.memories.map((m) => m.text)).toEqual([
            'Decision a',
        ]);
        expect(
            finalizeProjectReceipt(snapshot!, snapshot!.messages).instructions,
        ).toBe('Instructions a');
        await moveChatToProject(scope(), 'chat-a', 'b');
        await expect(
            assertProjectToolAllowed(
                scope(),
                'chat-a',
                'workspace_search',
                { query: 'decisions' },
                undefined,
                'a',
            ),
        ).rejects.toThrow('changed projects');
        await moveChatToProject(scope(), 'chat-a', 'a');
        expect(JSON.stringify(snapshot)).not.toContain('Decision b');
        await expect(
            assertProjectToolAllowed(scope(), 'chat-a', 'dangerous', {}),
        ).rejects.toThrow(/disabled/i);
        await expect(
            assertProjectToolAllowed(scope(), 'chat-a', 'read_thread', {
                threadId: 'chat-b',
            }),
        ).rejects.toThrow(/project/i);
        await expect(
            assertProjectToolAllowed(scope(), 'chat-a', 'read_thread', {
                threadId: 'chat-a',
            }),
        ).resolves.toBeUndefined();
    });
    it('persists explicit settings/memory and rejects stale edits and revoked writes', async () => {
        const original = await readProjectWorkspace(db, 'a');
        const saved = await saveProjectSettings(
            scope(),
            'a',
            { ...original.settings, instructions: 'Use metric units' },
            null,
        );
        await expect(
            saveProjectSettings(scope(), 'a', original.settings, null),
        ).rejects.toThrow(/changed/i);
        await db.threads.put({
            id: 'source',
            project_id: 'a',
            clock: 0,
            created_at: 1,
            updated_at: 1,
            deleted: false,
            status: 'ready',
            forked: false,
            pinned: false,
        });
        await db.messages.put({
            id: 'm',
            thread_id: 'source',
            role: 'user',
            index: 0,
            order_key: '0:m',
            data: { content: 'Launch is Friday' },
            clock: 0,
            created_at: 1,
            updated_at: 1,
            deleted: false,
        });
        await saveProjectMemory(scope(), 'a', {
            text: 'Launch is Friday',
            kind: 'decision',
            source_message_id: 'm',
        });
        const reread = await readProjectWorkspace(db, 'a');
        expect(reread.settings.instructions).toBe('Use metric units');
        expect(reread.memories.map((m) => m.value.text)).toEqual([
            'Launch is Friday',
        ]);
        expect((await readProjectWorkspace(db, 'b')).memories).toEqual([]);
        revoked = true;
        await expect(
            saveProjectSettings(
                scope(),
                'a',
                { ...reread.settings, instructions: 'changed' },
                saved.clock,
            ),
        ).rejects.toThrow('revoked');
        expect(
            (await readProjectWorkspace(db, 'a')).settings.instructions,
        ).toBe('Use metric units');
    });

    it('refuses ambiguous legacy ownership and atomically moves a chat preserving extension entries', async () => {
        const thread = {
            id: 'chat',
            title: 'Chat',
            clock: 0,
            created_at: 1,
            updated_at: 1,
            deleted: false,
            status: 'ready',
            forked: false,
            pinned: false,
        };
        await db.threads.put(thread);
        await db.projects.bulkPut([
            project('a', [
                { id: 'chat', kind: 'chat' },
                { kind: 'custom', payload: 42 },
            ]),
            project('b', [{ id: 'chat', kind: 'chat' }]),
        ]);
        await expect(resolveChatProject(db, 'chat')).rejects.toThrow(
            /multiple|ambiguous/i,
        );
        await moveChatToProject(scope(), 'chat', 'b');
        expect(await resolveChatProject(db, 'chat')).toBe('b');
        expect((await db.projects.get('a'))?.data).toEqual([
            { kind: 'custom', payload: 42 },
        ]);
        expect((await db.threads.get('chat'))?.project_id).toBe('b');
    });

    it('retains old revision originals and rolls back a missing replacement', async () => {
        const one = 'sha256:' + '1'.repeat(64),
            two = 'sha256:' + '2'.repeat(64),
            missing = 'sha256:' + '3'.repeat(64);
        for (const [name, hash] of [
            ['one', one],
            ['two', two],
            ['missing', missing],
        ]) {
            if (name !== 'missing')
                await db.file_meta.put({
                    hash: hash!,
                    name: name!,
                    mime_type: 'text/plain',
                    kind: 'file',
                    size_bytes: 1,
                    ref_count: 0,
                    clock: 0,
                    created_at: 1,
                    updated_at: 1,
                    deleted: false,
                });
            await db.posts.put({
                id: 'file-' + name,
                title: name!,
                postType: 'or3:file',
                content: '',
                meta: '',
                file_hashes: JSON.stringify([hash]),
                clock: 0,
                created_at: 1,
                updated_at: 1,
                deleted: false,
            });
        }
        const first = await saveProjectSource(scope(), 'a', {
            item_id: 'file-one',
            kind: 'file',
            title: 'Brief',
            mode: 'always',
            revisions: [
                {
                    id: 'r1',
                    original_hash: one,
                    status: 'ready',
                    coverage: 'full',
                    created_at: 1,
                },
            ],
            current_revision_id: 'r1',
        });
        const second = await saveProjectSource(
            scope(),
            'a',
            {
                ...first.value,
                item_id: 'file-two',
                revisions: [
                    ...first.value.revisions,
                    {
                        id: 'r2',
                        original_hash: two,
                        status: 'ready',
                        coverage: 'full',
                        created_at: 2,
                    },
                ],
                current_revision_id: 'r2',
            },
            first.row.id,
            first.row.clock,
        );
        expect((await db.file_meta.get(one))?.ref_count).toBe(1);
        expect((await db.file_meta.get(two))?.ref_count).toBe(1);
        await expect(
            saveProjectSource(
                scope(),
                'a',
                {
                    ...second.value,
                    item_id: 'file-missing',
                    revisions: [
                        ...second.value.revisions,
                        {
                            id: 'r3',
                            original_hash: missing,
                            status: 'ready',
                            coverage: 'full',
                            created_at: 3,
                        },
                    ],
                    current_revision_id: 'r3',
                },
                second.row.id,
                second.row.clock,
            ),
        ).rejects.toThrow(/unavailable|missing/i);
        expect(
            (await readProjectWorkspace(db, 'a')).sources[0]?.value
                .current_revision_id,
        ).toBe('r2');
    });
});
