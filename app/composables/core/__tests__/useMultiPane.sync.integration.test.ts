import { useWorkspaceTabHost, createPaneActivationCoordinator } from '../useWorkspaceTabHost';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, watch, type EffectScope } from 'vue';
import Dexie from 'dexie';
import { evictWorkspaceDb, setActiveWorkspaceDb } from '~/db/client';
import { useMultiPane } from '../useMultiPane';
import { useWorkspaceTabMetadata } from '../useWorkspaceTabMetadata';
import type { WorkspaceTab } from '~/core/workspace-tabs/types';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';

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
    vi.restoreAllMocks();
});

describe('open workspace views receiving synced rows', () => {
    it('keeps unrelated histories idle while shared conversation views update and detach', async () => {
        const workspaceId = `pane-observers-${crypto.randomUUID()}`;
        workspaces.push(workspaceId);
        const db = setActiveWorkspaceDb(workspaceId);
        const row = { created_at: 1, updated_at: 1, deleted: false, clock: 1, role: 'assistant', index: 0 };
        await db.messages.bulkPut([
            { ...row, id: 'idle-row', thread_id: 'idle-thread', data: { content: 'Keep reading' } },
            { ...row, id: 'active-row', thread_id: 'active-thread', data: { content: 'Initial reply' } },
        ]);
        scope = effectScope();
        const pane = scope.run(() => useMultiPane())!;
        await pane.setPaneThread(0, 'idle-thread');
        pane.addPane();
        await pane.setPaneThread(1, 'active-thread');
        pane.addPane();
        await pane.setPaneThread(2, 'active-thread');
        // Let the initial live-query deliveries settle before measuring updates.
        await new Promise(resolve => setTimeout(resolve, 80));
        const idleUpdates = vi.fn();
        scope.run(() => watch(() => pane.panes.value[0]!.messages, idleUpdates, { flush: 'sync' }));

        await db.messages.update('active-row', { data: { content: 'Updated reply' }, clock: 2 });
        await vi.waitFor(() => expect(pane.panes.value.slice(1).map(p => p.messages[0]?.content)).toEqual(['Updated reply', 'Updated reply']));
        expect(idleUpdates, 'a neighboring write must not replace the idle pane history').not.toHaveBeenCalled();

        await pane.closePane(1);
        await db.messages.update('active-row', { data: { content: 'Still observed' }, clock: 3 });
        await vi.waitFor(() => expect(pane.panes.value[1]!.messages[0]?.content).toBe('Still observed'));
        expect(idleUpdates).not.toHaveBeenCalled();

        await pane.setPaneThread(1, 'replacement-thread');
        await db.messages.put({ ...row, id: 'replacement-row', thread_id: 'replacement-thread', data: { content: 'Replacement history' } });
        await vi.waitFor(() => expect(pane.panes.value[1]!.messages[0]?.content).toBe('Replacement history'));
        await db.messages.update('active-row', { data: { content: 'Detached write' }, clock: 4 });
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(pane.panes.value[1]!.messages[0]?.content).toBe('Replacement history');
        expect(idleUpdates).not.toHaveBeenCalled();
    });

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

    it('recovers the open history after a transient observer read failure without rebinding the pane', async () => {
        const id = `observer-recovery-${crypto.randomUUID()}`; workspaces.push(id);
        const db = setActiveWorkspaceDb(id);
        await db.messages.put({ id: 'reply', thread_id: 'thread', role: 'assistant', index: 1,
            created_at: 1, updated_at: 1, clock: 1, deleted: false, data: { content: 'Original' } });
        scope = effectScope(); const pane = scope.run(() => useMultiPane())!;
        await pane.setPaneThread(0, 'thread');
        await new Promise(resolve => setTimeout(resolve, 80));
        const collection = db.messages.toCollection();
        const prototype: typeof collection = Object.getPrototypeOf(collection);
        const reads = vi.spyOn(prototype, 'toArray');
        reads.mockRejectedValueOnce(new Error('Synthetic transient read error'));
        await db.messages.update('reply', { data: { content: 'Recovered' }, clock: 2 });
        await vi.waitFor(() => expect(reads).toHaveBeenCalled());
        reads.mockRestore();
        await vi.waitFor(() => expect(pane.panes.value[0]!.messages[0]?.content).toBe('Recovered'), { timeout: 3000 });
        await db.messages.update('reply', { data: { content: 'Still live' }, clock: 3 });
        await vi.waitFor(() => expect(pane.panes.value[0]!.messages[0]?.content).toBe('Still live'));
    });

    it('preserves the outgoing document and reports rejection when thread selection is vetoed', async () => {
        const id = `veto-${crypto.randomUUID()}`; workspaces.push(id); setActiveWorkspaceDb(id);
        scope = effectScope(); const pane = scope.run(() => useMultiPane())!;
        pane.updatePane(0, { mode: 'doc', documentId: 'original-document', threadId: '', messages: [] });
        useHooks().addFilter('ui.pane.thread:filter:select', () => false as const);
        const host = useWorkspaceTabHost(pane);
        const paneId = pane.panes.value[0]!.id;
        await expect(host.bindResourceToPane(paneId, { kind: 'chat', threadId: 'blocked' },
            createPaneActivationCoordinator().begin(paneId))).rejects.toThrow(/selection/i);
        expect(pane.panes.value[0]).toMatchObject({ mode: 'doc', documentId: 'original-document', threadId: '', messages: [] });
        expect(pane.panes.value[0]!.pendingThreadId).toBeUndefined();
    });

    it.each(['pane reindexed', 'activation superseded'] as const)('releases its pending chat intent after %s', async change => {
        const id = `pending-intent-${crypto.randomUUID()}`; workspaces.push(id); setActiveWorkspaceDb(id);
        scope = effectScope(); const pane = scope.run(() => useMultiPane())!;
        pane.addPane();
        const target = pane.panes.value[1]!;
        const coordinator = createPaneActivationCoordinator();
        let entered!: () => void; let release!: () => void;
        const reached = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        useHooks().addFilter('ui.pane.thread:filter:select', async thread => { entered(); await gate; return thread; });
        const host = useWorkspaceTabHost(pane);
        const binding = host.bindResourceToPane(target.id, { kind: 'chat', threadId: 'next-chat' }, coordinator.begin(target.id));
        try {
            await reached;
            if (change === 'pane reindexed') await pane.closePane(0);
            else coordinator.begin(target.id);
            release(); await binding;
            expect(target.pendingThreadId).toBeUndefined();
            expect(target.threadId).toBe(change === 'pane reindexed' ? 'next-chat' : '');
        } finally { release(); await binding; }
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
