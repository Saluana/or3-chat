import 'fake-indexeddb/auto';
import { Blob as NativeBlob } from 'node:buffer';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setHookEngine } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { evictWorkspaceDb, getWorkspaceDb, setActiveWorkspaceDb, type Or3DB } from '~/db/client';
import { FileMetaSchema } from '~/db/schema';
import type { SessionContext } from '~/core/hooks/hook-types';
import { buildOpenRouterMessages } from '../openrouter-build';

const boundary = vi.hoisted(() => ({ beforeBlob: async () => {}, session: null as SessionContext | null }));
vi.mock('~/composables/auth/useSessionContext', () => ({ getCachedSessionContext: () => boundary.session }));
// fake-indexeddb clones native Blobs; jsdom's FileReader accepts jsdom Blobs.
// Adapt only that platform boundary, retaining the production metadata/blob reads.
vi.mock('~/db/files', async original => {
    const actual = await original<typeof import('~/db/files')>();
    return { ...actual, getFileBlob: async (hash: string, db?: Or3DB) => {
        const blob = await actual.getFileBlob(hash, db);
        await boundary.beforeBlob();
        return blob ? new Blob([await blob.arrayBuffer()], { type: blob.type }) : undefined;
    } };
});
const databases: Array<{ id: string; db: Or3DB }> = [];
beforeEach(() => {
    boundary.beforeBlob = async () => {}; boundary.session = null;
    setHookEngine(createTypedHookEngine(createHookEngine()));
});
afterEach(async () => {
    setActiveWorkspaceDb(null); setHookEngine(null);
    for (const { id, db } of databases.splice(0)) { evictWorkspaceDb(id); await Dexie.delete(db.name); }
});
async function fixture(kind: 'image' | 'file') {
    const id = crypto.randomUUID(); const db = getWorkspaceDb(id); databases.push({ id, db }); await db.open();
    const hash = crypto.randomUUID().replaceAll('-', '');
    const mime = kind === 'image' ? 'image/png' : 'application/pdf';
    await db.file_meta.put(FileMetaSchema.parse({ hash, name: 'private', kind: kind === 'file' ? 'pdf' : kind,
        mime_type: mime, size_bytes: 7, ref_count: 1, clock: 1, created_at: 1, updated_at: 1 }));
    await db.file_blobs.put({ hash, blob: new NativeBlob(['private'], { type: mime }) as unknown as Blob });
    const input = [{ role: 'user' as const, content: kind === 'file'
        ? [{ type: 'file' as const, data: hash, mediaType: mime, filename: 'private.pdf' }]
        : [{ type: 'image' as const, image: hash, mediaType: mime }] }];
    return { id, db, hash, input };
}
describe('provider attachment ownership with real workspace stores', () => {
    it.each(['image', 'file'] as const)('does not reuse hydrated %s bytes without metadata in the active workspace', async kind => {
        const a = await fixture(kind); const b = await fixture(kind); setActiveWorkspaceDb(a.id);
        const primed = await buildOpenRouterMessages(a.input); expect(primed[0]?.content).toHaveLength(2);
        setActiveWorkspaceDb(b.id);
        await expect(buildOpenRouterMessages(a.input)).rejects.toMatchObject({ name: 'AttachmentHydrationError' });
    });

    it.each(['missing', 'deleted'] as const)('requires live metadata after an earlier successful hydration (%s)', async status => {
        const a = await fixture('file'); setActiveWorkspaceDb(a.id);
        await buildOpenRouterMessages(a.input);
        if (status === 'missing') await a.db.file_meta.delete(a.hash);
        else await a.db.file_meta.update(a.hash, { deleted: true });
        await expect(buildOpenRouterMessages(a.input)).rejects.toMatchObject({ name: 'AttachmentHydrationError' });
    });

    it.each(['workspace', 'account'] as const)('fences a suspended blob read after its %s changes', async change => {
        const a = await fixture('file'); const b = await fixture('file'); setActiveWorkspaceDb(a.id);
        if (change === 'account') boundary.session = { authenticated: true, user: { id: 'A' }, role: 'owner' };
        let release!: () => void; let entered!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const reached = new Promise<void>(resolve => { entered = resolve; });
        boundary.beforeBlob = async () => { entered(); await gate; };
        const pending = buildOpenRouterMessages(a.input).catch(error => error);
        await reached;
        if (change === 'account') boundary.session!.user = { id: 'B' };
        else setActiveWorkspaceDb(b.id);
        const next = change === 'workspace' ? buildOpenRouterMessages(a.input).catch(error => error) : null;
        release();
        expect(await pending).toBeInstanceOf(Error);
        if (next) expect(await next).toBeInstanceOf(Error);
    });
});
