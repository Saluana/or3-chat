import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { getKvRecordByName, setKvByName } from '~/db/kv';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { DOCUMENT_AI_SETTINGS_KEY as key, useDocumentAiSettings } from '../useDocumentAiSettings';

let workspace: string;
beforeEach(() => {
    workspace = `document-settings-${crypto.randomUUID()}`;
    setActiveWorkspaceDb(workspace);
    setHookEngine(createTypedHookEngine(createHookEngine()));
});
afterEach(async () => {
    const name = getDb().name;
    setActiveWorkspaceDb(null); evictWorkspaceDb(workspace);
    await Dexie.delete(name); setHookEngine(null);
});

// A second tab/sync can change preferences after hydration, or while a save's
// hook is awaiting. Test the real durable merge/CAS boundary, not a fake KV map.
it('merges an update into the latest durable preferences', async () => {
    const api = useDocumentAiSettings();
    await api.ensureLoaded();
    await setKvByName(key, JSON.stringify({ systemInstruction: 'New instruction from another tab' }));
    await api.update({ modelId: 'chosen-model' });
    const { row } = await getKvRecordByName(key);
    expect(JSON.parse(row!.value!)).toMatchObject({ modelId: 'chosen-model', systemInstruction: 'New instruction from another tab' });
});

it('refuses to overwrite a concurrent preference write during a save hook', async () => {
    const api = useDocumentAiSettings(); await api.ensureLoaded();
    let release!: () => void; let entered = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    useHooks().addFilter('db.kv.upsertByName:filter:input', async row => {
        if (row.name === key && !entered) { entered = true; await gate; }
        return row;
    });
    const pending = api.update({ modelId: 'stale-model' });
    const outcome = pending.then(() => null, error => error);
    await vi.waitFor(() => expect(entered).toBe(true));
    try {
        await setKvByName(key, JSON.stringify({ modelId: 'concurrent-model' }));
        release();
        expect(await outcome).toMatchObject({ rpcCode: 'conflict' });
        const { row } = await getKvRecordByName(key);
        expect(JSON.parse(row!.value!).modelId).toBe('concurrent-model');
    } finally { release(); await outcome; }
});
