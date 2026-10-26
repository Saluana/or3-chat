import { expect, it, vi } from 'vitest';
const controls = vi.hoisted(() => ({ db: { name: 'workspace-a' }, read: vi.fn(), write: vi.fn() }));
vi.mock('~/db/client', () => ({ getDb: () => controls.db }));
vi.mock('~/db/kv', () => ({ getKvByName: controls.read, setKvByName: (...args: unknown[]) => controls.write(controls.db.name, ...args) }));
import { useDocumentAiSettings } from '~/composables/documents/useDocumentAiSettings';

it('reproduces saving workspace A settings into workspace B after a delayed settings read', async () => {
    let resolve!: (row: { value: string }) => void;
    controls.read.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const settings = useDocumentAiSettings();
    const updating = settings.update({ modelId: 'chosen-in-a' });
    await vi.waitFor(() => expect(controls.read).toHaveBeenCalled());
    controls.db = { name: 'workspace-b' };
    resolve({ value: JSON.stringify({ systemInstruction: 'Workspace A private instruction', enabledTools: { 'private-a-tool': true } }) });
    await updating;
    expect(controls.write).toHaveBeenCalledWith('workspace-b', 'document_ai_settings.v1', expect.stringContaining('Workspace A private instruction'));
    expect(settings.settings.value.modelId).toBe('chosen-in-a');
});
