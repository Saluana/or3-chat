import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { effectScope, type EffectScope } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evictWorkspaceDb, setActiveWorkspaceDb, type Or3DB } from '~/db/client';
import type { WorkspaceTab } from '~/core/workspace-tabs/types';
import { useWorkspaceTabMetadata } from '../useWorkspaceTabMetadata';

vi.mock('~/composables/core/usePaneApps', () => ({
    usePaneApps: () => ({ getPaneApp: () => undefined }),
}));

const databases: Or3DB[] = [];
let scope: EffectScope | undefined;
afterEach(async () => {
    scope?.stop(); scope = undefined;
    vi.restoreAllMocks();
    setActiveWorkspaceDb(null);
    for (const db of databases.splice(0)) {
        evictWorkspaceDb(db.name.slice('or3-db-'.length));
        await Dexie.delete(db.name);
    }
});

function tab(cachedTitle: string): WorkspaceTab {
    return { id: 'identical-tab', resource: { kind: 'chat', threadId: 'identical-thread' },
        cachedTitle, createdAt: 1, lastActivatedAt: 1, ephemeral: false };
}

async function fixture(label: string) {
    const db = setActiveWorkspaceDb(`metadata-${label}-${crypto.randomUUID()}`);
    databases.push(db);
    await db.threads.put({ id: 'identical-thread', title: `${label} stored title`,
        created_at: 1, updated_at: 1, clock: 0, status: 'ready', deleted: false,
        pinned: false, forked: false });
    return db;
}

// Fault inventory: cached A titles with overlapping tab IDs remain observable
// while B metadata is held; a stale A refresh continuation can read that cache
// into B's persisted title; a failed B lookup must not reinstate A; ABA must
// invalidate an earlier generation even when the same database is active again.
describe('workspace tab metadata with real workspace databases', () => {
    it.each(['success', 'failure'] as const)('clears old cached titles while the destination lookup is held (%s)', async outcome => {
        const dbA = await fixture('A');
        const dbB = await fixture('B');
        setActiveWorkspaceDb(dbA.name.slice('or3-db-'.length));
        scope = effectScope();
        const metadata = scope.run(() => useWorkspaceTabMetadata())!;
        await metadata.refresh([tab('A fallback')]);
        expect(metadata.titleFor(tab('A fallback')).title).toBe('A stored title');

        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const original = dbB.threads.bulkGet.bind(dbB.threads);
        vi.spyOn(dbB.threads, 'bulkGet').mockImplementation(keys => Dexie.Promise.resolve(gate).then(() => {
            if (outcome === 'failure') throw new Error('Synthetic destination read failure');
            return original(keys);
        }));
        setActiveWorkspaceDb(dbB.name.slice('or3-db-'.length));
        const current = metadata.refresh([tab('B fallback')]);
        // Attach the rejection handler before releasing the held lookup.
        const settled = current.then(() => null, error => error);
        try {
            expect(metadata.titleFor(tab('B fallback')).title).toBe('B fallback');
            expect(metadata.metadata.size).toBe(0);
        } finally { release(); await settled; }
        if (outcome === 'success') expect(metadata.titleFor(tab('B fallback')).title).toBe('B stored title');
        else expect(metadata.titleFor(tab('B fallback')).title).toBe('B fallback');
        expect(metadata.titleFor(tab('B fallback')).title).not.toContain('A stored');
    });

    it.each(['switch', 'return'] as const)('discards captured title rows after a held %s transition', async transition => {
        const dbA = await fixture('A');
        const dbB = await fixture('B');
        setActiveWorkspaceDb(dbA.name.slice('or3-db-'.length));
        scope = effectScope();
        const metadata = scope.run(() => useWorkspaceTabMetadata())!;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let entered!: () => void;
        const reached = new Promise<void>(resolve => { entered = resolve; });
        const original = dbA.threads.bulkGet.bind(dbA.threads);
        const hold = vi.spyOn(dbA.threads, 'bulkGet').mockImplementationOnce(keys =>
            original(keys).then(captured => {
                entered();
                return Dexie.Promise.resolve(gate).then(() => captured);
            }));
        const previous = metadata.refresh([tab('Old A fallback')]);
        await reached;
        setActiveWorkspaceDb(dbB.name.slice('or3-db-'.length));
        let currentDb = dbB;
        let fallback = 'Current B fallback';
        if (transition === 'return') {
            await dbA.threads.update('identical-thread', { title: 'Fresh A stored title' });
            setActiveWorkspaceDb(dbA.name.slice('or3-db-'.length));
            currentDb = dbA; fallback = 'Current A fallback';
        }
        release(); await previous; hold.mockRestore();
        expect(metadata.titleFor(tab(fallback)).title).toBe(fallback);
        expect(metadata.metadata.size).toBe(0);
        await metadata.refresh([tab(fallback)]);
        expect(metadata.titleFor(tab(fallback)).title).toBe(
            currentDb === dbA ? 'Fresh A stored title' : 'B stored title');
    });

    it('keeps same-workspace cached titles during an unchanged refresh', async () => {
        const dbA = await fixture('A');
        scope = effectScope();
        const metadata = scope.run(() => useWorkspaceTabMetadata())!;
        await metadata.refresh([tab('Fallback')]);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const original = dbA.threads.bulkGet.bind(dbA.threads);
        vi.spyOn(dbA.threads, 'bulkGet').mockImplementationOnce(keys =>
            Dexie.Promise.resolve(gate).then(() => original(keys)));
        const current = metadata.refresh([tab('Fallback')]);
        try { expect(metadata.titleFor(tab('Fallback')).title).toBe('A stored title'); }
        finally { release(); await current; }
        expect(metadata.titleFor(tab('Fallback')).title).toBe('A stored title');
    });

    it('discards an in-flight title lookup when its owning component is disposed', async () => {
        const dbA = await fixture('A');
        scope = effectScope();
        const metadata = scope.run(() => useWorkspaceTabMetadata())!;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const original = dbA.threads.bulkGet.bind(dbA.threads);
        vi.spyOn(dbA.threads, 'bulkGet').mockImplementationOnce(keys =>
            Dexie.Promise.resolve(gate).then(() => original(keys)));
        const previous = metadata.refresh([tab('Disposed fallback')]);
        scope.stop();
        release(); await previous;
        expect(metadata.metadata.size).toBe(0);
    });
});
