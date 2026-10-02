import { afterEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { createDocumentInDb, getDocumentInDb } from '~/db/documents';
import { useWorkspaceBackup } from '~/composables/core/useWorkspaceBackup';
import {
    flush, loadDocument, releaseDocument, setDocumentTitle, useDocumentState,
} from '~/composables/documents/useDocumentsStore';
import {
    evictWorkspaceDb,
    getActiveWorkspaceId,
    getDb,
    getWorkspaceGeneration,
    setActiveWorkspaceDb,
    subscribeActiveWorkspaceDb,
} from '~/db/client';

vi.mock('#app', () => ({ useNuxtApp: () => ({}) }));

const disposableWorkspaces: Array<{ id: string; name: string }> = [];

const TEST_WORKSPACES = [
    'reliability-switch-a',
    'reliability-switch-b',
] as const;

afterEach(async () => {
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    for (const { id, name } of disposableWorkspaces.splice(0)) {
        setActiveWorkspaceDb(id);
        await releaseDocument('copied-document', { flush: false });
        setActiveWorkspaceDb(null);
        evictWorkspaceDb(id);
        await Dexie.delete(name);
    }
    setHookEngine(null);
    setActiveWorkspaceDb(null);
    for (const workspaceId of TEST_WORKSPACES) evictWorkspaceDb(workspaceId);
});

async function documentWorkspaces() {
    const hooks = createTypedHookEngine(createHookEngine());
    setHookEngine(hooks);
    const idA = `document-isolation-a-${crypto.randomUUID()}`;
    const idB = `document-isolation-b-${crypto.randomUUID()}`;
    const dbA = setActiveWorkspaceDb(idA);
    const created = await createDocumentInDb(dbA, { title: 'Workspace A owner' });
    const row = (await dbA.posts.get(created.id))!;
    await dbA.posts.delete(created.id);
    await dbA.posts.put({ ...row, id: 'copied-document' });
    const dbB = setActiveWorkspaceDb(idB);
    await dbB.posts.put({ ...row, id: 'copied-document', title: 'Workspace B owner' });
    disposableWorkspaces.push({ id: idA, name: dbA.name }, { id: idB, name: dbB.name });
    setActiveWorkspaceDb(idA);
    return { dbA, dbB, idA, idB, hooks };
}

describe('document workspace isolation through the real Dexie store', () => {
    it('exports the originating workspace when switching while the save picker is open', async () => {
        const { dbA, idB } = await documentWorkspaces();
        const chunks: Uint8Array[] = [];
        let finishPicker!: (handle: FileSystemFileHandle) => void;
        const picker = new Promise<FileSystemFileHandle>((resolve) => { finishPicker = resolve; });
        const showPicker = vi.fn(() => picker);
        Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: showPicker });
        const backup = useWorkspaceBackup();
        const exportPromise = backup.exportWorkspace();
        await vi.waitFor(() => expect(showPicker).toHaveBeenCalledOnce());
        setActiveWorkspaceDb(idB);
        finishPicker({
            createWritable: async () => ({
                write: async (chunk: Uint8Array) => { chunks.push(chunk); },
                close: async () => {},
            }),
        } as unknown as FileSystemFileHandle);
        await exportPromise;
        expect(backup.state.currentStep.value).toBe('done');
        const text = chunks.map((chunk) => new TextDecoder().decode(chunk)).join('');
        const header = JSON.parse(text.split('\n')[0]!);
        expect(header.databaseName).toBe(dbA.name);
        expect(text).toContain('Workspace A owner');
        expect(text).not.toContain('Workspace B owner');
    });

    it('keeps a pending debounce write in its originating workspace', async () => {
        const { dbA, dbB, idB } = await documentWorkspaces();
        await loadDocument('copied-document');
        const originState = useDocumentState('copied-document');
        setDocumentTitle('copied-document', 'Workspace A pending edit');
        setActiveWorkspaceDb(idB);
        await vi.waitFor(() => expect(originState.status).toBe('saved'), { timeout: 2_000 });
        expect((await getDocumentInDb(dbB, 'copied-document'))?.title).toBe('Workspace B owner');
        expect((await getDocumentInDb(dbA, 'copied-document'))?.title).toBe('Workspace A pending edit');
    });

    it('does not expose the old workspace cache under the same document ID', async () => {
        const { idA, idB } = await documentWorkspaces();
        await loadDocument('copied-document');
        setActiveWorkspaceDb(idB);
        expect(useDocumentState('copied-document').record).toBeNull();
        await loadDocument('copied-document');
        expect(useDocumentState('copied-document').record?.title).toBe('Workspace B owner');
        setActiveWorkspaceDb(idA);
        expect(useDocumentState('copied-document').record?.title).toBe('Workspace A owner');
    });

    it('keeps an old workspace read completion out of the active document cache', async () => {
        const { idB, hooks } = await documentWorkspaces();
        let finish!: () => void;
        const held = new Promise<void>((resolve) => { finish = resolve; });
        let started!: () => void;
        const waiting = new Promise<void>((resolve) => { started = resolve; });
        hooks.addFilter('db.documents.get:filter:output', async (document) => {
            if (document?.title === 'Workspace A owner') { started(); await held; }
            return document;
        });
        const oldRead = loadDocument('copied-document');
        await waiting;
        setActiveWorkspaceDb(idB);
        await loadDocument('copied-document');
        finish();
        await oldRead;
        expect(useDocumentState('copied-document').record?.title).toBe('Workspace B owner');
    });

    it('retains a failed origin save for retry after rapidly switching away and back', async () => {
        const { dbA, dbB, idA, idB } = await documentWorkspaces();
        await loadDocument('copied-document');
        setDocumentTitle('copied-document', 'Workspace A retry edit');
        const failure = () => { throw new Error('Disposable write failure'); };
        dbA.posts.hook('updating', failure);
        await flush('copied-document');
        expect(useDocumentState('copied-document').pendingTitle).toBe('Workspace A retry edit');
        expect(useDocumentState('copied-document').status).toBe('error');
        dbA.posts.hook('updating').unsubscribe(failure);
        for (let index = 0; index < 4; index++) {
            setActiveWorkspaceDb(idB);
            await loadDocument('copied-document');
            expect(useDocumentState('copied-document').record?.title).toBe('Workspace B owner');
            setActiveWorkspaceDb(idA);
        }
        await flush('copied-document');
        expect((await getDocumentInDb(dbA, 'copied-document'))?.title).toBe('Workspace A retry edit');
        expect((await getDocumentInDb(dbB, 'copied-document'))?.title).toBe('Workspace B owner');
    });

    it('keeps the second staged generation in A when switching during the first save', async () => {
        const { dbA, dbB, idB, hooks } = await documentWorkspaces();
        await loadDocument('copied-document');
        let finish!: () => void;
        const held = new Promise<void>((resolve) => { finish = resolve; });
        let started!: () => void;
        const waiting = new Promise<void>((resolve) => { started = resolve; });
        hooks.addAction('db.documents.update:action:before', async (payload) => {
            if (payload.updated.title === 'Workspace A first edit') { started(); await held; }
        });
        setDocumentTitle('copied-document', 'Workspace A first edit');
        const saving = flush('copied-document');
        await waiting;
        setDocumentTitle('copied-document', 'Workspace A second edit');
        setActiveWorkspaceDb(idB);
        await loadDocument('copied-document');
        finish();
        await saving;
        expect((await getDocumentInDb(dbA, 'copied-document'))?.title).toBe('Workspace A second edit');
        expect((await getDocumentInDb(dbB, 'copied-document'))?.title).toBe('Workspace B owner');
        expect(useDocumentState('copied-document').record?.title).toBe('Workspace B owner');
    });
});

describe('workspace switch runtime integration', () => {
    it('changes the actual workspace DB and emits monotonic generations', () => {
        const events: Array<{
            oldWorkspaceId: string | null;
            newWorkspaceId: string | null;
            generation: number;
        }> = [];
        const unsubscribe = subscribeActiveWorkspaceDb((event) => {
            events.push(event);
        });

        const dbA = setActiveWorkspaceDb(TEST_WORKSPACES[0]);
        const generationA = getWorkspaceGeneration();
        const dbB = setActiveWorkspaceDb(TEST_WORKSPACES[1]);
        const generationB = getWorkspaceGeneration();
        unsubscribe();

        expect(dbA).not.toBe(dbB);
        expect(dbA.name).toBe(`or3-db-${TEST_WORKSPACES[0]}`);
        expect(dbB.name).toBe(`or3-db-${TEST_WORKSPACES[1]}`);
        expect(getDb()).toBe(dbB);
        expect(getActiveWorkspaceId()).toBe(TEST_WORKSPACES[1]);
        expect(generationB).toBe(generationA + 1);
        expect(events.slice(-2)).toEqual([
            {
                oldWorkspaceId: null,
                newWorkspaceId: TEST_WORKSPACES[0],
                generation: generationA,
            },
            {
                oldWorkspaceId: TEST_WORKSPACES[0],
                newWorkspaceId: TEST_WORKSPACES[1],
                generation: generationB,
            },
        ]);
    });

    it('rejects a late completion captured before a workspace switch', async () => {
        setActiveWorkspaceDb(TEST_WORKSPACES[0]);
        const capturedGeneration = getWorkspaceGeneration();
        let release!: () => void;
        const inFlight = new Promise<void>((resolve) => {
            release = resolve;
        });
        let appliedWorkspace: string | null = null;

        const completion = inFlight.then(() => {
            if (capturedGeneration !== getWorkspaceGeneration()) return;
            appliedWorkspace = getActiveWorkspaceId();
        });

        setActiveWorkspaceDb(TEST_WORKSPACES[1]);
        release();
        await completion;

        expect(appliedWorkspace).toBeNull();
        expect(getActiveWorkspaceId()).toBe(TEST_WORKSPACES[1]);
    });
});
