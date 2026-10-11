import 'fake-indexeddb/auto';
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
        await client.getDb().file_blobs.clear();
        await client.getDb().file_meta.clear();
        vi.unstubAllGlobals();
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

    it('bounds what is kept: oversized drafts stay in memory, old ones expire, the newest 50 survive', async () => {
        const { client, drafts, flush } = await reload();
        const db = client.getDb();
        drafts.write('huge', draft('x'.repeat(600_000)));
        for (let i = 0; i < 52; i += 1) drafts.write(`tab-${i}`, draft(`draft ${i}`, { updatedAt: Date.now() + i }));
        await flush();

        const rows = await db.workspace_tab_drafts.toArray();
        expect(rows.some((row) => row.tab_id === 'huge')).toBe(false);
        expect(drafts.read('huge')?.text).toHaveLength(600_000);
        expect(rows).toHaveLength(50);
        expect(rows.some((row) => row.tab_id === 'tab-0')).toBe(false);
        expect(rows.some((row) => row.tab_id === 'tab-51')).toBe(true);

        await db.workspace_tab_drafts.put({ id: 'local\u0000stale', account_key: 'local', tab_id: 'stale', updated_at: Date.now() - 31 * 24 * 60 * 60 * 1000, draft: { version: 1, text: 'old', attachments: [], largeTextBlocks: [], updatedAt: 1 } });
        const second = await reload();
        expect(await second.drafts.load('stale')).toBeUndefined();
        expect(await second.client.getDb().workspace_tab_drafts.get('local\u0000stale')).toBeUndefined();
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
        const put = table.put.bind(table);
        let finishWrite!: () => Promise<void>;
        vi.spyOn(table, 'put').mockImplementationOnce(row => new Promise(resolve => {
            finishWrite = async () => { resolve(await put(row)); };
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
        const put = table.put.bind(table);
        let finishWrite!: () => Promise<void>;
        vi.spyOn(table, 'put').mockImplementationOnce(row => new Promise(resolve => {
            finishWrite = async () => { resolve(await put(row)); };
        }) as never);
        vi.spyOn(table, 'delete').mockImplementationOnce(() => new Promise(() => undefined) as never);
        const updatedAt = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(updatedAt);
        first.drafts.write('tab-1', draft('Submitted draft', { updatedAt }));
        const saving = first.flush();
        await vi.waitFor(() => expect(finishWrite).toBeDefined());
        first.drafts.discard('tab-1');
        await finishWrite();
        await saving;
        expect(journalKeys()).toHaveLength(1);
        const second = await reload();
        expect(await second.drafts.load('tab-1')).toBeUndefined();
        expect(await second.client.getDb().workspace_tab_drafts.count()).toBe(0);
        expect(journalKeys()).toEqual([]);
    });

    it('keeps another tab save failure visible when an overlapping successful flush finishes', async () => {
        const { client, drafts, flush } = await reload();
        const table = client.getDb().workspace_tab_drafts;
        const put = table.put.bind(table);
        let failSave!: () => void;
        let finishSave!: () => Promise<void>;
        const writes = vi.spyOn(table, 'put').mockImplementation(row => new Promise((resolve, reject) => {
            if (row.tab_id === 'failed-tab') {
                failSave = () => reject(new DOMException('Synthetic storage full', 'QuotaExceededError'));
            } else {
                finishSave = async () => { resolve(await put(row)); };
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

    it('recovers the last edit when the page unloaded before IndexedDB committed it', async () => {
        const first = await reload();
        const table = first.client.getDb().workspace_tab_drafts;
        first.drafts.write('tab-1', draft('saved earlier'));
        await first.flush();
        // From here on the browser drops database writes, as it does for an unloading page.
        vi.spyOn(table, 'put').mockImplementation(() => new Promise(() => undefined) as never);
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
        vi.spyOn(table, 'delete').mockImplementation(() => new Promise(() => undefined) as never);
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
