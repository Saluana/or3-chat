import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceTabDrafts, type WorkspaceChatTabDraft } from '../useWorkspaceTabDrafts';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('~/composables/auth/useSessionContext', () => ({
    getCachedSessionContext: () => (session.userId ? { user: { id: session.userId } } : null),
}));

describe('useWorkspaceTabDrafts', () => {
    afterEach(() => {
        useWorkspaceTabDrafts().clear();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('keeps a closed draft for Undo, then releases its blob URL on expiry', () => {
        vi.useFakeTimers();
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', { revokeObjectURL });
        const drafts = useWorkspaceTabDrafts();
        drafts.write('tab-a', {
            version: 1,
            text: 'draft',
            attachments: [
                {
                    url: 'blob:preview-a',
                    name: 'preview.png',
                    status: 'pending',
                    mime: 'image/png',
                    kind: 'image',
                } as never,
            ],
            largeTextBlocks: [],
            updatedAt: 1,
        });

        drafts.discardAfter('tab-a', 1000);
        expect(drafts.read('tab-a')?.text).toBe('draft');
        vi.advanceTimersByTime(1000);
        expect(revokeObjectURL).not.toHaveBeenCalled();

        drafts.discardAfter('tab-a', 1000);
        vi.advanceTimersByTime(1000);
        expect(drafts.read('tab-a')).toBeUndefined();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-a');
    });
});


describe('durable workspace tab drafts', () => {
    const composer = {
        model: 'openai/gpt-test', modelVariant: 'off' as const, thinkingEnabled: true,
        imageSettings: { quality: 'high' as const, numResults: 2, size: '1024x1024' as const },
    };

    function draft(text: string, overrides: Partial<WorkspaceChatTabDraft> = {}): WorkspaceChatTabDraft {
        return { version: 1, text, attachments: [], largeTextBlocks: [], updatedAt: Date.now(), ...overrides };
    }

    /** A page reload: module state is gone, the IndexedDB data is not. */
    async function reload() {
        vi.resetModules();
        const client = await import('~/db/client');
        const drafts = await import('../useWorkspaceTabDrafts');
        return { client, drafts: drafts.useWorkspaceTabDrafts(), flush: drafts.flushWorkspaceTabDrafts };
    }

    afterEach(async () => {
        vi.restoreAllMocks();
        session.userId = null;
        Object.keys(localStorage).filter((key) => key.startsWith('or3:tab-draft-journal:')).forEach((key) => localStorage.removeItem(key));
        const { client, drafts } = await reload();
        client.setActiveWorkspaceDb(null);
        drafts.clear();
        await client.getDb().workspace_tab_drafts.clear();
        await client.getDb().workspace_draft_versions.clear();
        sessionStorage.clear();
        await client.getDb().file_blobs.clear();
        await client.getDb().file_meta.clear();
        vi.unstubAllGlobals();
    });

    it('preserves both pages after their shared baseline diverges, including a stale discard', async () => {
        const a = await reload();
        a.drafts.write('shared-recovery', draft('shared baseline'));
        await a.flush();
        const b = await reload();
        await b.drafts.load('shared-recovery');
        a.drafts.write('shared-recovery', draft('page A unsent words'));
        await a.flush();
        b.drafts.write('shared-recovery', draft('page B independent words'));
        await b.flush();
        const versions = await b.drafts.listVersions(b.drafts.scope());
        expect(versions.map(row => row.draft?.text)).toContain('page A unsent words');
        expect(versions.map(row => row.draft?.text)).toContain('page B independent words');
        a.drafts.discard('shared-recovery');
        await a.flush();
        expect((await b.drafts.listVersions(b.drafts.scope())).map(row => row.draft?.text))
            .toContain('page B independent words');
    });

    it('retains orphaned legacy drafts and old journals instead of expiring unread data', async () => {
        const first = await reload(); const db = first.client.getDb();
        const old = { version: 1 as const, text: 'old orphan recovery', attachments: [], largeTextBlocks: [], updatedAt: 1 };
        await db.workspace_tab_drafts.put({ id: 'local\u0000orphan-recovery', account_key: 'local', tab_id: 'orphan-recovery', updated_at: 1, draft: old });
        localStorage.setItem('or3:tab-draft-journal:v1:' + encodeURIComponent('local\u0000local') + ':orphan-recovery', JSON.stringify({ tabId: 'orphan-recovery', updatedAt: 0, draft: { ...old, text: 'independent old journal' } }));
        const second = await reload(); await second.drafts.load('another-tab');
        const versions = await second.drafts.listVersions(second.drafts.scope());
        expect(versions.map(row => row.draft?.text)).toContain('old orphan recovery');
        expect(versions.map(row => row.draft?.text)).toContain('independent old journal');
    });

    it('atomically rejects a delayed set after the same writer discarded its draft', async () => {
        const { client } = await reload(); const db = client.getDb();
        const recovery = await import('~/db/workspace-draft-recovery');
        const common = { account: 'local', tab: 'sequence-recovery', writer: 'synthetic-sequence-writer' };
        const value = { version: 1 as const, text: 'delayed set', attachments: [], largeTextBlocks: [], updatedAt: 1 };
        await recovery.commitDraftVersion(db, { ...common, sequence: 2, draft: null });
        const stale = await recovery.commitDraftVersion(db, { ...common, sequence: 1, draft: value });
        expect(stale.superseded).toBe(true);
        expect(await db.workspace_tab_drafts.get('local\u0000sequence-recovery')).toBeUndefined();
        expect((await recovery.listDraftVersions(db, 'local')).find(row => row.writer_id === common.writer)?.draft).toBeNull();
    });

    it('rolls back every recovery head if the canonical write aborts, then succeeds without losing the other page', async () => {
        const { client } = await reload(); const db = client.getDb();
        const recovery = await import('~/db/workspace-draft-recovery');
        const value = (text: string) => ({ version: 1 as const, text, attachments: [], largeTextBlocks: [], updatedAt: 1 });
        await recovery.commitDraftVersion(db, { account: 'local', tab: 'atomic-recovery', writer: 'atomic-a', sequence: 1, draft: value('durable A') });
        const baseline = await recovery.readDraftBaseline(db, 'local', 'atomic-recovery');
        const rejection = vi.spyOn(db.workspace_tab_drafts, 'put').mockRejectedValueOnce(new DOMException('Synthetic transaction abort', 'AbortError'));
        await expect(recovery.commitDraftVersion(db, { account: 'local', tab: 'atomic-recovery', writer: 'atomic-b', sequence: 1, draft: value('retry B'), baseline })).rejects.toThrow();
        expect((await recovery.listDraftVersions(db, 'local')).map(row => row.draft?.text)).toEqual(['durable A']);
        rejection.mockRestore();
        await recovery.commitDraftVersion(db, { account: 'local', tab: 'atomic-recovery', writer: 'atomic-b', sequence: 1, draft: value('retry B'), baseline });
        expect((await recovery.listDraftVersions(db, 'local')).map(row => row.draft?.text).sort()).toEqual(['durable A', 'retry B']);
    });

    it('refuses recovery selection while attachment bytes are pending and preserves missing hash evidence', async () => {
        const { drafts, flush } = await reload();
        drafts.write('saved-choice', draft('alternative text')); await flush();
        const version = (await drafts.listVersions()).find(row => row.tab_id === 'saved-choice')!;
        drafts.write('pending-choice', draft('keep selected file', { attachments: [{ file: new File(['pending bytes'], 'pending.png'), name: 'pending.png', status: 'pending' } as never], missingAttachments: [{ hash: 'missing-hash', name: 'missing.png', mime: 'image/png', kind: 'image' }] }));
        await expect(drafts.restoreVersion('pending-choice', version)).rejects.toThrow('attachments');
        expect(drafts.read('pending-choice')?.attachments[0]?.file?.size).toBe(13);
        await flush();
        expect((await drafts.listVersions()).find(row => row.tab_id === 'pending-choice')?.draft?.attachments[0]?.hash).toBe('missing-hash');
    });

    it('restoring a version preserves the current buffer and exact removal rejects a changed version', async () => {
        const { drafts, flush } = await reload();
        drafts.write('restore-current', draft('current buffer to preserve')); await flush();
        drafts.write('restore-alternative', draft('chosen alternative')); await flush();
        const selected = (await drafts.listVersions()).find(row => row.tab_id === 'restore-alternative')!;
        await drafts.restoreVersion('restore-current', selected);
        expect(drafts.read('restore-current')?.text).toBe('chosen alternative');
        expect((await drafts.listVersions()).map(row => row.draft?.text)).toContain('current buffer to preserve');
        const displayed = (await drafts.listVersions()).find(row => row.tab_id === 'restore-alternative')!;
        drafts.write('restore-alternative', draft('changed after display')); await flush();
        const { removeDraftVersion } = await import('~/db/workspace-draft-recovery');
        await expect(removeDraftVersion(drafts.scope().db!, 'local', displayed)).rejects.toThrow('changed');
        expect((await drafts.listVersions()).map(row => row.draft?.text)).toContain('changed after display');
    });

    it('keeps unknown journals intact and offers an explicit cleanup path for inactive own tombstones', async () => {
        const { drafts, flush } = await reload();
        drafts.write('inactive-version', draft('close this tab')); await flush();
        drafts.discard('inactive-version'); await flush();
        const closed = (await drafts.listVersions()).find(row => row.tab_id === 'inactive-version')!;
        expect(closed.draft).toBeNull(); await drafts.discardVersion(closed);
        expect((await drafts.listVersions()).some(row => row.id === closed.id)).toBe(false);
        const key = 'or3:tab-draft-journal:v1:' + encodeURIComponent('local\u0000local') + ':unknown';
        localStorage.setItem(key, '{broken synthetic journal');
        const next = await reload(); await expect(next.drafts.load('unknown')).rejects.toThrow();
        expect(localStorage.getItem(key)).toBe('{broken synthetic journal');
    });

    it('rejects capacity overflow without evicting old drafts and retries after explicit cleanup', async () => {
        const { client } = await reload(); const db = client.getDb();
        const recovery = await import('~/db/workspace-draft-recovery');
        const old = { version: 1 as const, text: 'retained old capacity record', attachments: [], largeTextBlocks: [], updatedAt: 1 };
        await db.workspace_draft_versions.bulkPut(Array.from({ length: 200 }, (_, i) => ({ id: `capacity-${i}`, account_key: 'local', tab_id: `old-${i}`, writer_id: `synthetic-${i}`, sequence: 1, updated_at: 1, kind: 'version' as const, draft: old })));
        const input = { account: 'local', tab: 'capacity-new', writer: 'new-capacity-writer', sequence: 1, draft: { ...old, text: 'new buffer after cleanup' } };
        await expect(recovery.commitDraftVersion(db, input)).rejects.toThrow('full');
        expect(await db.workspace_draft_versions.count()).toBe(200);
        expect(await db.workspace_tab_drafts.get('local\u0000capacity-new')).toBeUndefined();
        await recovery.removeDraftVersion(db, 'local', (await recovery.listDraftVersions(db, 'local'))[0]!);
        await recovery.commitDraftVersion(db, input);
        expect((await recovery.listDraftVersions(db, 'local')).filter(row => row.draft?.text === old.text)).toHaveLength(199);
        expect((await db.workspace_tab_drafts.get('local\u0000capacity-new'))?.draft.text).toBe(input.draft.text);
    });

    it('upgrades a v27 database additively without changing drafts, queued state or attachment bytes', async () => {
        const { client } = await reload(); const { default: Dexie } = await import('dexie');
        const name = `synthetic-draft-migration-${Date.now()}`;
        const template = new client.Or3DB(name);
        const stores = Object.fromEntries(template.tables.filter(table => table.name !== 'workspace_draft_versions').map(table => [table.name, [table.schema.primKey.src, ...table.schema.indexes.map(index => index.src)].join(',')]));
        const old = new Dexie(name); old.version(27).stores(stores); await old.open();
        const value = { version: 1 as const, text: 'v27 retained draft', attachments: [{ hash: 'legacy-blob', name: 'legacy.txt', mime: 'text/plain', kind: 'image' as const }], largeTextBlocks: [], updatedAt: 1 };
        await old.table('workspace_tab_drafts').put({ id: 'local\u0000legacy-tab', account_key: 'local', tab_id: 'legacy-tab', updated_at: 1, draft: value });
        await old.table('kv').put({ id: 'legacy-sentinel', name: 'synthetic-preserve', value: 'unchanged' });
        await old.table('pending_ops').put({ id: 'legacy-op', status: 'pending', createdAt: 1, readyAt: 0, payload: { synthetic: true } });
        await old.table('file_blobs').put({ hash: 'legacy-blob', blob: new NodeBlob(['synthetic legacy bytes']) as unknown as Blob });
        old.close();
        try {
            await template.open(); expect(template.verno).toBe(28);
            expect((await template.workspace_tab_drafts.get('local\u0000legacy-tab'))?.draft).toEqual(value);
            expect((await template.kv.get('legacy-sentinel'))?.value).toBe('unchanged');
            expect((await template.pending_ops.get('legacy-op'))?.id).toBe('legacy-op');
            expect((await template.file_blobs.get('legacy-blob'))?.blob.size).toBe(22);
            expect(await template.workspace_draft_versions.count()).toBe(0);
        } finally { template.close(); await Dexie.delete(name); }
    });

    it('compacts acknowledged immutable journal keys while retaining a later failed operation', async () => {
        const { drafts, flush, client } = await reload();
        for (let i = 0; i < 12; i++) drafts.write('journal-compaction', draft(`synthetic keystroke ${i}`));
        expect(journalKeys()).toHaveLength(12); await flush(); expect(journalKeys()).toEqual([]);
        const rejection = vi.spyOn(client.getDb().workspace_tab_drafts, 'put').mockRejectedValueOnce(new Error('Synthetic later failure'));
        drafts.write('journal-compaction', draft('latest unacknowledged operation')); await flush();
        expect(journalKeys()).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem(journalKeys()[0]!)!).draft.text).toBe('latest unacknowledged operation');
        rejection.mockRestore(); await flush(); expect(journalKeys()).toEqual([]);
    });

    it('keeps an operation floor after explicit removal so a delayed foreign retry cannot resurrect it', async () => {
        const { client } = await reload(); const db = client.getDb();
        const recovery = await import('~/db/workspace-draft-recovery');
        const input = { account: 'local', tab: 'explicit-discard-race', writer: 'synthetic-foreign-writer', sequence: 4,
            draft: { version: 1 as const, text: 'explicitly discarded alternative', attachments: [], largeTextBlocks: [], updatedAt: 1 } };
        await recovery.commitDraftVersion(db, input);
        await recovery.removeDraftVersion(db, 'local', (await recovery.listDraftVersions(db, 'local'))[0]!);
        expect((await recovery.commitDraftVersion(db, { ...input, sequence: 3 })).superseded).toBe(true);
        expect(await db.workspace_tab_drafts.get('local\u0000explicit-discard-race')).toBeUndefined();
        expect(await recovery.listDraftVersions(db, 'local')).toEqual([]);
        expect((await db.workspace_draft_versions.get(recovery.draftVersionId('local', input.tab, input.writer)))?.draft).toBeNull();
    });

    it('rejects interrupted hydration instead of pretending the saved draft is absent, then retries', async () => {
        const first = await reload();
        first.drafts.write('read-fault-tab', draft('Saved draft before interrupted read'));
        await first.flush();
        const second = await reload();
        const table = second.client.getDb().workspace_tab_drafts;
        vi.spyOn(table, 'where').mockReturnValueOnce({ equals: () => ({
            toArray: () => Promise.reject(new DOMException('Synthetic draft read aborted', 'AbortError')),
        }) } as never);
        await expect(second.drafts.load('read-fault-tab')).rejects.toThrow('Synthetic draft read aborted');
        expect((await table.toArray())[0]?.draft.text).toBe('Saved draft before interrupted read');
        expect((await second.drafts.load('read-fault-tab'))?.text).toBe('Saved draft before interrupted read');
        second.drafts.discard('read-fault-tab');
        await second.flush();
    });

    it('restores text, editor JSON, settings and large pasted blocks after a reload', async () => {
        const first = await reload();
        const block = { id: 'b1', text: 'long pasted text', wordCount: 3, preview: 'long', previewFull: 'long pasted text' };
        first.drafts.write('tab-1', draft('unsent words', {
            editorJson: { type: 'doc', content: [{ type: 'paragraph' }] }, composer, largeTextBlocks: [block],
        }));
        await first.flush();

        const second = await reload();
        expect(second.drafts.read('tab-1')).toBeUndefined();
        expect(await second.drafts.load('tab-1')).toMatchObject({
            text: 'unsent words', editorJson: { type: 'doc' }, composer, largeTextBlocks: [block],
        });
    });

    it('keeps attachments as file references and rebuilds them from the stored bytes', async () => {
        const first = await reload();
        const db = first.client.getDb();
        await db.file_meta.put({ hash: 'h-kept', name: 'kept.png', mime_type: 'image/png', kind: 'image', size_bytes: 3, deleted: false, ref_count: 1 } as never);
        await db.file_blobs.put({ hash: 'h-kept', blob: new Blob(['png'], { type: 'image/png' }) });
        await db.file_meta.put({ hash: 'h-gone', name: 'gone.pdf', mime_type: 'application/pdf', kind: 'pdf', size_bytes: 3, deleted: false, ref_count: 1 } as never);
        const attachment = (name: string, hash: string | undefined, status: 'ready' | 'pending', mime: string, kind: 'image' | 'pdf') =>
            ({ file: new File(['x'], name, { type: mime }), url: 'blob:preview', name, hash, status, mime, kind }) as never;
        first.drafts.write('tab-1', draft('', { attachments: [
            attachment('kept.png', 'h-kept', 'ready', 'image/png', 'image'),
            attachment('gone.pdf', 'h-gone', 'ready', 'application/pdf', 'pdf'),
            attachment('uploading.png', undefined, 'pending', 'image/png', 'image'),
        ] }));
        await first.flush();
        expect((await db.workspace_tab_drafts.toArray())[0]?.draft.attachments.map((item) => item.hash)).toEqual(['h-kept', 'h-gone']);

        const second = await reload();
        const restored = await second.drafts.load('tab-1');
        expect(restored?.attachments).toHaveLength(1);
        expect(restored?.attachments[0]).toMatchObject({ hash: 'h-kept', name: 'kept.png', status: 'ready', kind: 'image' });
        expect(restored?.attachments[0]?.file).toBeInstanceOf(File);
        // The file whose bytes are gone is reported so the user can attach it again.
        expect(restored?.missingAttachments?.map((item) => item.name)).toEqual(['gone.pdf']);
        expect(restored?.attachmentRefs).toBeUndefined();
    });

    it('keeps attachment references retryable when one local blob read is interrupted', async () => {
        const first = await reload(); const db = first.client.getDb();
        for (const hash of ['attachment-ok', 'attachment-read-fault']) {
            await db.file_meta.put({ hash, name: `${hash}.png`, mime_type: 'image/png', kind: 'image',
                size_bytes: 3, deleted: false, ref_count: 1 } as never);
            await db.file_blobs.put({ hash, blob: new Blob(['png'], { type: 'image/png' }) });
        }
        first.drafts.write('attachment-read-tab', draft('Saved attachment recovery buffer', { attachmentRefs:
            ['attachment-ok', 'attachment-read-fault'].map(hash => ({ hash, name: `${hash}.png`, mime: 'image/png', kind: 'image' as const })) }));
        await first.flush();
        const second = await reload(); const table = second.client.getDb().file_blobs; const get = table.get.bind(table);
        const fault = vi.spyOn(table, 'get').mockImplementation((key: unknown) => (key === 'attachment-read-fault'
            ? Promise.reject(new DOMException('Synthetic attachment read aborted', 'AbortError')) : get(key as string)) as never);
        const create = vi.fn(() => 'blob:synthetic-restored-attachment'); const revoke = vi.fn();
        vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
        await expect(second.drafts.load('attachment-read-tab')).rejects.toThrow('Synthetic attachment read aborted');
        expect(second.drafts.read('attachment-read-tab')?.attachmentRefs).toHaveLength(2);
        expect(second.drafts.read('attachment-read-tab')?.missingAttachments).toBeUndefined();
        expect(revoke).toHaveBeenCalledWith('blob:synthetic-restored-attachment');
        expect((await second.client.getDb().workspace_tab_drafts.toArray())[0]?.draft.attachments).toHaveLength(2);
        fault.mockRestore();
        expect((await second.drafts.load('attachment-read-tab'))?.attachments.map(item => item.hash))
            .toEqual(['attachment-ok', 'attachment-read-fault']);
        second.drafts.discard('attachment-read-tab'); await second.flush();
    });

    it('protects unjournaled in-flight bytes and accepts unchanged content after a confirmed receipt', async () => {
        const { client, drafts, flush } = await reload(); const table = client.getDb().workspace_tab_drafts;
        const recovery = await import('~/db/workspace-draft-recovery'); const commit = recovery.commitDraftVersion; let finish!: () => Promise<void>;
        const held = vi.spyOn(recovery, 'commitDraftVersion').mockImplementationOnce((db, input) => new Promise(resolve => {
            finish = async () => resolve(await commit(db, input));
        }) as never);
        const text = 'L'.repeat(150_000);
        drafts.write('large-pending-tab', draft(text));
        expect(journalKeys()).toEqual([]); expect(drafts.needsUnloadConfirmation()).toBe(true);
        const writing = flush(); await vi.waitFor(() => expect(finish).toBeDefined());
        expect(drafts.needsUnloadConfirmation()).toBe(true);
        await finish(); await writing;
        expect(drafts.needsUnloadConfirmation()).toBe(false);
        drafts.write('large-pending-tab', draft(text, { updatedAt: Date.now() + 1 }));
        expect(drafts.needsUnloadConfirmation()).toBe(false);
        held.mockRestore(); await flush(); drafts.discard('large-pending-tab'); await flush();
    });

    it('uses a synchronous journal for pending small drafts, but guards a blocked journal', async () => {
        const { client, drafts, flush } = await reload();
        const recovery = await import('~/db/workspace-draft-recovery'); const commit = recovery.commitDraftVersion;
        const completions: Array<() => Promise<void>> = [];
        const held = vi.spyOn(recovery, 'commitDraftVersion').mockImplementation((db, input) => new Promise(resolve => {
            completions.push(async () => resolve(await commit(db, input)));
        }) as never);
        drafts.write('journal-guard-tab', draft('Small journal protects these bytes'));
        const writing = flush(); expect(drafts.needsUnloadConfirmation()).toBe(false);
        const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Synthetic journal quota', 'QuotaExceededError'); });
        drafts.write('journal-guard-tab', draft('Different bytes without a journal'));
        expect(drafts.needsUnloadConfirmation()).toBe(true);
        storage.mockRestore(); held.mockRestore();
        for (const complete of completions) await complete(); await writing;
        await flush(); drafts.discard('journal-guard-tab'); await flush();
    });

    it('guards files still preparing even when the text has a synchronous journal', async () => {
        const { drafts, flush } = await reload();
        const attachment = { file: new File(['synthetic pending bytes'], 'pending.png', { type: 'image/png' }),
            name: 'pending.png', url: '', mime: 'image/png', kind: 'image', status: 'pending' } as never;
        drafts.write('pending-file-tab', draft('Journaled text with an uncommitted file', { attachments: [attachment] }));
        expect(drafts.needsUnloadConfirmation()).toBe(true);
        await flush();
        // The pending file cannot be reconstructed from that text-only receipt.
        expect(drafts.needsUnloadConfirmation()).toBe(true);
        drafts.discard('pending-file-tab'); await flush();
    });

    it('restores a large receipt after reload without warning on unchanged recapture', async () => {
        const first = await reload(); const text = 'R'.repeat(150_000);
        first.drafts.write('restored-large-tab', draft(text)); await first.flush();
        const second = await reload(); await second.drafts.load('restored-large-tab');
        second.drafts.write('restored-large-tab', draft(text, { updatedAt: Date.now() + 1 }));
        expect(second.drafts.needsUnloadConfirmation()).toBe(false);
        await second.flush(); second.drafts.discard('restored-large-tab'); await second.flush();
    });

    it('never shows one account\'s draft to another account in the same workspace', async () => {
        session.userId = 'user-a';
        const first = await reload();
        first.drafts.write('tab-1', draft('account A secret'));
        await first.flush();

        session.userId = 'user-b';
        const second = await reload();
        expect(await second.drafts.load('tab-1')).toBeUndefined();
        expect(second.drafts.read('tab-1')).toBeUndefined();

        session.userId = 'user-a';
        expect((await second.drafts.load('tab-1'))?.text).toBe('account A secret');
    });

    it('files a late write under the scope it was captured in, not the new account', async () => {
        session.userId = 'user-a';
        const { drafts, flush } = await reload();
        const ownerScope = drafts.scope();
        session.userId = 'user-b';
        drafts.write('tab-1', draft('typed as A, written after the switch'), ownerScope);
        await flush();

        expect(drafts.read('tab-1')).toBeUndefined();
        session.userId = 'user-a';
        expect(drafts.read('tab-1')?.text).toBe('typed as A, written after the switch');
    });

    it('keeps drafts in the workspace database they were written for', async () => {
        const { client, drafts, flush } = await reload();
        client.setActiveWorkspaceDb('workspace-a');
        drafts.write('tab-1', draft('workspace A draft'));
        await flush();
        const workspaceADb = client.getDb();

        client.setActiveWorkspaceDb('workspace-b');
        expect(await drafts.load('tab-1')).toBeUndefined();
        expect(await client.getDb().workspace_tab_drafts.count()).toBe(0);
        expect(await workspaceADb.workspace_tab_drafts.count()).toBe(1);
    });

    it('retries a retained draft in its original workspace after that DB handle is replaced', async () => {
        const { client, drafts, flush } = await reload();
        const original = client.setActiveWorkspaceDb('draft-closed-origin');
        await original.open();
        const capturedScope = drafts.scope();
        const rejection = vi.spyOn(original.workspace_tab_drafts, 'put')
            .mockRejectedValue(new DOMException('Synthetic quota', 'QuotaExceededError'));
        drafts.write('retained-tab', draft('Recover after handle replacement'));
        await flush();
        expect(drafts.saveFailed.value).toBe(true);
        rejection.mockRestore();
        const other = client.setActiveWorkspaceDb('draft-closed-other');
        await other.open();
        client.evictWorkspaceDb('draft-closed-origin');
        expect(original.isOpen()).toBe(false);
        const replacement = client.setActiveWorkspaceDb('draft-closed-origin');
        await replacement.open();
        expect(replacement).not.toBe(original);
        expect((await drafts.load('retained-tab'))?.text).toBe('Recover after handle replacement');
        await flush();
        expect(drafts.saveFailed.value).toBe(false);
        expect((await replacement.workspace_tab_drafts.toArray())[0]?.draft.text).toBe('Recover after handle replacement');
        expect(await other.workspace_tab_drafts.count()).toBe(0);
        client.setActiveWorkspaceDb('draft-closed-other');
        drafts.write('retained-tab', draft('Late callback still belongs to the origin'), capturedScope);
        await flush();
        expect((await replacement.workspace_tab_drafts.toArray())[0]?.draft.text).toBe('Late callback still belongs to the origin');
        expect(await other.workspace_tab_drafts.count()).toBe(0);
        expect(original.isOpen()).toBe(false);
        drafts.discard('retained-tab', capturedScope);
        await flush();
    });

    it('deletes the saved draft on discard, even before a pending write fires', async () => {
        const { client, drafts, flush } = await reload();
        drafts.write('tab-1', draft('saved'));
        await flush();
        expect(await client.getDb().workspace_tab_drafts.count()).toBe(1);

        drafts.write('tab-1', draft('saved, then edited'));
        drafts.discard('tab-1');
        await flush();
        await vi.waitFor(async () => expect(await client.getDb().workspace_tab_drafts.count()).toBe(0));
    });

    it('does not save empty drafts and removes the saved one when the text is cleared', async () => {
        const { client, drafts, flush } = await reload();
        drafts.write('tab-1', draft('words'));
        await flush();
        drafts.write('tab-1', draft('   '));
        await flush();
        expect(await client.getDb().workspace_tab_drafts.count()).toBe(0);
    });

    it('keeps oversized drafts in memory and retains old drafts without automatic eviction', async () => {
        const { client, drafts, flush } = await reload();
        const db = client.getDb();
        drafts.write('huge', draft('x'.repeat(600_000)));
        for (let i = 0; i < 52; i += 1) drafts.write(`tab-${i}`, draft(`draft ${i}`, { updatedAt: Date.now() + i }));
        await flush();

        const rows = await db.workspace_tab_drafts.toArray();
        expect(rows.some((row) => row.tab_id === 'huge')).toBe(false);
        expect(drafts.read('huge')?.text).toHaveLength(600_000);
        expect(rows).toHaveLength(52);
        expect(rows.some((row) => row.tab_id === 'tab-0')).toBe(true);
        expect(rows.some((row) => row.tab_id === 'tab-51')).toBe(true);

        await db.workspace_tab_drafts.put({ id: 'local\u0000stale', account_key: 'local', tab_id: 'stale', updated_at: Date.now() - 31 * 24 * 60 * 60 * 1000, draft: { version: 1, text: 'old', attachments: [], largeTextBlocks: [], updatedAt: 1 } });
        const second = await reload();
        expect((await second.drafts.load('stale'))?.text).toBe('old');
        expect(await second.client.getDb().workspace_tab_drafts.get('local\u0000stale')).toBeDefined();
    });

    it('keeps a draft dirty when storage rejects the write, reports it, and saves it on the next flush', async () => {
        const { client, drafts, flush } = await reload();
        const table = client.getDb().workspace_tab_drafts;
        const failing = vi.spyOn(table, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
        drafts.write('tab-1', draft('not stored the first time'));
        await flush();
        expect(drafts.saveFailed.value).toBe(true);
        expect(await table.count()).toBe(0);

        // Nothing new was typed; the failed draft itself must still be pending.
        await flush();
        expect(failing).toHaveBeenCalledTimes(2);
        expect(await table.count()).toBe(1);
        expect(drafts.saveFailed.value).toBe(false);
    });

    it('retries a failed write on its own without another edit', async () => {
        const { client, drafts, flush } = await reload();
        const table = client.getDb().workspace_tab_drafts;
        vi.spyOn(table, 'put').mockRejectedValueOnce(new DOMException('blocked', 'SecurityError'));
        drafts.write('tab-1', draft('retried by the timer'));
        await flush();
        expect(drafts.saveFailed.value).toBe(true);

        await vi.waitFor(async () => expect(await table.count()).toBe(1), { timeout: 4_000 });
        await vi.waitFor(() => expect(drafts.saveFailed.value).toBe(false));
    });

    const journalKeys = () => Object.keys(localStorage).filter((key) => key.startsWith('or3:tab-draft-journal:'));

    it('keeps the newer same-millisecond journal while an older draft write completes', async () => {
        const first = await reload();
        const table = first.client.getDb().workspace_tab_drafts;
        const recovery = await import('~/db/workspace-draft-recovery'); const commit = recovery.commitDraftVersion;
        let finishWrite!: () => Promise<void>;
        vi.spyOn(recovery, 'commitDraftVersion').mockImplementationOnce((db, input) => new Promise(resolve => {
            finishWrite = async () => { resolve(await commit(db, input)); };
        }) as never);
        const updatedAt = Date.now();
        first.drafts.write('tab-1', draft('Earlier buffer', { updatedAt }));
        const saving = first.flush();
        await vi.waitFor(() => expect(finishWrite).toBeDefined());
        first.drafts.write('tab-1', draft('Later buffer in the same millisecond', { updatedAt }));
        await finishWrite();
        await saving;
        expect(journalKeys()).toHaveLength(1);
        // Simulate a page ending before the later IndexedDB write starts.
        const second = await reload();
        expect((await second.drafts.load('tab-1'))?.text).toBe('Later buffer in the same millisecond');
        await second.flush();
    });

    it('reports an oversized draft as unsaved without deleting its previous durable copy', async () => {
        const { client, drafts, flush } = await reload();
        drafts.write('tab-1', draft('Previous durable buffer'));
        await flush();
        drafts.write('tab-1', draft('x'.repeat(600_000)));
        await flush();
        expect(drafts.saveFailed.value).toBe(true);
        expect((await client.getDb().workspace_tab_drafts.toArray())[0]?.draft.text).toBe('Previous durable buffer');
        expect(drafts.read('tab-1')?.text).toHaveLength(600_000);
    });

    it('keeps a same-millisecond discard journal when an older save completes', async () => {
        const first = await reload();
        const table = first.client.getDb().workspace_tab_drafts;
        const recovery = await import('~/db/workspace-draft-recovery'); const commit = recovery.commitDraftVersion;
        let finishWrite!: () => Promise<void>;
        vi.spyOn(recovery, 'commitDraftVersion').mockImplementationOnce((db, input) => new Promise(resolve => {
            finishWrite = async () => { resolve(await commit(db, input)); };
        }) as never);
        vi.spyOn(recovery, 'commitDraftVersion').mockImplementationOnce(() => new Promise(() => undefined));
        const updatedAt = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(updatedAt);
        first.drafts.write('tab-1', draft('Submitted draft', { updatedAt }));
        const saving = first.flush();
        await vi.waitFor(() => expect(finishWrite).toBeDefined());
        first.drafts.discard('tab-1');
        await finishWrite();
        await saving;
        const second = await reload();
        expect(await second.drafts.load('tab-1')).toBeUndefined();
        expect(await second.client.getDb().workspace_tab_drafts.count()).toBe(0);
        expect(journalKeys()).toEqual([]);
    });

    it('keeps another tab save failure visible when an overlapping successful flush finishes', async () => {
        const { client, drafts, flush } = await reload();
        const table = client.getDb().workspace_tab_drafts;
        const recovery = await import('~/db/workspace-draft-recovery'); const commit = recovery.commitDraftVersion;
        let failSave!: () => void;
        let finishSave!: () => Promise<void>;
        const writes = vi.spyOn(recovery, 'commitDraftVersion').mockImplementation((db, input) => new Promise((resolve, reject) => {
            if (input.tab === 'failed-tab') {
                failSave = () => reject(new DOMException('Synthetic storage full', 'QuotaExceededError'));
            } else {
                finishSave = async () => { resolve(await commit(db, input)); };
            }
        }) as never);
        drafts.write('failed-tab', draft('Still unsaved'));
        const failedFlush = flush();
        await vi.waitFor(() => expect(failSave).toBeDefined());
        drafts.write('saved-tab', draft('Independent saved buffer'));
        const successfulFlush = flush();
        await vi.waitFor(() => expect(finishSave).toBeDefined());
        failSave();
        await failedFlush;
        expect(drafts.saveFailed.value).toBe(true);
        await finishSave();
        await successfulFlush;
        expect(drafts.saveFailed.value).toBe(true);
        expect(drafts.read('failed-tab')?.text).toBe('Still unsaved');
        writes.mockRestore();
        await flush();
        expect(drafts.saveFailed.value).toBe(false);
        expect((await table.toArray()).filter(row => ['failed-tab', 'saved-tab'].includes(row.tab_id))
            .map(row => row.tab_id).sort()).toEqual(['failed-tab', 'saved-tab']);
    });

    it('does not acknowledge a newer failed edit when an older save of the same tab finishes', async () => {
        const { client, drafts, flush } = await reload();
        const table = client.getDb().workspace_tab_drafts;
        const recovery = await import('~/db/workspace-draft-recovery'); const commit = recovery.commitDraftVersion;
        let finishOlder!: () => Promise<void>;
        const writes = vi.spyOn(recovery, 'commitDraftVersion').mockImplementation((db, input) => {
            if (input.draft?.text === 'Older same-tab snapshot') return new Promise(resolve => {
                finishOlder = async () => resolve(await commit(db, input));
            }) as never;
            return Promise.reject(new DOMException('Synthetic latest-edit quota', 'QuotaExceededError')) as never;
        });
        drafts.write('same-tab', draft('Older same-tab snapshot'));
        const older = flush(); await vi.waitFor(() => expect(finishOlder).toBeDefined());
        drafts.write('same-tab', draft('Newer unsaved buffer'));
        await flush(); expect(drafts.saveFailed.value).toBe(true);
        await finishOlder(); await older;
        expect(drafts.saveFailed.value).toBe(true);
        expect(drafts.read('same-tab')?.text).toBe('Newer unsaved buffer');
        expect((await table.toArray()).find(row => row.tab_id === 'same-tab')?.draft.text).toBe('Older same-tab snapshot');
        writes.mockRestore(); await flush();
        expect(drafts.saveFailed.value).toBe(false);
        expect((await table.toArray()).find(row => row.tab_id === 'same-tab')?.draft.text).toBe('Newer unsaved buffer');
        drafts.discard('same-tab'); await flush();
    });

    it('clears a failed tab warning once its explicit discard is durable', async () => {
        const { client, drafts, flush } = await reload();
        const table = client.getDb().workspace_tab_drafts;
        vi.spyOn(table, 'put').mockRejectedValueOnce(new DOMException('Synthetic quota', 'QuotaExceededError'));
        drafts.write('failed-tab', draft('Discard this failed buffer'));
        await flush();
        expect(drafts.saveFailed.value).toBe(true);
        drafts.discard('failed-tab');
        await vi.waitFor(() => expect(drafts.saveFailed.value).toBe(false));
        expect((await table.toArray()).filter(row => row.tab_id === 'failed-tab')).toEqual([]);
    });

    it('retains the discard journal and warns when immediate deletion fails, then retries it', async () => {
        const { client, drafts, flush } = await reload(); const table = client.getDb().workspace_tab_drafts;
        drafts.write('failed-delete-tab', draft('Delete after explicit discard')); await flush();
        const rejection = vi.spyOn(table, 'delete').mockRejectedValue(new DOMException('Synthetic rejected deletion', 'AbortError'));
        drafts.discard('failed-delete-tab');
        await vi.waitFor(() => expect(drafts.saveFailed.value).toBe(true));
        expect(journalKeys()).not.toEqual([]);
        expect((await table.toArray()).find(row => row.tab_id === 'failed-delete-tab')).toBeDefined();
        rejection.mockRestore(); await flush();
        expect(drafts.saveFailed.value).toBe(false);
        expect((await table.toArray()).find(row => row.tab_id === 'failed-delete-tab')).toBeUndefined();
        expect(journalKeys()).toEqual([]);
    });

    it('recovers the last edit when the page unloaded before IndexedDB committed it', async () => {
        const first = await reload();
        const table = first.client.getDb().workspace_tab_drafts;
        first.drafts.write('tab-1', draft('saved earlier'));
        await first.flush();
        // From here on the browser drops database writes, as it does for an unloading page.
        const recovery = await import('~/db/workspace-draft-recovery');
        vi.spyOn(recovery, 'commitDraftVersion').mockImplementationOnce(() => new Promise(() => undefined));
        first.drafts.write('tab-1', draft('typed right before unload', { updatedAt: Date.now() + 5 }));
        void first.flush();

        const second = await reload();
        expect((await second.drafts.load('tab-1'))?.text).toBe('typed right before unload');
        // The recovered draft is written back and the journal removed once that is confirmed.
        await second.flush();
        expect((await second.client.getDb().workspace_tab_drafts.toArray())[0]?.draft.text).toBe('typed right before unload');
        expect(journalKeys()).toEqual([]);
    });

    it('does not bring back a discarded draft when the delete never committed', async () => {
        const first = await reload();
        const table = first.client.getDb().workspace_tab_drafts;
        first.drafts.write('tab-1', draft('already sent'));
        await first.flush();
        const recovery = await import('~/db/workspace-draft-recovery');
        vi.spyOn(recovery, 'commitDraftVersion').mockImplementationOnce(() => new Promise(() => undefined));
        first.drafts.discard('tab-1');

        const second = await reload();
        expect(await second.drafts.load('tab-1')).toBeUndefined();
        expect(await second.client.getDb().workspace_tab_drafts.count()).toBe(0);
        expect(journalKeys()).toEqual([]);
    });

    it('clears the journal as soon as IndexedDB holds the draft, and keeps it per account and workspace', async () => {
        session.userId = 'user-a';
        const { client, drafts, flush } = await reload();
        client.setActiveWorkspaceDb('workspace-a');
        drafts.write('tab-1', draft('journaled first'));
        expect(journalKeys()).toHaveLength(1);
        expect(journalKeys()[0]).toContain(encodeURIComponent('workspace-a\u0000user-a'));
        await flush();
        expect(journalKeys()).toEqual([]);
    });

    it('lets an edit made while saved drafts load win over the saved copy', async () => {
        const first = await reload();
        first.drafts.write('tab-1', draft('saved copy'));
        await first.flush();

        const second = await reload();
        const loading = second.drafts.load('tab-1');
        second.drafts.write('tab-1', draft('typed during load'));
        await loading;
        expect(second.drafts.read('tab-1')?.text).toBe('typed during load');
    });
});
