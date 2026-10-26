import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { ThreadSchema, MessageSchema } from '~/db/schema';
import { registerThreadChatTools } from '../thread-chat-tools';
import { useToolRegistry } from '../tool-registry';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { testRuntimeConfig } from '~~/tests/setup';

const workspace = `thread-read-${crypto.randomUUID()}`;
let dispose: (() => void) | undefined;
let previousAuth: boolean;
beforeEach(() => {
    previousAuth = testRuntimeConfig.value.public.ssrAuthEnabled;
    testRuntimeConfig.value.public.ssrAuthEnabled = false;
    setHookEngine(createTypedHookEngine(createHookEngine()));
});
afterEach(async () => {
    dispose?.(); setHookEngine(null); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace);
    await Dexie.delete(`or3-db-${workspace}`);
    testRuntimeConfig.value.public.ssrAuthEnabled = previousAuth;
});

it('read_thread returns inherited reference history and the surviving retry turn in canonical order', async () => {
    const db = setActiveWorkspaceDb(workspace); await db.open();
    await db.threads.bulkPut([
        ThreadSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'current' }), ThreadSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'parent' }),
        ThreadSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'child', parent_thread_id: 'parent', branch_mode: 'reference', anchor_message_id: 'anchor', anchor_index: 1 }),
    ]);
    await db.messages.bulkPut([
        MessageSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'anchor', thread_id: 'parent', role: 'user', index: 1, data: { content: 'Inherited question' } }),
        MessageSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'after-anchor', thread_id: 'parent', role: 'assistant', index: 2, data: { content: 'Outside branch' } }),
        MessageSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'obsolete', thread_id: 'child', role: 'assistant', index: 1, data: { content: 'Obsolete reply', superseded_by: 'replacement', generation_state: 'superseded' } }),
        MessageSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'replacement', thread_id: 'child', role: 'assistant', index: 2, data: { content: 'Current reply' } }),
    ]);
    dispose = registerThreadChatTools();
    const response = await useToolRegistry().executeTool('read_thread', JSON.stringify({ threadId: 'child' }), {
        subject: null, workspaceId: workspace, threadId: 'current', messageId: 'assistant', callId: 'read', requestId: 'request',
        abortSignal: new AbortController().signal,
    });
    expect(response.error).toBeUndefined();
    expect(JSON.parse(response.result!).messages).toEqual([
        { role: 'user', content: 'Inherited question' }, { role: 'assistant', content: 'Current reply' },
    ]);
});
