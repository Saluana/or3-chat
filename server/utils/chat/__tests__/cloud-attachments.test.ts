import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import type { SessionContext } from '~/core/hooks/hook-types';

const mocks = vi.hoisted(() => ({ query: vi.fn(), read: vi.fn(), access: vi.fn() }));
vi.mock('../../../sync/gateway/registry', () => ({ getActiveSyncGatewayAdapter: () => ({ queryCanonicalStorage: mocks.query }) }));
vi.mock('../../../storage/gateway/registry', () => ({ getActiveStorageGatewayAdapter: () => ({ readChatAttachment: mocks.read }) }));
vi.mock('../../security/limited-json-body', () => ({ MODEL_REQUEST_BODY_LIMIT_BYTES: 1024 }));
vi.mock('../../storage/workspace-access', () => ({ requireStorageWorkspaceAccess: mocks.access }));
import { resolveCloudAttachments } from '../cloud-attachments';

const event = {} as H3Event;
const session = { authenticated: true, user: { id: 'alice' }, workspace: { id: 'workspace' } } as SessionContext;
const bytes = Buffer.from('actual image bytes');
const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const body = () => ({ model: 'test', messages: [{ role: 'user', content: [
    { type: 'text', text: 'Describe this' }, { type: 'image_url', image_url: { url: 'or3-cloud-attachment:0' } },
] }], _cloudAttachments: [{ messageIndex: 0, partIndex: 1, hash, storageId: `workspace:${hash}`, prefix: 'data:image/png;base64,' }] });

beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue({ hasMore: false, items: [{ kind: 'metadata', hash: hash.slice(7),
        storageId: `workspace:${hash}`, sizeBytes: bytes.length, mimeType: 'image/png', fileKind: 'image' }] });
    mocks.read.mockImplementation(async () => new Response(bytes));
});

describe('Cloud chat attachment resolution', () => {
    it('resolves committed workspace content before dispatch without changing message order or bytes', async () => {
        const request = body();
        await resolveCloudAttachments(event, session, request);
        expect(request.messages[0]!.content).toEqual([{ type: 'text', text: 'Describe this' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } }]);
        expect(request).not.toHaveProperty('_cloudAttachments');
        expect(mocks.access).toHaveBeenCalledTimes(2);
        expect(mocks.read).toHaveBeenCalledWith(event, { workspaceId: 'workspace', hash, storageId: `workspace:${hash}` });
    });

    it.each(['missing', 'wrong-object', 'oversized', 'wrong-kind', 'wrong-digest', 'revoked', 'deleted-during-read'] as const)(
        'rejects %s references before provider dispatch', async failure => {
            if (failure === 'missing') mocks.query.mockResolvedValue({ hasMore: false, items: [] });
            if (failure === 'wrong-object') mocks.query.mockResolvedValue({ hasMore: false, items: [{ kind: 'metadata', hash, storageId: 'different', sizeBytes: bytes.length, mimeType: 'image/png', fileKind: 'image' }] });
            if (failure === 'oversized') mocks.query.mockResolvedValue({ hasMore: false, items: [{ kind: 'metadata', hash, storageId: `workspace:${hash}`, sizeBytes: 17 * 1024 * 1024, mimeType: 'image/png', fileKind: 'image' }] });
            if (failure === 'wrong-kind') mocks.query.mockResolvedValue({ hasMore: false, items: [{ kind: 'metadata', hash, storageId: `workspace:${hash}`, sizeBytes: bytes.length, mimeType: 'image/png', fileKind: 'file' }] });
            if (failure === 'wrong-digest') mocks.read.mockResolvedValue(new Response(Buffer.from('invalid image byte')));
            if (failure === 'revoked') mocks.access.mockRejectedValue(Object.assign(new Error('revoked'), { statusCode: 403 }));
            if (failure === 'deleted-during-read') mocks.read.mockImplementation(async () => {
                mocks.query.mockResolvedValue({ hasMore: false, items: [] });
                return new Response(bytes);
            });
            await expect(resolveCloudAttachments(event, session, body())).rejects.toThrow();
            if (['missing', 'wrong-object', 'oversized', 'wrong-kind', 'revoked'].includes(failure)) expect(mocks.read).not.toHaveBeenCalled();
        });

    it('accepts an expanded request at the size limit and rejects one above it', async () => {
        const makeRequest = (size: number) => {
            const request = body();
            const original = structuredClone(request);
            original.messages[0]!.content[1]!.image_url!.url = `data:image/png;base64,${bytes.toString('base64')}`;
            delete (original as Partial<typeof original>)._cloudAttachments;
            const padding = size - Buffer.byteLength(JSON.stringify(original));
            request.messages[0]!.content[0]!.text = 'Describe this' + 'x'.repeat(padding);
            return request;
        };
        const atLimit = makeRequest(1024);
        await expect(resolveCloudAttachments(event, session, atLimit)).resolves.toBeUndefined();
        expect(Buffer.byteLength(JSON.stringify(atLimit))).toBe(1024);
        await expect(resolveCloudAttachments(event, session, makeRequest(1025))).rejects.toMatchObject({ statusCode: 413 });
    });

    it('leaves legacy inline requests untouched', async () => {
        const request = { messages: [{ role: 'user', content: 'hello' }] };
        await resolveCloudAttachments(event, null, request);
        expect(request).toEqual({ messages: [{ role: 'user', content: 'hello' }] });
        expect(mocks.access).not.toHaveBeenCalled();
    });
});
