import Dexie from 'dexie';
import { File as NativeFile } from 'node:buffer';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import {
    persistAttachment,
    type AttachmentLike,
} from '~/components/chat/file-upload-utils';
import type { FilesAttachInputPayload } from '~/core/hooks/hook-types';
import { evictWorkspaceDb, getDb, setActiveWorkspaceDb } from '../client';
import { testRuntimeConfig } from '~~/tests/setup';

describe('files.attach:filter:input hook', () => {
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

    it('rejects file when filter returns false without persisting bytes', async () => {
        useHooks().addFilter('files.attach:filter:input', () => false as const);
        const att = attachment();

        await persistAttachment(att);

        expect(att.status).toBe('error');
        expect(att.error).toBeTruthy();
        expect(await getDb().file_meta.count()).toBe(0);
        expect(await getDb().file_blobs.count()).toBe(0);
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
        const saved = await getDb().file_meta.get(att.hash!);
        expect(saved).toMatchObject({
            name: rename ? 'renamed.pdf' : 'original.pdf',
            mime_type: 'application/pdf',
            size_bytes: att.file.size,
        });
        const stored = await getDb().file_blobs.get(att.hash!);
        expect(await stored?.blob.text()).toBe('%PDF-1.4 attachment');
    });
});
