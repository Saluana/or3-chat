import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, type EffectScope } from 'vue';
import Dexie from 'dexie';
import { evictWorkspaceDb, setActiveWorkspaceDb } from '~/db/client';
import { useMultiPane } from '../useMultiPane';
import { useWorkspaceTabMetadata } from '../useWorkspaceTabMetadata';
import type { WorkspaceTab } from '~/core/workspace-tabs/types';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';

let scope: EffectScope | undefined;
const workspaces: string[] = [];
beforeEach(() => setHookEngine(createTypedHookEngine(createHookEngine())));
afterEach(async () => {
    scope?.stop();
    scope = undefined;
    setActiveWorkspaceDb(null);
    for (const id of workspaces.splice(0)) {
        evictWorkspaceDb(id);
        await Dexie.delete(`or3-db-${id}`);
    }
    setHookEngine(null);
});

describe('open workspace views receiving synced rows', () => {
    it('refreshes an open conversation from user/assistant writes, edits and deletes, then releases the old workspace and scope', async () => {
        const idA = `chat-sync-a-${crypto.randomUUID()}`;
        const idB = `chat-sync-b-${crypto.randomUUID()}`;
        workspaces.push(idA, idB);
        const db = setActiveWorkspaceDb(idA);
        scope = effectScope();
        const pane = scope.run(() => useMultiPane())!;
        await pane.setPaneThread(0, 'shared-thread');
        const row = { thread_id: 'shared-thread', created_at: 1, updated_at: 1, deleted: false, clock: 1 };
        await db.messages.put({ ...row, id: 'user-turn', role: 'user', data: { content: 'Hello from another browser' }, index: 0 });
        await vi.waitFor(() => expect(pane.panes.value[0]!.messages.map(message => message.content)).toEqual(['Hello from another browser']));
        await db.messages.put({ ...row, id: 'reply', role: 'assistant', data: { content: 'Completed reply' }, index: 1 });
        await vi.waitFor(() => expect(pane.panes.value[0]!.messages.map(message => message.content)).toEqual(['Hello from another browser', 'Completed reply']));
        await db.messages.update('reply', { data: { content: 'Edited reply' }, clock: 2 });
        await vi.waitFor(() => expect(pane.panes.value[0]!.messages[1]!.content).toBe('Edited reply'));
        await db.messages.update('user-turn', { deleted: true, clock: 3 });
        await vi.waitFor(() => expect(pane.panes.value[0]!.messages.map(message => message.id)).toEqual(['reply']));
        const otherDb = setActiveWorkspaceDb(idB);
        await otherDb.messages.put({ ...row, id: 'private-reply', role: 'assistant', data: { content: 'Other workspace' }, index: 0 });
        await vi.waitFor(() => expect(pane.panes.value[0]!.messages.map(message => message.content)).toEqual(['Other workspace']));
        await db.messages.update('reply', { data: { content: 'Old workspace must not leak' } });
        await nextTick();
        expect(pane.panes.value[0]!.messages[0]!.content).toBe('Other workspace');
        scope.stop();
        await otherDb.messages.update('private-reply', { data: { content: 'Disposed view must not update' } });
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(pane.panes.value[0]!.messages[0]!.content).toBe('Other workspace');
    });

    it('refreshes open tab titles after direct sync writes without document or thread CRUD hooks', async () => {
        const id = `metadata-sync-${crypto.randomUUID()}`;
        workspaces.push(id);
        const db = setActiveWorkspaceDb(id);
        scope = effectScope();
        const metadata = scope.run(() => useWorkspaceTabMetadata())!;
        const tabs: WorkspaceTab[] = [{ id: 'doc-tab', resource: { kind: 'document', documentId: 'doc' }, cachedTitle: 'Old title', createdAt: 1, lastActivatedAt: 1, ephemeral: false }];
        await db.posts.put({ id: 'doc', postType: 'doc', title: 'Original', content: '{}', created_at: 1, updated_at: 1, deleted: false, clock: 1 });
        await metadata.refresh(tabs);
        await db.posts.update('doc', { title: 'Renamed remotely' });
        await vi.waitFor(() => expect(metadata.titleFor(tabs[0]!).title).toBe('Renamed remotely'));
    });
});
