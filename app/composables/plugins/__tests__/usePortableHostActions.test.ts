import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The host write path: RPC envelope unwrapping, current write authority,
 * exact-plan execution and workspace pinning. The surface tests mock this
 * composable away, so these are the tests that pin the production contract.
 */

const getActivationMock = vi.fn();
const invokeMock = vi.fn();
const getWorkspaceDbMock = vi.fn();
const createDocumentInDbMock = vi.fn();
const getDocumentInDbMock = vi.fn();
const updateDocumentInDbMock = vi.fn();
const createThreadInDbMock = vi.fn();
const createMessageInDbMock = vi.fn();

vi.mock('~/composables/plugins/portable-client-runtime', () => ({
    getPortableActivation: (...args: unknown[]) => getActivationMock(...args),
    invokePortableUiEvent: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('~/db/client', () => ({
    getWorkspaceDb: (...args: unknown[]) => getWorkspaceDbMock(...args),
}));

vi.mock('~/db/documents', () => ({
    createDocumentInDb: (...args: unknown[]) => createDocumentInDbMock(...args),
    getDocumentInDb: (...args: unknown[]) => getDocumentInDbMock(...args),
    updateDocumentInDb: (...args: unknown[]) => updateDocumentInDbMock(...args),
}));

vi.mock('~/db/threads', () => ({
    createThreadInDb: (...args: unknown[]) => createThreadInDbMock(...args),
}));

vi.mock('~/db/messages', () => ({
    createMessageInDb: (...args: unknown[]) => createMessageInDbMock(...args),
}));

vi.mock('~/utils/chat/markdownToTipTapDoc', () => ({
    markdownToTipTapDoc: (markdown: string) => ({ type: 'doc', markdown }),
}));

import { usePortableHostActions } from '../usePortableHostActions';

const db = { name: 'or3-db-ws-1' };

function activation(overrides: Record<string, unknown> = {}) {
    return {
        pluginId: 'sample.plugin',
        version: '1.0.0',
        workspaceId: 'ws-1',
        generation: 7,
        descriptorKey: 'sha256-x',
        status: 'active',
        blockCode: null,
        blockMessage: null,
        view: null,
        contributions: [],
        capabilities: [],
        approvedGrants: ['documents.read', 'documents.write'],
        logs: [],
        crashed: false,
        startedAt: 0,
        ...overrides,
    };
}

function documentRecord(overrides: Record<string, unknown> = {}) {
    return {
        id: 'doc_1',
        title: 'Doc One',
        content: { type: 'doc', content: [] },
        created_at: 1,
        updated_at: 10,
        deleted: false,
        ...overrides,
    };
}

beforeEach(() => {
    getActivationMock.mockReset();
    invokeMock.mockReset();
    getWorkspaceDbMock.mockReset();
    createDocumentInDbMock.mockReset();
    getDocumentInDbMock.mockReset();
    updateDocumentInDbMock.mockReset();
    createThreadInDbMock.mockReset();
    createMessageInDbMock.mockReset();
    getActivationMock.mockReturnValue(activation());
    getWorkspaceDbMock.mockReturnValue(db);
});

describe('usePortableHostActions', () => {
    it('unwraps the RPC envelope and writes through the captured workspace database', async () => {
        invokeMock.mockResolvedValue({
            ok: true,
            result: { title: 'Summary', content: '# Body' },
        });
        createDocumentInDbMock.mockResolvedValue({ id: 'doc_new' });

        const hostActions = usePortableHostActions();
        const result = await hostActions.run({ pluginId: 'sample.plugin', action: 'host.document.create' });

        expect(result).toEqual({
            ok: true,
            outcome: { status: 'created-document', documentId: 'doc_new' },
        });
        expect(createDocumentInDbMock).toHaveBeenCalledWith(
            db,
            expect.objectContaining({ title: 'Summary' })
        );
    });

    it('refuses a write when the activation does not hold documents.write', async () => {
        getActivationMock.mockReturnValue(activation({ approvedGrants: ['documents.read'] }));
        const hostActions = usePortableHostActions();
        const result = await hostActions.run({ pluginId: 'sample.plugin', action: 'host.document.create' });
        expect(result).toMatchObject({ ok: false, code: 'write-authority-required' });
        expect(invokeMock).not.toHaveBeenCalled();
        expect(createDocumentInDbMock).not.toHaveBeenCalled();
    });

    it('refuses to execute a plan when the activation was replaced', async () => {
        invokeMock.mockResolvedValue({ ok: true, result: { content: '# Body' } });
        const hostActions = usePortableHostActions();
        const prepared = await hostActions.prepare({
            pluginId: 'sample.plugin',
            action: 'host.document.create',
        });
        if (!prepared.ok) throw new Error('expected a prepared action');

        getActivationMock.mockReturnValue(activation({ generation: 8 }));
        const result = await hostActions.execute(prepared.prepared);
        expect(result).toMatchObject({ ok: false, code: 'activation-changed' });
        expect(createDocumentInDbMock).not.toHaveBeenCalled();
    });

    it('keeps the plugin refusal code instead of reporting an empty payload', async () => {
        invokeMock.mockResolvedValue({ ok: false, code: 'quota-exceeded', message: 'No budget' });
        const hostActions = usePortableHostActions();
        const result = await hostActions.run({ pluginId: 'sample.plugin', action: 'host.document.create' });
        expect(result).toMatchObject({ ok: false, code: 'quota-exceeded' });
    });

    it('freezes the replace target revision and refuses a document edited meanwhile', async () => {
        getDocumentInDbMock.mockResolvedValue(documentRecord());
        invokeMock.mockResolvedValue({ ok: true, result: { content: 'new text' } });
        const hostActions = usePortableHostActions();
        const prepared = await hostActions.prepare({
            pluginId: 'sample.plugin',
            action: 'host.document.replace',
            selectedDocumentId: 'doc_1',
        });
        if (!prepared.ok) throw new Error('expected a prepared action');
        expect(prepared.prepared.requiresConfirmation).toBe(true);

        // The document changed while the confirmation was displayed.
        getDocumentInDbMock.mockResolvedValue(
            documentRecord({ content: { type: 'doc', content: [{ type: 'paragraph' }] }, updated_at: 11 })
        );
        const result = await hostActions.execute(prepared.prepared);
        expect(result).toMatchObject({ ok: false, code: 'stale-target' });
        expect(updateDocumentInDbMock).not.toHaveBeenCalled();
    });

    it('replaces only after re-reading the exact frozen revision', async () => {
        getDocumentInDbMock.mockResolvedValue(documentRecord());
        invokeMock.mockResolvedValue({ ok: true, result: { content: 'new text' } });
        updateDocumentInDbMock.mockResolvedValue(documentRecord({ content: 'updated' }));

        const hostActions = usePortableHostActions();
        const prepared = await hostActions.prepare({
            pluginId: 'sample.plugin',
            action: 'host.document.replace',
            selectedDocumentId: 'doc_1',
        });
        if (!prepared.ok) throw new Error('expected a prepared action');
        const result = await hostActions.execute(prepared.prepared);

        expect(result).toMatchObject({ ok: true, outcome: { status: 'replaced-document' } });
        expect(updateDocumentInDbMock).toHaveBeenCalledWith(
            db,
            'doc_1',
            expect.objectContaining({ content: expect.any(Object) })
        );
    });

    it('continues in chat with both records written to the captured database', async () => {
        invokeMock.mockResolvedValue({ ok: true, result: { title: 'Chosen', content: '# Chosen' } });
        createThreadInDbMock.mockResolvedValue({ id: 'thread_1' });
        createMessageInDbMock.mockResolvedValue({ id: 'msg_1' });

        const hostActions = usePortableHostActions();
        const result = await hostActions.run({
            pluginId: 'sample.plugin',
            action: 'host.chat.continue',
        });

        expect(result).toMatchObject({ ok: true, outcome: { status: 'continued-in-chat', threadId: 'thread_1' } });
        expect(createThreadInDbMock).toHaveBeenCalledWith(db, { title: 'Chosen' });
        expect(createMessageInDbMock).toHaveBeenCalledWith(
            db,
            expect.objectContaining({ thread_id: 'thread_1', role: 'assistant' })
        );
    });

    it('refuses a replace target that no longer exists at admission', async () => {
        getDocumentInDbMock.mockResolvedValue(undefined);
        invokeMock.mockResolvedValue({ ok: true, result: { content: 'new text' } });
        const hostActions = usePortableHostActions();
        const result = await hostActions.prepare({
            pluginId: 'sample.plugin',
            action: 'host.document.replace',
            selectedDocumentId: 'doc_gone',
        });
        expect(result).toMatchObject({ ok: false, code: 'stale-target' });
    });

    it('never reports success when the document store did not update a record', async () => {
        getDocumentInDbMock.mockResolvedValue(documentRecord());
        invokeMock.mockResolvedValue({ ok: true, result: { content: 'new text' } });
        // The target vanished between the revision re-read and the write.
        updateDocumentInDbMock.mockResolvedValue(undefined);

        const hostActions = usePortableHostActions();
        const prepared = await hostActions.prepare({
            pluginId: 'sample.plugin',
            action: 'host.document.replace',
            selectedDocumentId: 'doc_1',
        });
        if (!prepared.ok) throw new Error('expected a prepared action');
        const result = await hostActions.execute(prepared.prepared);
        expect(result).toMatchObject({ ok: false, code: 'stale-target' });
    });
});
