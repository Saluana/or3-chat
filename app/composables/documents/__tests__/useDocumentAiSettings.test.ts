import { expect, it, vi } from 'vitest';
const controls = vi.hoisted(() => ({ db: { name: 'workspace-a' }, read: vi.fn(), write: vi.fn() }));
vi.mock('~/db/client', () => ({ getDb: () => controls.db, getWorkspaceGeneration: () => 0, subscribeActiveWorkspaceDb: () => () => {} }));
vi.mock('~/db/kv', () => ({ getKvRecordByName: async (...args: unknown[]) => ({ row: await controls.read(...args) }), setKvByName: (name: string, value: string, db = controls.db) => controls.write(db.name, name, value) }));
import { useDocumentAiSettings } from '~/composables/documents/useDocumentAiSettings';

it('never redirects a settings write after a workspace switch', async () => {
    let resolve!: (row: { value: string }) => void;
    controls.read.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const settings = useDocumentAiSettings();
    const updating = settings.update({ modelId: 'chosen-in-a' });
    await vi.waitFor(() => expect(controls.read).toHaveBeenCalled());
    controls.db = { name: 'workspace-b' };
    resolve({ value: JSON.stringify({ systemInstruction: 'Workspace A private instruction', enabledTools: { 'private-a-tool': true } }) });
    await expect(updating).rejects.toThrow('workspace changed');
    expect(controls.write).not.toHaveBeenCalled();
    controls.read.mockResolvedValueOnce({ value: JSON.stringify({ systemInstruction: 'Workspace B instruction' }) });
    const b = useDocumentAiSettings();
    await b.ensureLoaded();
    expect(b.settings.value.systemInstruction).toBe('Workspace B instruction');
    expect(settings.settings.value.systemInstruction).toBe('Workspace A private instruction');
});
