import Dexie from 'dexie';
import { File as NativeFile } from 'node:buffer';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import {
    persistAttachment,
    loadStoredAttachment,
    type AttachmentLike,
} from '~/components/chat/file-upload-utils';
import type { FilesAttachInputPayload } from '~/core/hooks/hook-types';
import { evictWorkspaceDb, getDb, setActiveWorkspaceDb } from '../client';
import { testRuntimeConfig } from '~~/tests/setup';
import * as hashing from '~/utils/hash';
import { getWorkspaceGeneration } from '../client';
import { updateWorkspaceFile } from '../workspace-files';
import { workspaceRevision } from '~/utils/chat/workspace-items';
import { workspaceItemMetadata } from '~~/shared/posts/workspace-item';
import * as policy from '~/core/storage/file-policy';
import * as offlineWorkspace from '~/composables/auth/offline-workspace';

describe('files.attach:filter:input hook', () => {
    it('rejects declared images whose bytes were classified as a generic file', async () => {
        const att = attachment();
        att.file = new NativeFile(['not an image'], 'fake.png', { type: 'image/png' }) as unknown as File;
        att.name = 'fake.png'; att.mime = 'image/png'; att.kind = 'image';
        await persistAttachment(att);
        expect(att.status).toBe('error');
        expect((await getDb().file_meta.toArray())[0]).toMatchObject({ kind: 'file', ref_count: 0 });
        expect(await getDb().posts.count()).toBe(0);
    });
    it('releases a failed intake reference and clears the error when retried', async () => {
        let reject = true;
        useHooks().addFilter('workspace.files:filter:policy', () => !reject);
        const att = attachment();
        await persistAttachment(att);
        expect(att.status).toBe('error');
        expect((await getDb().file_meta.toArray())[0]?.ref_count).toBe(0);
        reject = false;
        att.status = 'pending';
        await persistAttachment(att);
        expect(att.status).toBe('ready');
        expect(att.error).toBeUndefined();
        expect((await getDb().file_meta.toArray())[0]?.ref_count).toBe(2);
    });
    let originalAuth: boolean;
    let workspace: string;

    beforeEach(async () => {
        originalAuth = testRuntimeConfig.value.public.ssrAuthEnabled;
        testRuntimeConfig.value.public.ssrAuthEnabled = false;
        setHookEngine(createTypedHookEngine(createHookEngine()));
        workspace = `attachment-filter-${crypto.randomUUID()}`;
        await setActiveWorkspaceDb(workspace).open();
    });

    afterEach(async () => {
        testRuntimeConfig.value.public.ssrAuthEnabled = originalAuth;
        const db = getDb();
        setActiveWorkspaceDb(null);
        evictWorkspaceDb(workspace);
        await Dexie.delete(db.name);
        setHookEngine(null);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function attachment(): AttachmentLike {
        return {
            file: new NativeFile(['%PDF-1.4 attachment'], 'original.pdf', {
                type: 'application/pdf',
            }) as unknown as File,
            name: 'original.pdf',
            status: 'pending',
            mime: 'application/pdf',
            kind: 'pdf',
        };
    }

    async function savedOriginal(legacyImage = false) {
        const saved = legacyImage ? {
            ...attachment(),
            file: new NativeFile([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
                'original.png', { type: 'image/png' }) as unknown as File,
            name: 'original.png',
            mime: 'image/png',
            kind: 'image',
        } : attachment();
        await persistAttachment(saved);
        if (legacyImage) {
            await getDb().file_meta.update(saved.hash!, { kind: undefined });
            expect((await getDb().file_meta.get(saved.hash!))?.kind).toBeUndefined();
        }
        const post = (await getDb().posts.toArray())[0]!;
        const controller = new AbortController();
        const owner = { signal: controller.signal, assertCurrent: () => controller.signal.throwIfAborted() };
        vi.stubGlobal('File', NativeFile);
        const stored = await loadStoredAttachment({ id: post.id, hash: saved.hash!, workspaceId: workspace,
            generation: getWorkspaceGeneration(), ...(legacyImage ? { kind: 'image' as const } : {}) }, owner);
        return { stored, owner, controller, post, next: { ...saved, file: stored.file, status: 'pending' as AttachmentLike['status'] } };
    }

    it('rejects file when filter returns false without persisting bytes', async () => {
        useHooks().addFilter('files.attach:filter:input', () => false as const);
        const att = attachment();

        await persistAttachment(att);

        expect(att.status).toBe('error');
        expect(att.error).toBeTruthy();
        expect(await getDb().file_meta.count()).toBe(0);
        expect(await getDb().file_blobs.count()).toBe(0);
    });

    it('shows the DB hook name for a new file and the selection name for reused bytes', async () => {
        useHooks().addFilter('db.files.create:filter:input', payload => ({ ...payload, name: 'plugin-title.pdf' }));
        const first = attachment();
        const second = { ...attachment(), name: 'another-selection.pdf' };

        await persistAttachment(first);
        await persistAttachment(second);

        expect(first.name).toBe('plugin-title.pdf');
        expect(second.name).toBe('another-selection.pdf');
        expect(second.hash).toBe(first.hash);
        expect(await getDb().file_blobs.count()).toBe(1);
    });

    it.each([false, true])('persists accepted attachment values (rename: %s)', async rename => {
        const att = attachment();
        let receivedPayload: FilesAttachInputPayload | false | null = null;
        useHooks().addFilter('files.attach:filter:input', payload => {
            receivedPayload = payload;
            if (payload === false) return false;
            return rename ? { ...payload, name: 'renamed.pdf' } : payload;
        });

        await persistAttachment(att);

        expect(receivedPayload).toMatchObject({
            file: att.file,
            name: 'original.pdf',
            mime: 'application/pdf',
            size: att.file.size,
            kind: 'pdf',
        });
        expect(att.status).toBe('ready');
        expect(att.error).toBeUndefined();
        expect(att.hash).toBeDefined();
        expect(att.name).toBe(rename ? 'renamed.pdf' : 'original.pdf');
        const saved = await getDb().file_meta.get(att.hash!);
        expect(saved).toMatchObject({
            name: rename ? 'renamed.pdf' : 'original.pdf',
            mime_type: 'application/pdf',
            size_bytes: att.file.size,
        });
        const stored = await getDb().file_blobs.get(att.hash!);
        expect(await stored?.blob.text()).toBe('%PDF-1.4 attachment');
    });

    it.each(['PDF', 'legacy image'] as const)('retains a saved %s through attachment filters without hashing it again', async original => {
        const { stored, next } = await savedOriginal(original === 'legacy image');
        const db = getDb();
        const meta = stored.meta;
        const hash = vi.spyOn(hashing, 'computeFileHash');
        const filter = vi.fn((value: FilesAttachInputPayload | false) => value === false ? false : { ...value, name: 'composer-label.pdf' });
        useHooks().addFilter('files.attach:filter:input', filter);
        try {
            await persistAttachment(next, undefined, stored);
            expect(next.status).toBe('ready');
            expect(next.hash).toBe(meta.hash);
            expect(next.kind).toBe(original === 'legacy image' ? 'image' : 'pdf');
            expect(next.name).toBe('composer-label.pdf');
            expect(filter).toHaveBeenCalledOnce();
            expect(hash).not.toHaveBeenCalled();
            expect((await db.file_meta.get(meta.hash))?.ref_count).toBe(meta.ref_count + 1);
            expect(await db.posts.count()).toBe(1);
        } finally { hash.mockRestore(); }
    });

    it('hashes and classifies replacement bytes supplied by an attachment filter', async () => {
        const { stored, owner, next } = await savedOriginal();
        useHooks().addFilter('files.attach:filter:input', value => value === false ? false : {
            ...value, file: new NativeFile(['%PDF-1.4 transformed'], 'changed.pdf', { type: 'application/pdf' }) as unknown as File,
            name: 'changed.pdf',
        });
        await persistAttachment(next, owner, stored);
        expect(next.status).toBe('ready');
        expect(next.hash).not.toBe(stored.meta.hash);
        expect(next.name).toBe('changed.pdf');
        expect(await (await getDb().file_blobs.get(next.hash!))?.blob.text()).toBe('%PDF-1.4 transformed');
        expect((await getDb().file_meta.get(stored.meta.hash))?.ref_count).toBe(stored.meta.ref_count);
    });

    it.each(['trash', 'workspace', 'abort'].flatMap(transition =>
        ['filter', 'retention'].map(stage => ({ transition, stage }))))('rejects a saved attachment after $transition during $stage', async ({ transition, stage }) => {
        const { stored, owner, controller, post, next } = await savedOriginal();
        const db = getDb();
        const other = `attachment-other-${crypto.randomUUID()}`;
        let invalidated = false;
        const invalidate = async () => {
            if (invalidated) return;
            invalidated = true;
            if (transition === 'trash') await updateWorkspaceFile(stored.scope, post.id, await workspaceRevision(post), { trashed: true });
            else if (transition === 'workspace') await setActiveWorkspaceDb(other).open();
            else controller.abort();
        };
        if (stage === 'filter') useHooks().addFilter('files.attach:filter:input', async value => { await invalidate(); return value; });
        else useHooks().addAction('db.files.refchange:action:after', async change => { if (change.delta === 1) await invalidate(); });
        try {
            await persistAttachment(next, owner, stored);
            expect(next.status).toBe('error');
            expect((await db.file_meta.get(stored.meta.hash))?.ref_count).toBe(stored.meta.ref_count);
            if (transition === 'trash') expect(workspaceItemMetadata((await db.posts.get(post.id))?.meta)?.trashed_at).not.toBeNull();
            if (transition === 'workspace') expect(await getDb().file_meta.count()).toBe(0);
        } finally {
            setActiveWorkspaceDb(workspace);
            evictWorkspaceDb(other); await Dexie.delete(`or3-db-${other}`);
        }
    });

    it.each(['online', 'offline'] as const)('honors the %s private upload policy when reusing a saved original', async mode => {
        const { stored, owner, next } = await savedOriginal();
        const limit = { maxUploadBytes: 1 } as Awaited<ReturnType<typeof policy.loadFilePolicy>>;
        vi.spyOn(policy, 'isCloudFileStorageEnabled').mockReturnValue(mode === 'online');
        const load = vi.spyOn(policy, 'loadFilePolicy').mockResolvedValue(limit);
        if (mode === 'offline') {
            vi.spyOn(offlineWorkspace, 'getOfflineWorkspace').mockReturnValue({ workspaceId: workspace, workspaceName: 'Saved workspace',
                userId: 'offline-owner', role: 'owner', workspaceItemCapability: 'v1' });
            vi.spyOn(policy, 'isCloudFileStorageConfigured').mockReturnValue(true);
            vi.spyOn(policy, 'getVerifiedFilePolicy').mockReturnValue(limit);
        }
        await persistAttachment(next, owner, stored);
        expect(next.status).toBe('error');
        expect((await getDb().file_meta.get(stored.meta.hash))?.ref_count).toBe(stored.meta.ref_count);
        if (mode === 'offline') expect(load).not.toHaveBeenCalled();
    });

    it('uses the active workspace policy when an offline workspace record belongs to another workspace', async () => {
        const { stored, owner, next } = await savedOriginal();
        const workspacePolicy = { maxUploadBytes: next.file.size } as Awaited<ReturnType<typeof policy.loadFilePolicy>>;
        const previousOr3 = testRuntimeConfig.value.public.or3;
        testRuntimeConfig.value.public.or3 = { limits: { maxFileSizeBytes: 1 } };
        vi.spyOn(policy, 'isCloudFileStorageEnabled').mockReturnValueOnce(true).mockReturnValue(false);
        vi.spyOn(policy, 'loadFilePolicy').mockResolvedValue(workspacePolicy);
        vi.spyOn(offlineWorkspace, 'getOfflineWorkspace').mockReturnValue({ workspaceId: 'inactive-workspace',
            workspaceName: 'Inactive workspace', userId: 'offline-owner', role: 'owner', workspaceItemCapability: 'v1' });
        try {
            await persistAttachment(next, owner, stored);
            expect(next.status).toBe('ready');
            expect((await getDb().file_meta.get(stored.meta.hash))?.ref_count).toBe(stored.meta.ref_count + 1);
        } finally {
            testRuntimeConfig.value.public.or3 = previousOr3;
        }
    });
});
