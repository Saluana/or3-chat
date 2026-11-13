import 'fake-indexeddb/auto';
import { createHash, webcrypto } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evictWorkspaceDb, setActiveWorkspaceDb } from '~/db/client';
import { prepareCloudAttachmentReferences } from '../cloud-attachments';
import type { OpenRouterRequestBody } from '../openrouter-request';

const state = vi.hoisted(() => ({ session: { authenticated: true, user: { id: 'alice' }, workspace: { id: 'cloud-ref-test' }, role: 'owner' } }));
vi.mock('~/composables/auth/useSessionContext', () => ({ getCachedSessionContext: () => state.session }));
const fsStorage = { enabled: true, provider: 'fs' };
const bytes = Buffer.alloc(40 * 1024, 42);
const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const url = `data:image/png;base64,${bytes.toString('base64')}`;
const request = (): OpenRouterRequestBody => ({ model: 'test', stream: true, messages: [{ role: 'user', content: [
    { type: 'text', text: 'describe' }, { type: 'image_url', image_url: { url } },
] }] });

beforeEach(async () => {
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('crypto', webcrypto);
    state.session.user.id = 'alice';
    const db = setActiveWorkspaceDb('cloud-ref-test');
    await db.file_meta.put({ hash, name: 'image.png', kind: 'image', mime_type: 'image/png', size_bytes: bytes.length,
        storage_id: `cloud-ref-test:${hash}`, storage_provider_id: 'fs', deleted: false, ref_count: 1,
        created_at: 1, updated_at: 1, clock: 1 });
});
afterEach(async () => {
    const db = setActiveWorkspaceDb('cloud-ref-test');
    setActiveWorkspaceDb(null);
    evictWorkspaceDb('cloud-ref-test');
    await db.delete();
    vi.unstubAllGlobals();
});

describe('Cloud attachment request preparation', () => {
    it('does not decode attachments for an unsupported storage provider', async () => {
        const decode = vi.spyOn(globalThis, 'atob');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const original = request();
        expect(await prepareCloudAttachmentReferences(original, undefined, { enabled: true, provider: 'hippius' })).toEqual(original);
        expect(decode).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        decode.mockRestore();
    });
    it('keeps small attachments inline without a preflight request', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const small = request();
        small.messages[0]!.content = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,c21hbGw=' } }];
        expect(await prepareCloudAttachmentReferences(small, undefined, fsStorage)).toEqual(small);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('replaces only an eligible committed original while preserving the original request', async () => {
        const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ version: 1, workspaceId: 'cloud-ref-test', eligible: [0] })));
        vi.stubGlobal('fetch', fetchMock);
        const original = request();
        const prepared = await prepareCloudAttachmentReferences(original, undefined, fsStorage);
        expect(original.messages[0]!.content).toEqual([{ type: 'text', text: 'describe' }, { type: 'image_url', image_url: { url } }]);
        expect(prepared.messages[0]!.content).toEqual([{ type: 'text', text: 'describe' },
            { type: 'image_url', image_url: { url: 'or3-cloud-attachment:0' } }]);
        expect(prepared).toMatchObject({ _cloudAttachments: [{ hash, storageId: `cloud-ref-test:${hash}`, prefix: 'data:image/png;base64,' }] });
        const preflight = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
        expect(preflight.files).toEqual([{ hash, storageId: `cloud-ref-test:${hash}`, mime: 'image/png', size: bytes.length }]);
        expect(JSON.stringify(preflight)).not.toContain(bytes.toString('base64'));
    });

    it('replaces multiple parts in one message without mutating their originals', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 1, workspaceId: 'cloud-ref-test', eligible: [0, 1] }))));
        const original = request();
        const content = original.messages[0]!.content;
        if (!Array.isArray(content)) throw new Error('Expected content parts');
        content.push({ type: 'image_url', image_url: { url } });
        const prepared = await prepareCloudAttachmentReferences(original, undefined, fsStorage);
        expect(original.messages[0]!.content).toEqual([{ type: 'text', text: 'describe' },
            { type: 'image_url', image_url: { url } }, { type: 'image_url', image_url: { url } }]);
        expect(prepared.messages[0]!.content).toEqual([{ type: 'text', text: 'describe' },
            { type: 'image_url', image_url: { url: 'or3-cloud-attachment:0' } },
            { type: 'image_url', image_url: { url: 'or3-cloud-attachment:1' } }]);
    });

    it.each(['older-server', 'uncommitted'] as const)('keeps bytes inline for %s', async mode => {
        vi.stubGlobal('fetch', vi.fn(async () => mode === 'older-server' ? new Response('', { status: 404 })
            : new Response(JSON.stringify({ version: 1, workspaceId: 'cloud-ref-test', eligible: [] }))));
        const original = request();
        expect(await prepareCloudAttachmentReferences(original, undefined, fsStorage)).toEqual(original);
    });

    it('rejects a result from a previous account in the same workspace', async () => {
        let finish!: (response: Response) => void;
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
        const pending = prepareCloudAttachmentReferences(request(), undefined, fsStorage);
        while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
        state.session.user.id = 'bob';
        finish(new Response(JSON.stringify({ version: 1, workspaceId: 'cloud-ref-test', eligible: [0] })));
        await expect(pending).rejects.toThrow(/workspace or account/);
    });
});
