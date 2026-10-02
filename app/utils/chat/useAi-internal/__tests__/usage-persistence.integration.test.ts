import Dexie from 'dexie';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { makeAssistantPersister } from '../persistence';
import { projectTranscriptForOpenRouter, storedMessagesToCanonicalTranscript } from '~/utils/chat/transcript';
import type { RequestUsage } from '~~/shared/chat/compaction';
const measurement = (prompt = 180000): RequestUsage => ({ prompt_tokens: prompt, completion_tokens: 42, model: 'large-model', request_id: 'provider', iteration: 2,
    measured_at: 123, prefix_message_count: 5, prefix_hash: 'prefix', configuration_hash: 'configuration', input_estimate_tokens: 170000 });
let workspace: string;
beforeEach(async () => {
    setHookEngine(createTypedHookEngine(createHookEngine()));
    workspace = `usage-persistence-${crypto.randomUUID()}`; await setActiveWorkspaceDb(workspace).open();
    await getDb().messages.put({ id: 'assistant', thread_id: 'thread', role: 'assistant', index: 1, clock: 1, created_at: 1, updated_at: 1,
        pending: true, deleted: false, data: { content: 'Original', generation_lease_id: 'generation', generation_state: 'streaming', plugin_owned: 'old' } });
});
afterEach(async () => { const db = getDb(); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(db.name); setHookEngine(null); });
it('merges usage as an owned delta and retains the last measured request through terminal save and canonical reload', async () => {
    const db = getDb(); const initial = (await db.messages.get('assistant'))!;
    const persist = makeAssistantPersister(db, initial, [], 'generation');
    await db.messages.update(initial.id, { data: { ...initial.data as Record<string, unknown>, plugin_owned: 'concurrent', unrelated: 7 } });
    await persist({ usage: measurement() });
    expect((await db.messages.get(initial.id))?.data).toMatchObject({ content: 'Original', plugin_owned: 'concurrent', unrelated: 7, usage: measurement() });
    await persist({ content: 'Complete', finalize: true });
    const row = (await db.messages.get(initial.id))!;
    expect(row.pending).toBe(false); expect(row.data).toMatchObject({ content: 'Complete', usage: measurement() });
    expect(projectTranscriptForOpenRouter(storedMessagesToCanonicalTranscript([row]))[0]?.data?.usage).toEqual(measurement());
});
it('replaces occupancy for a later request, ignores malformed usage and never substitutes a zero for absence', async () => {
    const db = getDb(); const initial = (await db.messages.get('assistant'))!; const persist = makeAssistantPersister(db, initial, []);
    await persist({ content: 'Text without a measurement' }); expect((await db.messages.get(initial.id))?.data).not.toHaveProperty('usage');
    await persist({ usage: measurement(100) }); await persist({ usage: measurement(150) });
    await persist({ content: 'Successful response', usage: measurement(-1) });
    expect((await db.messages.get(initial.id))?.data).toMatchObject({ content: 'Successful response', usage: { prompt_tokens: 150 } });
});
it('preserves the reviewed generation lease guard when usage arrives after supersession', async () => {
    const db = getDb(); const initial = (await db.messages.get('assistant'))!; const persist = makeAssistantPersister(db, initial, [], 'generation');
    await db.messages.update(initial.id, { data: { ...initial.data as Record<string, unknown>, generation_lease_id: 'replacement', content: 'New owner' } });
    await persist({ usage: measurement(), content: 'Stale response' });
    expect((await db.messages.get(initial.id))?.data).toMatchObject({ content: 'New owner', generation_lease_id: 'replacement' });
    expect((await db.messages.get(initial.id))?.data).not.toHaveProperty('usage');
});
