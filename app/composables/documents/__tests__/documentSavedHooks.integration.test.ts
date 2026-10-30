import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';

const fixture = vi.hoisted(() => ({
    currentDb: { name: 'workspace-a' } as { name: string },
    workspace: null as unknown,
    dispatch: vi.fn(),
}));
vi.mock('~/db/client', () => ({ getDb: () => fixture.currentDb }));
vi.mock('~/db/documents', () => ({ createDocumentInDb: vi.fn(), getDocumentInDb: vi.fn(), updateDocumentInDb: vi.fn() }));
vi.mock('~/utils/multiPaneApi', () => ({ getGlobalMultiPaneApi: () => fixture.workspace }));
vi.mock('~/core/hooks/useHooks', () => ({ useHooks: () => ({ doAction: fixture.dispatch }) }));
vi.mock('#imports', () => ({ useToast: () => ({ add: vi.fn() }) }));

import { loadDocument, setDocumentTitle, flush, useDocumentState } from '../useDocumentsStore';
import * as documentsDb from '~/db/documents';
import { useDocumentSaveHooks } from '~/composables/core/useDocumentSaveHooks';
import type { UseMultiPaneApi } from '~/composables/core/useMultiPane';

const doc = { id: 'hook-document', title: 'Original', content: { type: 'doc' as const, content: [] }, created_at: 1, updated_at: 1, deleted: false };
const panes = [{ id: 'one', mode: 'doc', documentId: doc.id }, { id: 'other', mode: 'chat' }, { id: 'two', mode: 'doc', documentId: doc.id }];

describe('document save hook contract', () => {
    let scope: EffectScope;
    beforeEach(async () => {
        vi.useFakeTimers();
        fixture.currentDb = { name: 'workspace-a' };
        fixture.workspace = { panes: ref(panes) };
        scope = effectScope();
        scope.run(() => useDocumentSaveHooks(fixture.workspace as UseMultiPaneApi));
        fixture.dispatch.mockReset();
        vi.mocked(documentsDb.getDocumentInDb).mockResolvedValue(doc);
        vi.mocked(documentsDb.updateDocumentInDb).mockReset();
        await loadDocument(doc.id);
    });
    afterEach(() => { scope.stop(); vi.clearAllTimers(); vi.useRealTimers(); });

    it('emits once per displaying pane after the saved state is committed and before flush resolves', async () => {
        const order: string[] = [];
        vi.mocked(documentsDb.updateDocumentInDb).mockResolvedValue({ ...doc, title: 'Saved' });
        fixture.dispatch.mockImplementation(() => { expect(useDocumentState(doc.id).status).toBe('saved'); order.push('hook'); });
        setDocumentTitle(doc.id, 'Saved');
        await flush(doc.id).then(() => order.push('flush'));
        expect(order).toEqual(['hook', 'hook', 'flush']);
        expect(fixture.dispatch.mock.calls).toEqual([0, 2].map(index => ['ui.pane.doc:action:saved', {
            pane: panes[index], oldDocumentId: doc.id, newDocumentId: doc.id, paneIndex: index, meta: { reason: 'docStoreFlush' },
        }]));
        await flush(doc.id);
        expect(fixture.dispatch).toHaveBeenCalledTimes(2);
    });

    it('notifies on the debounced autosave but not a failed save', async () => {
        vi.mocked(documentsDb.updateDocumentInDb).mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce({ ...doc, title: 'Saved' });
        setDocumentTitle(doc.id, 'Saved');
        await vi.advanceTimersByTimeAsync(750);
        expect(useDocumentState(doc.id).pendingTitle).toBe('Saved');
        expect(fixture.dispatch).not.toHaveBeenCalled();
        setDocumentTitle(doc.id, 'Saved');
        await vi.advanceTimersByTimeAsync(750);
        expect(fixture.dispatch).toHaveBeenCalledTimes(2);
    });

    it('notifies each completed generation once with concurrent flushes and intervening edits', async () => {
        let finish!: (value: typeof doc) => void;
        vi.mocked(documentsDb.updateDocumentInDb).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
            .mockResolvedValueOnce({ ...doc, title: 'Second' });
        setDocumentTitle(doc.id, 'First');
        const first = flush(doc.id);
        const second = flush(doc.id);
        setDocumentTitle(doc.id, 'Second');
        finish({ ...doc, title: 'First' });
        await Promise.all([first, second]);
        expect(documentsDb.updateDocumentInDb).toHaveBeenCalledTimes(2);
        expect(fixture.dispatch).toHaveBeenCalledTimes(4);
    });

    it('does not retain a server-rendered workspace as a save observer', async () => {
        scope.stop();
        scope = effectScope();
        vi.stubGlobal('window', undefined);
        try {
            scope.run(() => useDocumentSaveHooks(fixture.workspace as UseMultiPaneApi));
        } finally {
            vi.unstubAllGlobals();
        }
        vi.mocked(documentsDb.updateDocumentInDb).mockResolvedValue({ ...doc, title: 'Saved' });
        setDocumentTitle(doc.id, 'Saved');
        await flush(doc.id);
        expect(fixture.dispatch).not.toHaveBeenCalled();
    });

    it('does not notify the new workspace when an old workspace save finishes', async () => {
        let finish!: (value: typeof doc) => void;
        vi.mocked(documentsDb.updateDocumentInDb).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const origin = fixture.currentDb;
        setDocumentTitle(doc.id, 'Saved');
        const saving = flush(doc.id, origin as never);
        fixture.currentDb = { name: 'workspace-b' };
        finish({ ...doc, title: 'Saved' });
        await saving;
        expect(fixture.dispatch).not.toHaveBeenCalled();
    });
});
