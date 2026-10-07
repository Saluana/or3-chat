import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { zipSync, strToU8 } from 'fflate';
import Dexie from 'dexie';
import { createOrRefFile } from '../files';
import { catalogWorkspaceFile } from '../workspace-files';
import { processProjectSource } from '~/utils/projects/source-intake';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { capturedHistoryContext } from '~/utils/chat/history-reader';
import { forkThread } from '../branching';
import { forkThread as forkStoredThread } from '../threads';
import {
    readFamilyPage,
    readFamilyMembers,
} from '~/utils/sidebar/thread-families';
import { useProjectsCrud } from '~/composables/projects/useProjectsCrud';
import {
    buildProjectContext,
    assertProjectToolAllowed,
    finalizeProjectReceipt,
} from '~/utils/projects/context';

import { saveClassifiedProjectMemory } from '~/utils/projects/memory';
import * as projectContext from '~/utils/projects/context';
import { defaultProjectSettings } from '~~/shared/projects/workspace';
import { useUserApiKey } from '~/core/auth/useUserApiKey';

const hookActions = vi.hoisted(() => vi.fn(async (_name: string, _payload?: unknown) => {}));
vi.mock('../../core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_: string, value: unknown) => value,
        doAction: hookActions,
    }),
}));
vi.mock('#imports', async (load) => ({
    ...(await load<Record<string, unknown>>()),
    useRuntimeConfig: () => ({
        public: { ssrAuthEnabled: false, limits: { enabled: false } },
    }),
}));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {} }));
// Vite's worker build selects this browser entry; Vitest otherwise picks the
// Node entry, which expects Buffer rather than the worker's ArrayBuffer.
vi.mock('mammoth', async () => {
    const browser = await vi.importActual<{ default: typeof import('mammoth') }>('mammoth/mammoth.browser.js');
    return { default: browser.default };
});

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
    hookActions.mockReset();
    hookActions.mockImplementation(async () => {});
    revoked = false;
    await db.open();
    await Promise.all([
        db.projects.clear(),
        db.threads.clear(),
        db.posts.clear(),
        db.file_meta.clear(),
        db.messages.clear(),
    ]);
    await db.projects.bulkPut([project('a'), project('b')]);
});

describe('persistent project workspace', () => {
    // Many extraction blobs must not all decode on every send. Facts beyond
    // catalog previews still need to be discoverable within the retrieval budget.
    it('bounds extraction decoding per turn while retaining late-file passages', async () => {
        await db.threads.put({ id: 'bounded-files', project_id: 'a', status: 'ready', deleted: false, pinned: false, forked: false,
            clock: 1, created_at: 1, updated_at: 1 });
        for (let i = 0; i < 12; i++) {
            const text = 'Unrelated filler. '.repeat(62000) + '\nNebula calibration is in August 2042. File ' + i;
            const file = await createOrRefFile(new NodeBlob([text], { type: 'text/plain' }) as Blob, 'reference-' + i + '.txt');
            const item = await catalogWorkspaceFile(scope(), file.hash, { text: { text: text.slice(0, 16000), coverage: 'prefix', indexed_bytes: 16000 } });
            await saveProjectSource(scope(), 'a', { item_id: item.post.id, title: 'Reference ' + i, kind: 'file', mode: 'relevant',
                current_revision_id: 'extracted', revisions: [{ id: 'extracted', original_hash: file.hash, text_hash: file.hash,
                    status: 'ready', coverage: 'full', created_at: 1 }] }, 'bounded-binding-' + i);
        }
        let decodedBytes = 0;
        const original = NodeBlob.prototype.text;
        const text = vi.spyOn(NodeBlob.prototype, 'text').mockImplementation(function(this: NodeBlob) {
            decodedBytes += this.size; return original.call(this);
        });
        try {
            const snapshot = await buildProjectContext(scope(), 'bounded-files', 'nebula calibration', false);
            expect(JSON.stringify(snapshot?.messages)).toContain('calibration is in August 2042');
            expect(decodedBytes).toBeGreaterThan(0);
            expect(decodedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
            expect(snapshot?.receipt.sources.some(source => source.reason?.includes('budget'))).toBe(true);
        } finally { text.mockRestore(); }
    });
    // Authorization must remain fresh without loading unrelated project records,
    // memories or sources. Null legacy owners and ambiguous associations remain supported.
    it('resolves ordinary and legacy owners without a full project scan', async () => {
        await db.projects.bulkPut(Array.from({ length: 100 }, (_, i) => project('noise-' + i)));
        await db.threads.put({ id: 'ordinary', project_id: null, status: 'ready', deleted: false, pinned: false, forked: false,
            clock: 1, created_at: 1, updated_at: 1 });
        const reads: string[] = [];
        const reading = (row: { id: string }) => { reads.push(row.id); return row; };
        db.projects.hook('reading', reading);
        try {
            expect(await resolveChatProject(db, 'ordinary')).toBeNull();
            expect(reads).toEqual([]);
            await db.projects.update('a', { data: ['ordinary'] }); reads.length = 0;
            expect(await resolveChatProject(db, 'ordinary')).toBe('a');
            expect(reads).toEqual(['a']);
            await db.projects.update('b', { data: [{ id: 'ordinary', kind: 'chat' }] });
            await expect(resolveChatProject(db, 'ordinary')).rejects.toThrow(/multiple/);
            await db.projects.update('b', { deleted: true });
            expect(await resolveChatProject(db, 'ordinary')).toBe('a');
        } finally { db.projects.hook('reading').unsubscribe(reading); }
    });

    it('authorizes a targetless tool using only the project and settings row', async () => {
        await db.threads.put({ id: 'origin-policy', project_id: 'a', status: 'ready', deleted: false, pinned: false, forked: false,
            clock: 1, created_at: 1, updated_at: 1 });
        const state = await readProjectWorkspace(db, 'a');
        const settings = await saveProjectSettings(scope(), 'a', { ...state.settings, tools: { workspace_search: { mode: 'enabled', resources: [] } } }, null);
        await db.posts.bulkPut(Array.from({ length: 100 }, (_, i) => ({ id: 'irrelevant-memory-' + i,
            postType: 'or3:project-memory', title: 'a', content: JSON.stringify({ version: 1, text: 'Unused fact', kind: 'fact' }),
            clock: 1, created_at: 1, updated_at: 1, deleted: false })));
        const reads: string[] = [];
        const reading = (row: { id: string }) => { reads.push(row.id); return row; };
        db.posts.hook('reading', reading);
        try {
            const args: Record<string, unknown> = {};
            await assertProjectToolAllowed(scope(), 'origin-policy', 'workspace_search', args, undefined, 'a');
            expect(args.projectId).toBe('a');
            expect(reads).toEqual([settings.id]);
            await db.posts.update(settings.id, { content: JSON.stringify({ ...state.settings, tools: { workspace_search: { mode: 'disabled', resources: [] } } }) });
            await expect(assertProjectToolAllowed(scope(), 'origin-policy', 'workspace_search', {}, undefined, 'a')).rejects.toThrow(/disabled/);
        } finally { db.posts.hook('reading').unsubscribe(reading); }
    });
    // Failure inventory: an abandoned Processing row stays stuck after reload;
    // expiration must be visible without writing through revoked/read-only scopes.
    it('shows expired extraction as retryable failure without modifying its stored revision', async () => {
        await db.posts.put({ id: 'interrupted-note', title: 'Interrupted', postType: 'doc', content: '{"type":"doc","content":[]}',
            clock: 1, created_at: 1, updated_at: 1, deleted: false });
        const saved = await saveProjectSource(scope(), 'a', { item_id: 'interrupted-note', title: 'Interrupted', kind: 'document', mode: 'relevant',
            current_revision_id: 'interrupted', revisions: [{ id: 'interrupted', status: 'processing', coverage: 'none', created_at: 1 }] });
        revoked = true;
        const read = await readProjectWorkspace(db, 'a');
        expect(read.sources[0]?.value.revisions[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/interrupted|retry/i) });
        expect(await db.posts.get(saved.row.id)).toEqual(saved.row);
    });

    // This exercises the actual DOCX worker/Mammoth parser. PDF is unrelated to
    // these archive cases; network, OCR and browser worker startup remain E2E-owned.
    it('reports image-only and mixed-media DOCX extraction honestly', async () => {
        const messages: unknown[] = [];
        const workerSelf = self;
        const originalHandler = workerSelf.onmessage;
        const postMessage = vi.spyOn(workerSelf, 'postMessage').mockImplementation(value => {
            if (typeof value?.ok === 'boolean') messages.push(value);
        });
        try {
            await import('../../workers/project-extraction.worker');
            for (const text of ['', 'Readable paragraph']) {
                const zipped = zipSync({
                    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
                    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
                    'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
                    'word/media/image.png': new Uint8Array([1]),
                });
                await workerSelf.onmessage!.call(workerSelf, { data: { bytes: zipped.buffer as ArrayBuffer, name: 'media.docx' } } as MessageEvent<{ bytes: ArrayBuffer; name: string }>);
            }
            expect(messages[0]).toMatchObject({ ok: false, error: expect.stringMatching(/readable text/i) });
            expect(messages[1]).toMatchObject({ ok: true, partial: true, text: expect.stringContaining('Readable paragraph') });
        } finally { workerSelf.onmessage = originalHandler; postMessage.mockRestore(); }
    });
    // Failure inventory: asynchronous preparation expires IndexedDB writes;
    // failed after-hooks misreport durable forks; preparation can move the
    // source and must not admit a branch with stale ownership.
    it.each(['branch', 'stored'] as const)('fences %s forks around asynchronous lifecycle hooks', async writer => {
        await db.threads.put({ id: 'fork-source', title: 'Source', project_id: 'a', status: 'ready',
            pinned: false, forked: false, deleted: false, clock: 1, created_at: 1, updated_at: 1 });
        await db.messages.put({ id: 'fork-anchor', thread_id: 'fork-source', role: 'user', index: 1000,
            clock: 1, created_at: 1, updated_at: 1, deleted: false });
        const prefix = writer === 'branch' ? 'branch.fork' : 'db.threads.fork';
        const observations: boolean[] = [];
        hookActions.mockImplementation(async name => {
            if (!name.startsWith(prefix)) return;
            await new Promise(resolve => setTimeout(resolve, 10));
            observations.push(Boolean(Dexie.currentTransaction));
            if (name.endsWith(':after')) throw new Error('Notification failed');
        });
        const run = () => writer === 'branch'
            ? forkThread({ sourceThreadId: 'fork-source', anchorMessageId: 'fork-anchor', mode: 'copy' }).then(result => result.thread)
            : forkStoredThread('fork-source', {}, { copyMessages: true });
        const fork = await run();
        expect(observations).toEqual([false, false]);
        expect(await db.threads.get(fork.id)).toMatchObject({ project_id: 'a', parent_thread_id: 'fork-source' });
        expect(await db.messages.where('thread_id').equals(fork.id).count()).toBe(1);
        expect((await db.projects.get('a'))?.data).toContainEqual(expect.objectContaining({ id: fork.id, kind: 'chat' }));
        hookActions.mockImplementation(async name => {
            if (name === `${prefix}:action:before`) await db.threads.update('fork-source', { project_id: 'b', clock: 2 });
        });
        await expect(run()).rejects.toThrow(/changed/i);
        expect(await db.threads.count()).toBe(2);
    });
    // Failure inventory: a timer in a reference notification closes the source
    // transaction; a throwing notification misreports a committed save; a later
    // missing hash must roll back all ownership changes without notifying.
    it.each(['delayed', 'throwing', 'rollback', 'soft-delete', 'hard-delete'] as const)('commits source ownership before %s reference notifications', async mode => {
        const hash = 'sha256:' + '4'.repeat(64);
        await db.file_meta.put({ hash, name: 'Original', mime_type: 'text/plain', kind: 'file',
            size_bytes: 1, ref_count: 0, clock: 1, created_at: 1, updated_at: 1, deleted: false });
        await db.posts.put({ id: 'hook-original', postType: 'or3:file', title: 'Original', content: '',
            file_hashes: JSON.stringify([hash]), clock: 1, created_at: 1, updated_at: 1, deleted: false });
        const notifications: Array<{ transaction: boolean; source: boolean; references: number | undefined }> = [];
        hookActions.mockImplementation(async name => {
            if (name !== 'db.files.refchange:action:after') return;
            await new Promise(resolve => setTimeout(resolve, 10));
            const source = await db.posts.get('hook-binding');
            notifications.push({ transaction: Boolean(Dexie.currentTransaction),
                source: Boolean(source && !source.deleted),
                references: (await db.file_meta.get(hash))?.ref_count });
            if (mode === 'throwing') throw new Error('Notification unavailable');
        });
        const value = { item_id: 'hook-original', kind: 'file' as const, title: 'Original', mode: 'relevant' as const,
            current_revision_id: 'r1', revisions: [{ id: 'r1', original_hash: hash,
                ...(mode === 'rollback' ? { text_hash: 'sha256:' + '5'.repeat(64) } : {}),
                status: 'ready' as const, coverage: 'full' as const, created_at: 1 }] };
        const write = saveProjectSource(scope(), 'a', value, 'hook-binding');
        if (mode === 'rollback') {
            await expect(write).rejects.toThrow('unavailable');
            expect(await db.posts.get('hook-binding')).toBeUndefined();
            expect((await db.file_meta.get(hash))?.ref_count).toBe(0);
            expect((await db.projects.get('a'))?.data).toEqual([]);
            expect(notifications).toEqual([]);
        } else {
            await expect(write).resolves.toMatchObject({ row: { id: 'hook-binding' } });
            expect(notifications).toEqual([{ transaction: false, source: true, references: 1 }]);
            expect((await db.projects.get('a'))?.data).toEqual([{ id: 'hook-original', kind: 'file', name: 'Original' }]);
            if (mode === 'soft-delete' || mode === 'hard-delete') {
                notifications.length = 0;
                const owner = (await db.projects.get('a'))!;
                await expect(deleteProjectWorkspace(scope(), 'a', owner.clock, mode === 'hard-delete')).resolves.toBeUndefined();
                expect(notifications).toEqual([{ transaction: false, source: false, references: 0 }]);
                expect(await db.projects.get('a')).toEqual(mode === 'hard-delete' ? undefined : expect.objectContaining({ deleted: true }));
            }
        }
    });
    // Project family headers must not use a foreign root as their title or
    // mutation/navigation target. Existing family tests share one owner.
    it.each(['explicit', 'legacy'] as const)('keeps a project family header on its permitted member with %s root ownership', async ownership => {
        const row = (id: string, projectId?: string) => ({ id, title: id === 'root' ? 'Private foreign root' : 'Permitted project branch',
            project_id: projectId, status: 'ready' as const, pinned: false, forked: false, deleted: false, clock: 1, created_at: 1, updated_at: 1 });
        await db.threads.bulkPut([row('root', ownership === 'explicit' ? 'b' : undefined),
            { ...row('child', 'a'), parent_thread_id: 'root', branch_mode: 'reference' as const, updated_at: 2 }]);
        if (ownership === 'legacy') await db.projects.put(project('b', [{ kind: 'chat', id: 'root' }]));
        const page = await readFamilyPage(db, { limit: 10, type: 'thread', filter: { projectId: 'a' } });
        expect(page.items).toHaveLength(1);
        expect(page.items[0]).toMatchObject({ id: 'child', title: 'Permitted project branch', family: { kind: 'group-header' } });
        expect(page.items[0]?.family?.originalId).toBeUndefined();
        await db.threads.update('root', { project_id: 'a' });
        const permitted = await readFamilyPage(db, { limit: 10, type: 'thread', filter: { projectId: 'a' } });
        expect(permitted.items[0]).toMatchObject({ title: 'Private foreign root', family: { originalId: 'root' } });
    });

    // Legacy chat ownership must agree across activity and both ordinary fork
    // writers. Membership edits must tolerate unchanged deleted references and
    // roll back earlier moves when a newly requested target is unavailable.
    it('shows unambiguous legacy activity and preserves ownership in ordinary forks', async () => {
        await db.threads.put({
            id: 'legacy',
            title: 'Legacy chat',
            clock: 0,
            created_at: 1,
            updated_at: 1,
            deleted: false,
            status: 'ready',
            forked: false,
            pinned: false,
        });
        await db.projects.put(project('a', [{ id: 'legacy', kind: 'chat' }]));
        await db.messages.put({
            id: 'anchor',
            thread_id: 'legacy',
            role: 'user',
            data: { content: 'Start here' },
            index: 1000,
            clock: 0,
            created_at: 1,
            updated_at: 1,
            deleted: false,
        });
        const activity = await readFamilyPage(db, {
            limit: 10,
            type: 'thread',
            filter: { projectId: 'a' },
        });
        expect(activity.items.map((item) => item.id)).toContain('legacy');
        const branch = await forkThread({
            sourceThreadId: 'legacy',
            anchorMessageId: 'anchor',
            mode: 'reference',
        });
        const copy = await forkStoredThread(
            'legacy',
            {},
            { copyMessages: true },
        );
        expect(
            (
                await readFamilyMembers(db, 'legacy', 10, { projectId: 'a' })
            ).members.map((member) => member.id),
        ).toContain('legacy');
        for (const fork of [branch.thread, copy]) {
            expect(await resolveChatProject(db, fork.id)).toBe('a');
            expect((await db.projects.get('a'))?.data).toContainEqual({
                kind: 'chat',
                id: fork.id,
                name: fork.title,
            });
        }
        await db.projects.put(project('b', [{ id: 'legacy', kind: 'chat' }]));
        const ambiguous = await readFamilyPage(db, {
            limit: 10,
            type: 'thread',
            filter: { projectId: 'b' },
        });
        expect(ambiguous.items.map((item) => item.id)).not.toContain('legacy');
    });

    it('keeps project membership edits atomic without rewriting deleted unchanged chats', async () => {
        await db.threads.bulkPut(
            [
                { id: 'gone', project_id: 'a', deleted: true },
                { id: 'moving', project_id: 'b', deleted: false },
            ].map((row) => ({
                ...row,
                clock: 0,
                created_at: 1,
                updated_at: 1,
                status: 'ready',
                forked: false,
                pinned: false,
            })),
        );
        await db.projects.put(project('a', [{ id: 'gone', kind: 'chat' }]));
        const crud = useProjectsCrud();
        await crud.updateProjectEntries('a', [
            { id: 'gone', kind: 'chat' },
            { id: 'doc', kind: 'doc' },
        ]);
        expect((await db.projects.get('a'))?.data).toContainEqual({
            id: 'doc',
            kind: 'doc',
        });
        await expect(
            crud.updateProjectEntries('a', [
                { id: 'moving', kind: 'chat' },
                { id: 'missing', kind: 'chat' },
            ]),
        ).rejects.toThrow(/unavailable/i);
        expect((await db.threads.get('moving'))?.project_id).toBe('b');
        expect((await db.projects.get('a'))?.data).toContainEqual({
            id: 'doc',
            kind: 'doc',
        });
    });
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

    // Approval is an await boundary: changing either owner while the user is
    // reviewing must refuse execution, rather than discover the move after a write.
    it('reauthorizes originating and target ownership after approval', async () => {
        await db.threads.bulkPut(
            ['origin', 'target'].map((id) => ({
                id,
                clock: 0,
                created_at: 1,
                updated_at: 1,
                deleted: false,
                status: 'ready',
                forked: false,
                pinned: false,
            })),
        );
        await moveChatToProject(scope(), 'origin', 'a');
        await moveChatToProject(scope(), 'target', 'a');
        const settings = await readProjectWorkspace(db, 'a');
        await saveProjectSettings(
            scope(),
            'a',
            {
                ...settings.settings,
                tools: {
                    send_message_to_thread: { mode: 'ask', resources: [] },
                },
            },
            null,
        );
        for (const moved of ['origin', 'target']) {
            await expect(
                assertProjectToolAllowed(
                    scope(),
                    'origin',
                    'send_message_to_thread',
                    { threadId: 'target' },
                    async () => {
                        await moveChatToProject(scope(), moved, 'b');
                        return true;
                    },
                    'a',
                ),
            ).rejects.toThrow(/project|context/i);
            await moveChatToProject(scope(), moved, 'a');
        }
    });

    // Excluding a chat governs reuse from other chats, not that chat's own
    // lineage traversal. Existing project tests did not enter the history reader.
    it('permits current-chat history when excluded while refusing other excluded chats', async () => {
        await db.threads.bulkPut(
            ['origin', 'excluded'].map((id) => ({
                id,
                project_id: 'a',
                clock: 0,
                created_at: 1,
                updated_at: 1,
                deleted: false,
                status: 'ready',
                forked: false,
                pinned: false,
            })),
        );
        const state = await readProjectWorkspace(db, 'a');
        await saveProjectSettings(
            scope(),
            'a',
            { ...state.settings, excluded_chat_ids: ['origin', 'excluded'] },
            null,
        );
        const history = capturedHistoryContext(
            {
                subject: null,
                workspaceId: 'local',
                threadId: 'origin',
                messageId: null,
                callId: 'read',
                requestId: 'read',
                abortSignal: new AbortController().signal,
                projectId: 'a',
            },
            () => '1',
        );
        expect(
            (await history.read({ kind: 'thread', thread_id: 'origin' })).thread
                ?.id,
        ).toBe('origin');
        await expect(
            history.read({ kind: 'thread', thread_id: 'excluded' }),
        ).rejects.toThrow(/permitted project memory/i);
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
                { id: 'chat', kind: 'chat', color: 'blue' },
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
        expect((await db.projects.get('b'))?.data).toContainEqual({
            id: 'chat',
            kind: 'chat',
            name: 'Chat',
            color: 'blue',
        });
    });

    // Failure inventory: parallel source additions or replacement collisions must
    // not create conflicting bindings; unavailable evidence must not lock a user
    // out of restricting context or correcting an existing explicit memory.
    it('rejects duplicate bindings atomically and permits disabling an unavailable source', async () => {
        await db.posts.put({
            id: 'doc',
            title: 'Brief',
            postType: 'doc',
            content: '{}',
            meta: '',
            file_hashes: '[]',
            clock: 0,
            created_at: 1,
            updated_at: 1,
            deleted: false,
        });
        const value = {
            item_id: 'doc',
            kind: 'document' as const,
            title: 'Brief',
            mode: 'always' as const,
            current_revision_id: 'r1',
            revisions: [
                {
                    id: 'r1',
                    status: 'ready' as const,
                    coverage: 'full' as const,
                    created_at: 1,
                },
            ],
        };
        const results = await Promise.allSettled([
            saveProjectSource(scope(), 'a', value, 'binding-one'),
            saveProjectSource(scope(), 'a', value, 'binding-two'),
        ]);
        expect(
            results.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        const binding = (await readProjectWorkspace(db, 'a')).sources[0]!;
        await saveProjectSource(
            scope(),
            'a',
            binding.value,
            binding.row.id,
            binding.row.clock,
        );
        expect((await db.projects.get('a'))?.data).toHaveLength(1);
        const current = (await readProjectWorkspace(db, 'a')).sources[0]!;
        await db.posts.update('doc', { deleted: true });
        await saveProjectSource(
            scope(),
            'a',
            { ...current.value, mode: 'off' },
            current.row.id,
            current.row.clock,
        );
        const disabled = (await readProjectWorkspace(db, 'a')).sources[0]!;
        expect(disabled.value.mode).toBe('off');
        await expect(
            saveProjectSource(
                scope(),
                'a',
                { ...disabled.value, mode: 'always' },
                disabled.row.id,
                disabled.row.clock,
            ),
        ).rejects.toThrow('unavailable');
    });

    // Retrieval must filter summary candidates before walking their provenance;
    // an empty retrieval query has no reason to inspect any historical evidence.
    it.each(['', 'nebula', 'nebula launch propulsion', 'invalid nebula', 'wide nebula'])(
        'bounds continuity evidence reads for query %j',
        async (query) => {
            const ranking = query.includes('propulsion');
            const invalid = query.includes('invalid');
            const wide = query.includes('wide');
            const count = invalid ? 40 : 12;
            const threadRow = (id: string, extra = {}) => ({
                id,
                project_id: 'a',
                title: 'Archived discussion',
                clock: 0,
                created_at: 1,
                updated_at: 1,
                deleted: false,
                status: 'ready' as const,
                forked: false,
                pinned: false,
                ...extra,
            });
            await db.threads.bulkPut([
                threadRow('origin'),
                threadRow('parent'),
                ...Array.from({ length: count }, (_, index) =>
                    threadRow('child-' + index, {
                        summary_message_id: 'summary-' + index,
                        updated_at: ranking ? 20 - index : 1,
                    }),
                ),
            ]);
            await db.messages.bulkPut(
                Array.from({ length: count }, (_, index) => [
                    {
                        id: 'evidence-' + index,
                        thread_id: 'parent',
                        role: 'user' as const,
                        index,
                        clock: 0,
                        created_at: 1,
                        updated_at: 1,
                        deleted: false,
                        data: { content: 'Original decision ' + index },
                    },
                    {
                        id: 'summary-' + index,
                        thread_id: 'child-' + index,
                        role: 'system' as const,
                        index: 0,
                        clock: 0,
                        created_at: 1,
                        updated_at: 1,
                        deleted: false,
                        pending: false,
                        data: {
                            compaction: {
                                version: 1,
                                compaction_id: 'compaction-' + index,
                                source_thread_id: 'parent',
                                anchor_message_id: 'evidence-' + index,
                                anchor_index: index,
                                generated_at: 1,
                                model: 'fixture/model',
                                message_count: 1,
                                prior_message_count: 1,
                                summary_markdown:
                                    wide ? 'Wide nebula candidate' : invalid ? 'Invalid nebula candidate' : ranking && index === 3
                                        ? 'Unrelated archive background. '.repeat(180) + '\nNebula launch propulsion calibration is scheduled for August 2042.'
                                        : ranking && index === 4
                                          ? 'Nebula launch planning reference'
                                          : ranking && index < 3
                                            ? 'Nebula casual reference'
                                            : index === 0
                                        ? 'Nebula launch decision'
                                        : 'Unrelated gardening discussion',
                                landmarks: [],
                                history_scope: {
                                    version: 1,
                                    segments: [
                                        {
                                            thread_id: 'parent',
                                            messages: wide ? Array.from({ length: 1100 }, () => ({ message_id: 'evidence-' + index, clock: 0 })) : [
                                                {
                                                    message_id:
                                                        'evidence-' + index,
                                                    clock: invalid ? 1 : 0,
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        },
                    },
                ]).flat(),
            );
            const reads: string[] = [];
            const get = db.messages.get.bind(db.messages);
            const spy = vi.spyOn(db.messages, 'get').mockImplementation(((
                id: string,
            ) => {
                reads.push(id);
                return get(id);
            }) as typeof db.messages.get);
            try {
                const snapshot = await buildProjectContext(
                    scope(),
                    'origin',
                    query,
                    false,
                );
                expect(
                    snapshot?.receipt.chats?.map((chat) => chat.message_id),
                ).toEqual(invalid || wide ? [] : ranking ? ['summary-3', 'summary-4', 'summary-0'] : query ? ['summary-0'] : []);
                const evidence = reads.filter((id) => id.startsWith('evidence-'));
                if (wide) expect(evidence.length).toBeLessThanOrEqual(1000);
                else if (invalid) expect(evidence.length).toBeLessThanOrEqual(12);
                else expect(evidence).toEqual(ranking ? ['evidence-3', 'evidence-4', 'evidence-0'] : query ? ['evidence-0'] : []);
                if (ranking) {
                    expect(JSON.stringify(snapshot?.messages)).toContain('calibration is scheduled for August 2042');
                    expect(snapshot?.receipt.chats?.[0]?.text).toContain('calibration is scheduled for August 2042');
                    expect(snapshot?.receipt.chats?.every(chat => chat.text.length <= 4000)).toBe(true);
                }
                if (!query) expect(reads).toEqual([]);
            } finally {
                spy.mockRestore();
            }
        },
    );

    // A retry changes extraction state, not the user's chosen current revision.
    // The extraction worker is external transport; source writes/refcounts and
    // catalog persistence below are real Dexie operations.
    it('retries a historical failed extraction without promoting it over a newer revision', async () => {
        vi.stubGlobal('Blob', NodeBlob);
        vi.stubGlobal(
            'Worker',
            class {
                onmessage?: (event: { data: unknown }) => void;
                terminate() {}
                postMessage() {
                    queueMicrotask(() =>
                        this.onmessage?.({
                            data: {
                                ok: true,
                                text: 'Recovered historical content.',
                                partial: false,
                                locations: [],
                            },
                        }),
                    );
                }
            },
        );
        try {
            const oldFile = await createOrRefFile(
                new NodeBlob(['Historical document'], {
                    type: 'text/plain',
                }) as unknown as Blob,
                'old.txt',
            );
            const newFile = await createOrRefFile(
                new NodeBlob(['Current document'], {
                    type: 'text/plain',
                }) as unknown as Blob,
                'new.txt',
            );
            const oldItem = await catalogWorkspaceFile(scope(), oldFile.hash);
            const newItem = await catalogWorkspaceFile(scope(), newFile.hash);
            const source = await saveProjectSource(scope(), 'a', {
                item_id: newItem.post.id,
                kind: 'file',
                title: 'Versioned source',
                mode: 'relevant',
                current_revision_id: 'new',
                revisions: [
                    {
                        id: 'old',
                        item_id: oldItem.post.id,
                        original_hash: oldFile.hash,
                        status: 'failed',
                        coverage: 'none',
                        created_at: 1,
                    },
                    {
                        id: 'new',
                        item_id: newItem.post.id,
                        original_hash: newFile.hash,
                        status: 'ready',
                        coverage: 'full',
                        created_at: 2,
                    },
                ],
            });
            const retried = await processProjectSource(
                scope(),
                'a',
                source,
                'old',
            );
            expect(retried.value).toMatchObject({
                current_revision_id: 'new',
                item_id: newItem.post.id,
            });
            expect(
                retried.value.revisions.find(
                    (revision) => revision.id === 'old',
                ),
            ).toMatchObject({
                status: 'ready',
                coverage: 'full',
                text_hash: expect.any(String),
            });
            expect(
                (await readProjectWorkspace(db, 'a')).sources[0]?.value
                    .current_revision_id,
            ).toBe('new');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('allows correcting historical memory but refuses rebinding it to foreign evidence', async () => {
        await db.threads.bulkPut(
            ['a', 'b'].map((owner) => ({
                id: 'evidence-' + owner,
                project_id: owner,
                clock: 0,
                created_at: 1,
                updated_at: 1,
                deleted: false,
                status: 'ready',
                forked: false,
                pinned: false,
            })),
        );
        const memory = await saveProjectMemory(scope(), 'a', {
            text: 'Old fact',
            source_thread_id: 'evidence-a',
        });
        await db.threads.update('evidence-a', { deleted: true });
        const edited = await saveProjectMemory(
            scope(),
            'a',
            {
                ...memory.value,
                text: 'Corrected fact',
            },
            memory.row.id,
            memory.row.clock,
        );
        expect(edited.value.text).toBe('Corrected fact');
        await expect(
            saveProjectMemory(
                scope(),
                'a',
                {
                    ...edited.value,
                    source_thread_id: 'evidence-b',
                },
                edited.row.id,
                edited.row.clock,
            ),
        ).rejects.toThrow(/another project|evidence/i);
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

// Classification failure inventory: save latency, unavailable/malformed provider,
// stale edits/deletion/evidence/ownership/access, cross-chat leakage, oversized
// state, deadline/retry behavior. Real Dexie + actual SDK own these contracts;
// Chrome journeys own the absence of taxonomy controls and usable save forms.
describe('nonblocking project memory classification', () => {
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); useUserApiKey().clearKey(); });
    async function start() {
        vi.spyOn(projectContext, 'captureProjectOperation').mockImplementation(() => scope());
        useUserApiKey().setKey('sk-or-classification-fixture');
        await db.threads.put({ id: 'memory-chat', project_id: 'a', status: 'ready', deleted: false,
            pinned: false, forked: false, clock: 1, created_at: 1, updated_at: 1 });
        await db.messages.put({ id: 'memory-source', thread_id: 'memory-chat', index: 0, role: 'user',
            data: { content: 'We chose SQLite.' }, deleted: false, clock: 1, created_at: 1, updated_at: 1 });
        let reply!: (response: Response) => void;
        let dispatchedSignal!: AbortSignal;
        let requested!: (body: Record<string, any>) => void;
        const request = new Promise<Record<string, any>>(resolve => { requested = resolve; });
        const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const req = input instanceof Request ? input : new Request(input, init);
            expect(req.url).toBe('https://openrouter.ai/api/alpha/decisions');
            dispatchedSignal = req.signal;
            requested(await req.json());
            return await new Promise<Response>(resolve => { reply = resolve; });
        });
        vi.stubGlobal('fetch', fetcher);
        const saved = await saveClassifiedProjectMemory(scope(), 'a', { text: 'Use SQLite.',
            source_thread_id: 'memory-chat', source_message_id: 'memory-source' });
        const body = await request;
        const finish = (answer: unknown = { type: 'choice', choice: 'decision',
            probabilities: { fact: 0.01, decision: 0.98, uncertain: 0.01 } }, model = 'typesafe/jev-1.13') => reply(new Response(JSON.stringify({
                model, answers: { memory_kind: answer },
                usage: { input_tokens: 30, output_tokens: 0, cost: 0.000003 },
            }), { headers: { 'Content-Type': 'application/json' } }));
        return { saved, body, fetcher, finish, get dispatchedSignal() { return dispatchedSignal; },
            fail: () => reply(new Response('Provider unavailable', { status: 503 })) };
    }
    it.each(['typesafe/jev-1.13', 'typesafe/jev-1.13-20260917'])(
        'saves immediately, bounds owning-chat context, then accepts resolved model %s', async model => {
        const { saved, body, finish } = await start();
        expect(JSON.parse((await db.posts.get(saved.row.id))!.content).kind).toBe('fact');
        expect(JSON.stringify(body.state)).toContain('We chose SQLite.');
        expect(new TextEncoder().encode(JSON.stringify(body.state)).length).toBeLessThanOrEqual(16384);
        finish(undefined, model);
        await vi.waitFor(async () => expect(JSON.parse((await db.posts.get(saved.row.id))!.content)).toMatchObject({
            text: 'Use SQLite.', kind: 'decision', source_message_id: 'memory-source' }));
    });
    it.each(['edit', 'delete', 'move', 'evidence', 'revoke', 'project-delete', 'credentials', 'exclude', 'evidence-revision'] as const)(
        'discards a classification after %s', async change => {
            const { saved, finish } = await start();
            if (change === 'edit') await saveProjectMemory(scope(), 'a', { text: 'Use Postgres.' }, saved.row.id, saved.row.clock);
            if (change === 'delete') await db.posts.update(saved.row.id, { deleted: true, clock: saved.row.clock + 1 });
            if (change === 'move') await moveChatToProject(scope(), 'memory-chat', 'b');
            if (change === 'evidence-revision') await db.messages.update('memory-source', { hlc: 'newer-peer-revision', data: { content: 'Rejected SQLite.' } });
            if (change === 'evidence') await db.messages.update('memory-source', { clock: 2, data: { content: 'Rejected SQLite.' } });
            if (change === 'project-delete') await db.projects.update('a', { deleted: true, clock: 1 });
            if (change === 'revoke') revoked = true;
            if (change === 'credentials') useUserApiKey().clearKey();
            if (change === 'exclude') await saveProjectSettings(scope(), 'a', { ...defaultProjectSettings(), excluded_chat_ids: ['memory-chat'] }, null);
            const before = await db.posts.get(saved.row.id);
            finish();
            // Let the response and expected-clock transaction settle; no metadata write is permitted.
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(await db.posts.get(saved.row.id)).toEqual(before);
        });
    it.each(['attacker/model', 'typesafe/jev-1.13-other', 'typesafe/jev-1.13-20260917-extra'])(
        'refuses unrelated resolved model %s', async model => {
            const { saved, finish } = await start();
            const before = await db.posts.get(saved.row.id);
            finish(undefined, model);
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(await db.posts.get(saved.row.id)).toEqual(before);
        });
    it.each([
        { type: 'choice', choice: 'uncertain', probabilities: { fact: 0.01, decision: 0.01, uncertain: 0.98 } },
        { type: 'choice', choice: 'decision' },
        { type: 'choice', choice: 'decision', probabilities: { fact: 0.3, decision: 0.6, uncertain: 0.1 } },
        { type: 'choice', choice: 'decision', probabilities: { fact: -1, decision: 2, uncertain: 0 } },
    ])('retains saved reference text on uncertain or invalid results %#', async answer => {
        const { saved, finish } = await start(); const before = await db.posts.get(saved.row.id);
        finish(answer); await new Promise(resolve => setTimeout(resolve, 100));
        expect(await db.posts.get(saved.row.id)).toEqual(before);
    });
    it('aborts after the deadline and refuses a late successful response', async () => {
        const pending = await start();
        const before = await db.posts.get(pending.saved.row.id);
        await vi.waitFor(() => expect(pending.dispatchedSignal.aborted).toBe(true), { timeout: 3500 });
        pending.finish(); await new Promise(resolve => setTimeout(resolve, 100));
        expect(await db.posts.get(pending.saved.row.id)).toEqual(before);
        expect(pending.fetcher).toHaveBeenCalledTimes(1);
    });
    it('keeps a saved reference after provider failure without retries', async () => {
        const pending = await start(); const before = await db.posts.get(pending.saved.row.id);
        pending.fail(); await new Promise(resolve => setTimeout(resolve, 100));
        expect(await db.posts.get(pending.saved.row.id)).toEqual(before);
        expect(pending.fetcher).toHaveBeenCalledTimes(1);
    });
    it('persists without credentials and does not start an inference', async () => {
        vi.spyOn(projectContext, 'captureProjectOperation').mockImplementation(() => scope());
        useUserApiKey().clearKey(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
        const saved = await saveClassifiedProjectMemory(scope(), 'a', { text: 'Uncategorized reference.' });
        expect(JSON.parse((await db.posts.get(saved.row.id))!.content).text).toBe('Uncategorized reference.');
        await new Promise(resolve => setTimeout(resolve, 50)); expect(fetcher).not.toHaveBeenCalled();
    });
});
