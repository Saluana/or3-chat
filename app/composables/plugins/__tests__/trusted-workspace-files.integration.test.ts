import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { Blob as NativeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTrustedHostContext, TRUSTED_HOST_GRANTS } from '../trusted-host-context';
import { evictWorkspaceDb, getDb, setActiveWorkspaceDb } from '~/db/client';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { testRuntimeConfig } from '~~/tests/setup';
import * as session from '~/composables/auth/useSessionContext';
import type { PluginFileLifecycle, PluginGrant, PluginResult } from '@or3/plugin-sdk';
import { WorkspacePluginCoordinator } from '~~/shared/plugins/workspace-plugin-coordinator';

// Risks: missing grants, stale revisions/workspaces, async policy races,
// duplicate notifications, after-hook errors, premature byte deletion and
// registrations surviving plugin disposal. Exercise the real SDK/DB boundary.
let workspaceId: string;
let hooks: ReturnType<typeof createHookEngine>;
let originalSsrAuth: boolean;
const contexts: ReturnType<typeof createTrustedHostContext>[] = [];
const dbIds: string[] = [];
function value<T>(result: PluginResult<T>): T {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
}
function activate(grants: readonly PluginGrant[] = TRUSTED_HOST_GRANTS) {
    const trusted = createTrustedHostContext({
        pluginId: 'fixture.files', version: '1.0.0', workspaceId, grants,
        subscribeHook: (name, kind, callback, options) => hooks.on(name, callback, { ...options, kind }),
    });
    contexts.push(trusted);
    return trusted;
}
async function upload(trusted = activate()) {
    const ref = value(await trusted.context.files.write({ name: 'notes.txt', mimeType: 'text/plain',
        data: (async function* () { yield new TextEncoder().encode('Original saffron bytes'); })() }));
    return { trusted, ref, saved: value(await trusted.context.files.catalog.save(ref.id)) };
}
beforeEach(async () => {
    vi.stubGlobal('Blob', NativeBlob);
    originalSsrAuth = testRuntimeConfig.value.public.ssrAuthEnabled;
    testRuntimeConfig.value.public.ssrAuthEnabled = false;
    hooks = createHookEngine();
    setHookEngine(createTypedHookEngine(hooks));
    workspaceId = `plugin-files-${crypto.randomUUID()}`;
    dbIds.push(workspaceId);
    await setActiveWorkspaceDb(workspaceId).open();
});
afterEach(async () => {
    while (contexts.length) await contexts.pop()!.dispose();
    setActiveWorkspaceDb(null);
    while (dbIds.length) { const id = dbIds.pop()!; evictWorkspaceDb(id); await Dexie.delete(`or3-db-${id}`); }
    testRuntimeConfig.value.public.ssrAuthEnabled = originalSsrAuth;
    setHookEngine(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('trusted workspace Files contract', () => {
    for (const boundary of ['native-conversion', 'iteration'] as const) {
        it.each(['account-change', 'logout', 'same-account-refresh'] as const)(`joins plugin coordinator ${boundary} read lifetime for %s without a DB switch`, async transition => {
            let active: ReturnType<typeof createTrustedHostContext> | null = null;
            let holdCleanup = false;
            let releaseCleanup!: () => void;
            let cleanupEntered!: () => void;
            const cleanupHeld = new Promise<void>(resolve => { releaseCleanup = resolve; });
            const cleanupStarted = new Promise<void>(resolve => { cleanupEntered = resolve; });
            const onError = vi.fn();
            const coordinator = new WorkspacePluginCoordinator({
                fetchManifest: async () => ({ workspaceId, revision: 'synthetic-files', enabledPluginIds: [], installedPluginIds: [], runtime: {} }),
                onError,
            });
            coordinator.register({ name: 'synthetic-trusted-files',
                async stop() {
                    const previous = active; active = null;
                    await previous?.dispose();
                    if (holdCleanup) { cleanupEntered(); await cleanupHeld; }
                },
                async reconcile() {
                    if (!active) {
                        active = createTrustedHostContext({ pluginId: 'fixture.coordinated-files', version: '1.0.0', workspaceId,
                            grants: ['files.read', 'files.write', 'files.catalog.write'] });
                        contexts.push(active);
                    }
                },
            });
            let releaseRead = () => {};
            let pendingTransition: Promise<void> | undefined;
            try {
                await coordinator.refresh({ workspaceId, sessionKey: 'synthetic-account-a' });
                const trusted = active as ReturnType<typeof createTrustedHostContext> | null;
                if (!trusted) throw new Error('Synthetic trusted activation was not created');
                const { ref } = await upload(trusted);
                const originalDb = getDb();
                let reading: ReturnType<typeof trusted.context.files.read>;
                if (boundary === 'native-conversion') {
                    let entered!: () => void;
                    const held = new Promise<void>(resolve => { releaseRead = resolve; });
                    const started = new Promise<void>(resolve => { entered = resolve; });
                    const nativeRead = NativeBlob.prototype.arrayBuffer;
                    vi.spyOn(NativeBlob.prototype, 'arrayBuffer').mockImplementationOnce(async function(this: NativeBlob) {
                        entered(); await held; return nativeRead.call(this);
                    });
                    reading = trusted.context.files.read(ref.id);
                    await Promise.race([started, reading.then(() => { throw new Error('Fixture did not reach native conversion'); })]);
                } else reading = Promise.resolve(await trusted.context.files.read(ref.id));
                holdCleanup = transition !== 'same-account-refresh';
                pendingTransition = coordinator.refresh({ workspaceId: transition === 'logout' ? null : workspaceId,
                    sessionKey: transition === 'logout' ? null : transition === 'account-change' ? 'synthetic-account-b' : 'synthetic-account-a' });
                if (holdCleanup) await cleanupStarted;
                expect(getDb()).toBe(originalDb);
                releaseRead();
                const result = await reading;
                if (boundary === 'native-conversion' && holdCleanup) {
                    expect(result).toMatchObject({ ok: false, error: { code: 'stale-context' } });
                } else {
                    const stream = value(result);
                    const chunks: Uint8Array[] = [];
                    for await (const chunk of stream) chunks.push(chunk);
                    expect(chunks.length).toBe(holdCleanup ? 0 : 1);
                    if (!holdCleanup) expect(new TextDecoder().decode(chunks[0])).toBe('Original saffron bytes');
                    expect(await stream.result).toMatchObject(holdCleanup ? { ok: false, error: { code: 'stale-context' } } : { ok: true });
                }
                if (holdCleanup) expect(active).toBeNull(); // Destination activation waits for teardown.
                releaseCleanup();
                await pendingTransition;
                expect(onError).not.toHaveBeenCalled();
            } finally {
                holdCleanup = false; releaseRead(); releaseCleanup();
                await pendingTransition;
                await coordinator.dispose();
            }
        });
    }
    for (const boundary of ['before-return', 'before-iteration'] as const) {
        it.each(['changed', 'returned', 'disposed', 'unchanged'] as const)(`fences plugin file read ${boundary} when activation is %s`, async change => {
            let release!: () => void;
            let entered!: () => void;
            const held = new Promise<void>(resolve => { release = resolve; });
            const started = new Promise<void>(resolve => { entered = resolve; });
            const bytes = new TextEncoder().encode('synthetic-private-origin-file');
            const trusted = createTrustedHostContext({ pluginId: 'fixture.file-lifetime', version: '1.0.0', workspaceId,
                grants: ['files.read'], mediation: { files: {
                    put: async () => ({ id: 'synthetic-file-reference' }), list: async () => [],
                    get: async () => { if (boundary === 'before-return') { entered(); await held; } return { name: 'synthetic.txt', mimeType: 'text/plain', bytes }; },
                } },
            });
            contexts.push(trusted);
            const reading = trusted.context.files.read('synthetic-file-reference');
            if (boundary === 'before-return') await started;
            const initial = boundary === 'before-iteration' ? await reading : null;
            if (change === 'disposed') await trusted.dispose();
            else if (change !== 'unchanged') {
                const nextWorkspace = `plugin-file-lifetime-${crypto.randomUUID()}`;
                dbIds.push(nextWorkspace);
                await setActiveWorkspaceDb(nextWorkspace).open();
                if (change === 'returned') setActiveWorkspaceDb(workspaceId);
            }
            release();
            const result = initial ?? await reading;
            if (boundary === 'before-return' && change !== 'unchanged') {
                expect(result).toMatchObject({ ok: false, error: { code: 'stale-context' } });
                return;
            }
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            const chunks: Uint8Array[] = [];
            for await (const chunk of result.value) chunks.push(chunk);
            expect(chunks).toHaveLength(change === 'unchanged' ? 1 : 0);
            if (change === 'unchanged') expect(new TextDecoder().decode(chunks[0])).toBe('synthetic-private-origin-file');
            expect(await result.value.result).toMatchObject(change === 'unchanged' ? { ok: true } : { ok: false, error: { code: 'stale-context' } });
        });
    }

    it.each(['changed', 'returned', 'disposed', 'unchanged'] as const)('redacts failed plugin file reads when activation is %s while preserving live recovery', async change => {
        let release!: () => void;
        let entered!: () => void;
        let reads = 0;
        const held = new Promise<void>(resolve => { release = resolve; });
        const started = new Promise<void>(resolve => { entered = resolve; });
        const trusted = createTrustedHostContext({ pluginId: 'fixture.file-error', version: '1.0.0', workspaceId,
            grants: ['files.read'], mediation: { files: {
                put: async () => ({ id: 'synthetic-file-reference' }), list: async () => [],
                get: async () => {
                    if (++reads === 1) { entered(); await held; throw new Error('synthetic-private-origin-filename'); }
                    return { name: 'synthetic-recovered.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('synthetic-recovered-file') };
                },
            } },
        });
        contexts.push(trusted);
        const reading = trusted.context.files.read('synthetic-file-reference');
        await started;
        if (change === 'disposed') await trusted.dispose();
        else if (change !== 'unchanged') {
            const nextWorkspace = `plugin-file-error-${crypto.randomUUID()}`;
            dbIds.push(nextWorkspace);
            await setActiveWorkspaceDb(nextWorkspace).open();
            if (change === 'returned') setActiveWorkspaceDb(workspaceId);
        }
        release();
        expect(await reading).toMatchObject({ ok: false, error: change === 'unchanged'
            ? { code: 'host-unavailable', message: 'synthetic-private-origin-filename' }
            : { code: 'stale-context', message: 'Plugin activation has ended' } });
        if (change === 'unchanged') {
            const recovered = value(await trusted.context.files.read('synthetic-file-reference'));
            const chunks: Uint8Array[] = [];
            for await (const chunk of recovered) chunks.push(chunk);
            expect(new TextDecoder().decode(chunks[0])).toBe('synthetic-recovered-file');
            expect(await recovered.result).toMatchObject({ ok: true });
        }
    });

    it('fences an actual stored-file read after native blob conversion crosses a workspace change', async () => {
        const { trusted, ref } = await upload();
        let release!: () => void;
        let entered!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const started = new Promise<void>(resolve => { entered = resolve; });
        const original = NativeBlob.prototype.arrayBuffer;
        vi.spyOn(NativeBlob.prototype, 'arrayBuffer').mockImplementationOnce(async function (this: NativeBlob) {
            entered(); await held; return original.call(this);
        });
        const reading = trusted.context.files.read(ref.id);
        await Promise.race([started, reading.then(() => { throw new Error('Fixture did not reach held native blob conversion'); })]);
        const nextWorkspace = `plugin-file-conversion-${crypto.randomUUID()}`;
        dbIds.push(nextWorkspace);
        await setActiveWorkspaceDb(nextWorkspace).open();
        release();
        expect(await reading).toMatchObject({ ok: false, error: { code: 'stale-context' } });
    });

    it.each(['changed', 'returned', 'disposed', 'unchanged'] as const)('reports read completion after already-yielded bytes when activation is %s', async change => {
        const { trusted, ref } = await upload();
        const stream = value(await trusted.context.files.read(ref.id));
        const iterator = stream[Symbol.asyncIterator]();
        const first = await iterator.next();
        expect(new TextDecoder().decode(first.value)).toBe('Original saffron bytes');
        if (change === 'disposed') await trusted.dispose();
        else if (change !== 'unchanged') {
            const nextWorkspace = `plugin-file-completion-${crypto.randomUUID()}`;
            dbIds.push(nextWorkspace);
            await setActiveWorkspaceDb(nextWorkspace).open();
            if (change === 'returned') setActiveWorkspaceDb(workspaceId);
        }
        expect((await iterator.next()).done).toBe(true);
        expect(await stream.result).toMatchObject(change === 'unchanged' ? { ok: true } : { ok: false, error: { code: 'stale-context' } });
    });

    it('cannot use a direct foreign file hash to read another workspace through the SDK', async () => {
        const original = await upload();
        const nextWorkspace = `plugin-file-foreign-${crypto.randomUUID()}`;
        dbIds.push(nextWorkspace);
        await setActiveWorkspaceDb(nextWorkspace).open();
        const foreignContext = createTrustedHostContext({ pluginId: 'fixture.foreignfile', version: '1.0.0', workspaceId: nextWorkspace, grants: ['files.read', 'files.write'] });
        contexts.push(foreignContext);
        const foreign = value(await foreignContext.context.files.write({ name: 'synthetic-foreign.txt', mimeType: 'text/plain',
            data: (async function* () { yield new TextEncoder().encode('synthetic-foreign-workspace-file'); })() }));
        setActiveWorkspaceDb(workspaceId);
        const current = activate(['files.read']);
        expect(await current.context.files.read(foreign.id)).toMatchObject({ ok: false, error: { code: 'not-found' } });
        expect(await current.context.files.read(`sha256:${'f'.repeat(64)}`)).toMatchObject({ ok: false, error: { code: 'not-found' } });
        const stream = value(await current.context.files.read(original.ref.id));
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        expect(new TextDecoder().decode(chunks[0])).toBe('Original saffron bytes');
        expect(await stream.result).toMatchObject({ ok: true });
    });

    it('denies direct file reads without a grant before accessing stored bytes', async () => {
        const { ref } = await upload();
        const get = vi.spyOn(getDb().file_blobs, 'get');
        const denied = activate([]);
        expect(await denied.context.files.read(ref.id)).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
        expect(get).not.toHaveBeenCalled();
    });

    it('pages metadata without fetching blobs and includes native documents', async () => {
        const { trusted, saved } = await upload();
        await getDb().posts.put({ id: 'native-doc', title: 'Native document', postType: 'doc', content: '{"type":"doc","content":[]}',
            deleted: false, clock: 1, created_at: 1, updated_at: 1 });
        const catalog = trusted.context.files.catalog;
        const first = value(await catalog.list({ limit: 1 }));
        const second = value(await catalog.list({ limit: 1, cursor: first.nextCursor! }));
        expect([...first.items, ...second.items].map(item => item.id)).toEqual(['native-doc', saved.id]);
        expect(second.nextCursor).toBeNull();
        expect(first.items[0]).toMatchObject({ kind: 'document', file: null });
        expect(await catalog.list({ limit: 0 })).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    });
    it('delivers committed lifecycle events and manages revisions, Trash and retained bytes', async () => {
        const trusted = activate();
        const events: PluginFileLifecycle[] = [];
        trusted.context.hooks.onAction('workspace.files:action:after', async event => {
            expect((await getDb().posts.get(event.after.id))?.title).toBe(event.after.title);
            events.push(event);
        });
        const { saved, ref } = await upload(trusted);
        const catalog = trusted.context.files.catalog;
        expect(value(await catalog.save(ref.id)).id).toBe(saved.id);
        const renamed = value(await catalog.update(saved.id, saved.revision, { title: 'Chosen title' }));
        expect(await catalog.update(saved.id, saved.revision, { title: 'Stale title' }))
            .toMatchObject({ ok: false, error: { code: 'conflict' } });
        const trashed = value(await catalog.update(saved.id, renamed.revision, { trashed: true }));
        expect(value(await catalog.list()).items).toEqual([]);
        expect(value(await catalog.list({ trashed: true })).items.map(item => item.id)).toEqual([saved.id]);
        const restored = value(await catalog.update(saved.id, trashed.revision, { trashed: false }));
        const indexed = value(await catalog.enableText(saved.id, restored.revision));
        expect(indexed.textCoverage).toBe('full');
        expect(await catalog.remove(saved.id, indexed.revision)).toMatchObject({ ok: false });
        const trashAgain = value(await catalog.update(saved.id, indexed.revision, { trashed: true }));
        value(await catalog.remove(saved.id, trashAgain.revision));
        expect(value(await catalog.get(saved.id))).toBeNull();
        expect(events.map(event => event.operation)).toEqual(['import', 'rename', 'trash', 'restore', 'index', 'trash', 'remove']);
        expect(events[1]).toMatchObject({ workspaceId, before: { title: 'notes.txt' }, after: { title: 'Chosen title' } });
        await trusted.dispose();
        expect((await getDb().file_meta.get(ref.id))?.ref_count).toBe(0);
        expect(await (await getDb().file_blobs.get(ref.id))!.blob.text()).toBe('Original saffron bytes');
    });

    it('refuses policy vetoes before commits and rejects mutation of hook snapshots', async () => {
        const { trusted, saved } = await upload();
        trusted.context.hooks.onFilter('workspace.files:filter:policy', (allowed, event) =>
            event.operation === 'trash' || event.operation === 'remove' ? false : allowed);
        expect(await trusted.context.files.catalog.update(saved.id, saved.revision, { trashed: true }))
            .toMatchObject({ ok: false, error: { code: 'permission-denied' } });
        expect(value(await trusted.context.files.catalog.get(saved.id))?.revision).toBe(saved.revision);
        // Assert outside the callback: the hook engine logs callback errors instead of rethrowing them.
        let observed: PluginFileLifecycle | undefined;
        trusted.context.hooks.onAction('workspace.files:action:before', event => { observed = event; });
        expect(value(await trusted.context.files.catalog.update(saved.id, saved.revision, { title: 'Allowed' })).title).toBe('Allowed');
        expect(observed?.after.title).toBe('Allowed');
        expect(() => { (observed!.after as { title: string }).title = 'Hijacked'; }).toThrow();
    });

    it('refuses the change when a policy callback throws or returns a non-boolean', async () => {
        const { trusted, saved } = await upload();
        const crashing = trusted.context.hooks.onFilter('workspace.files:filter:policy', () => { throw new Error('Policy unavailable'); });
        expect(await trusted.context.files.catalog.update(saved.id, saved.revision, { trashed: true }))
            .toMatchObject({ ok: false, error: { code: 'permission-denied' } });
        crashing.dispose();
        // An undefined veto must not be reversed by a later plugin that permits everything.
        trusted.context.hooks.onFilter('workspace.files:filter:policy', () => undefined as unknown as boolean, { priority: 1 });
        activate().context.hooks.onFilter('workspace.files:filter:policy', () => true, { priority: 2 });
        expect(await trusted.context.files.catalog.update(saved.id, saved.revision, { title: 'Refused' }))
            .toMatchObject({ ok: false, error: { code: 'permission-denied' } });
        expect((await getDb().posts.get(saved.id))?.title).toBe('notes.txt');
    });

    it('lets read-only members and hosts without Files activate file integrations', async () => {
        const { saved } = await upload();
        testRuntimeConfig.value.public.ssrAuthEnabled = true;
        let capability: 'v1' | undefined = 'v1';
        vi.spyOn(session, 'getCachedSessionPayload').mockImplementation(() => ({
            appAccessAllowed: true, workspaceItemCapability: capability,
        } as ReturnType<typeof session.getCachedSessionPayload>));
        vi.spyOn(session, 'getCachedSessionContext').mockImplementation(() => ({
            authenticated: true, user: { id: 'member' }, workspace: { id: workspaceId }, role: 'viewer',
        } as ReturnType<typeof session.getCachedSessionContext>));
        const viewer = activate();
        expect(() => viewer.context.hooks.onFilter('workspace.files:filter:policy', allowed => allowed)).not.toThrow();
        expect(() => viewer.context.hooks.onAction('workspace.files:action:after', () => {})).not.toThrow();
        expect(() => viewer.context.files.registerAction({ id: 'inspect', label: 'Inspect', run: () => {} })).not.toThrow();
        expect(await viewer.context.files.catalog.update(saved.id, saved.revision, { title: 'Viewer write' }))
            .toMatchObject({ ok: false, error: { code: 'permission-denied' } });
        capability = undefined;
        const unavailable = activate();
        expect(() => unavailable.context.files.registerAction({ id: 'inspect', label: 'Inspect', run: () => {} })).not.toThrow();
        expect(await unavailable.context.files.catalog.list()).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    });

    it('rechecks the row after asynchronous hooks and preserves a concurrent write', async () => {
        const { trusted, saved } = await upload();
        trusted.context.hooks.onAction('workspace.files:action:before', async () => {
            await getDb().posts.update(saved.id, { title: 'Concurrent title' });
        });
        expect(await trusted.context.files.catalog.update(saved.id, saved.revision, { title: 'Overwrite' }))
            .toMatchObject({ ok: false, error: { code: 'conflict' } });
        expect((await getDb().posts.get(saved.id))?.title).toBe('Concurrent title');
    });

    it('keeps committed writes successful if a notification hook fails', async () => {
        const { trusted, saved } = await upload();
        trusted.context.hooks.onAction('workspace.files:action:after', () => { throw new Error('Observer unavailable'); });
        expect(value(await trusted.context.files.catalog.update(saved.id, saved.revision, { title: 'Committed' })).title).toBe('Committed');
        expect((await getDb().posts.get(saved.id))?.title).toBe('Committed');
    });

    it('requires explicit catalog and action grants, including for lifecycle subscriptions', async () => {
        const trusted = activate(['files.read', 'files.write', 'hooks.register']);
        expect(await trusted.context.files.catalog.list()).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
        expect(() => trusted.context.files.registerAction({ id: 'inspect', label: 'Inspect', run: () => {} })).toThrow(/grant|required/i);
        expect(() => trusted.context.hooks.onAction('workspace.files:action:after', () => {})).toThrow(/grant|required/i);
        const reader = activate(['hooks.register', 'files.catalog.read']);
        expect(() => reader.context.hooks.onFilter('workspace.files:filter:policy', allowed => allowed)).toThrow(/grant|required/i);
    });

    it('binds actions and hooks to their activation and removes them on disposal', async () => {
        const { useWorkspaceFileActions } = await import('~/composables/files/useWorkspaceFileActions');
        const { trusted, saved } = await upload();
        let invoked = 0;
        trusted.context.files.registerAction({ id: 'inspect', label: 'Inspect', run: () => { invoked++; } });
        const actions = useWorkspaceFileActions();
        expect(actions.value).toHaveLength(1);
        await actions.value[0]!.run(saved);
        expect(invoked).toBe(1);
        const staleAction = actions.value[0]!;
        await trusted.dispose();
        expect(actions.value).toHaveLength(0);
        await expect(staleAction.run(saved)).rejects.toThrow(/ended/i);
        expect(await trusted.context.files.catalog.get(saved.id)).toMatchObject({ ok: false, error: { code: 'stale-context' } });
    });

    it('refuses a workspace switch during a before-hook without touching either workspace', async () => {
        const { trusted, saved } = await upload();
        const db = getDb();
        const other = `${workspaceId}-other`;
        dbIds.push(other);
        trusted.context.hooks.onAction('workspace.files:action:before', async () => { await setActiveWorkspaceDb(other).open(); });
        expect(await trusted.context.files.catalog.update(saved.id, saved.revision, { title: 'Wrong workspace' }))
            .toMatchObject({ ok: false, error: { code: 'stale-context' } });
        expect((await db.posts.get(saved.id))?.title).toBe('notes.txt');
        expect(await getDb().posts.count()).toBe(0);
    });

    it('rechecks cloud membership after hooks and refuses read-only writes', async () => {
        const { trusted, saved } = await upload();
        testRuntimeConfig.value.public.ssrAuthEnabled = true;
        let role: 'owner' | 'viewer' = 'owner';
        vi.spyOn(session, 'getCachedSessionPayload').mockImplementation(() => ({
            appAccessAllowed: true, workspaceItemCapability: 'v1',
        } as ReturnType<typeof session.getCachedSessionPayload>));
        vi.spyOn(session, 'getCachedSessionContext').mockImplementation(() => ({
            authenticated: true, user: { id: 'member' }, workspace: { id: workspaceId }, role,
        } as ReturnType<typeof session.getCachedSessionContext>));
        trusted.context.hooks.onAction('workspace.files:action:before', () => { role = 'viewer'; });
        expect(await trusted.context.files.catalog.update(saved.id, saved.revision, { title: 'Revoked write' }))
            .toMatchObject({ ok: false, error: { code: 'permission-denied' } });
        expect((await getDb().posts.get(saved.id))?.title).toBe('notes.txt');
        expect(await trusted.context.files.catalog.update(saved.id, saved.revision, { trashed: true }))
            .toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    });
});
