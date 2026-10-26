import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { setActiveWorkspaceDb, getDb, evictWorkspaceDb } from '../client';
import { ThreadSchema, MessageSchema } from '../schema';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { softDeleteMessage, hardDeleteMessage, moveMessage, copyMessage, insertMessageAfter, normalizeThreadIndexes } from '../messages';
import { softDeleteThread, hardDeleteThread, updateThreadSystemPrompt, upsertThread } from '../threads';

let workspace: string;
beforeEach(async () => {
    workspace = `chat-hooks-${crypto.randomUUID()}`;
    const db = setActiveWorkspaceDb(workspace); await db.open();
    setHookEngine(createTypedHookEngine(createHookEngine()));
    await db.threads.bulkPut(['source', 'target'].map(id => ThreadSchema.parse({ id, created_at: 1, updated_at: 1, clock: 1 })));
    await db.messages.bulkPut(['first', 'second'].map((id, index) => MessageSchema.parse({ id, thread_id: 'source', role: 'user',
        index: index + 1, data: { content: id }, created_at: 1, updated_at: 1, clock: 1 })));
    useHooks().addAction('db.*', async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
});
afterEach(async () => { setActiveWorkspaceDb(null); setHookEngine(null); evictWorkspaceDb(workspace); await Dexie.delete(`or3-db-${workspace}`); });

const cases = [
    ['soft message delete', async () => { await softDeleteMessage('first'); expect((await getDb().messages.get('first'))?.deleted).toBe(true); }],
    ['hard message delete', async () => { await hardDeleteMessage('first'); expect(await getDb().messages.get('first')).toBeUndefined(); }],
    ['message move', async () => { await moveMessage('first', 'target'); expect((await getDb().messages.get('first'))?.thread_id).toBe('target'); }],
    ['message copy', async () => { await copyMessage('first', 'target'); expect(await getDb().messages.where('thread_id').equals('target').count()).toBe(1); }],
    ['message insert with normalization', async () => { await insertMessageAfter('first', { id: 'inserted', thread_id: 'source', role: 'user' }); expect((await getDb().messages.get('inserted'))?.index).toBe(1500); }],
    ['message normalization', async () => { await normalizeThreadIndexes('source'); expect((await getDb().messages.get('first'))?.index).toBe(1000); }],
    ['thread upsert', async () => { const row = (await getDb().threads.get('source'))!; await upsertThread({ ...row, title: 'Changed' }); expect((await getDb().threads.get('source'))?.title).toBe('Changed'); }],
    ['soft thread delete', async () => { await softDeleteThread('source'); expect((await getDb().threads.get('source'))?.deleted).toBe(true); }],
    ['hard thread delete', async () => { await hardDeleteThread('source'); expect(await getDb().threads.get('source')).toBeUndefined(); expect(await getDb().messages.count()).toBe(0); }],
    ['thread system prompt', async () => { await updateThreadSystemPrompt('source', 'prompt'); expect((await getDb().threads.get('source'))?.system_prompt_id).toBe('prompt'); }],
] as const;
it.each(cases)('commits %s with real asynchronous plugin actions', async (_name, run) => { await run(); });
