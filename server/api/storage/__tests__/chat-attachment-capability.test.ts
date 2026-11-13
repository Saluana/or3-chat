import { createApp, toWebHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ query: vi.fn(), presign: vi.fn(), read: vi.fn(), access: vi.fn() }));
vi.mock('../../../auth/session', () => ({ resolveSessionContext: async () => ({ authenticated: true, user: { id: 'alice' }, workspace: { id: 'ws' } }) }));
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({ isSsrAuthEnabled: () => true }));
vi.mock('../../../utils/storage/is-storage-enabled', () => ({ isStorageEnabled: () => true }));
vi.mock('../../../utils/security/cloud-mutation', () => ({ requireCloudMutation: () => undefined }));
vi.mock('../../../utils/storage/workspace-access', () => ({ requireStorageWorkspaceAccess: state.access }));
vi.mock('../../../utils/sync/rate-limiter', () => ({ checkSyncRateLimit: () => ({ allowed: true }), recordSyncRequest: () => undefined }));
vi.mock('../../../utils/rate-limit/enforce', () => ({ enforceRateLimit: () => undefined }));
vi.mock('../../../sync/gateway/registry', () => ({ getActiveSyncGatewayAdapter: () => ({ queryCanonicalStorage: state.query }) }));
vi.mock('../../../storage/gateway/registry', () => ({ getActiveStorageGatewayAdapter: () => ({ presignDownload: state.presign, readChatAttachment: state.read }) }));
import handler from '../chat-attachment-capability.post';

const first = `sha256:${'a'.repeat(64)}`;
const second = `sha256:${'b'.repeat(64)}`;
const file = (hash: string) => ({ hash, storageId: `ws:${hash}`, mime: 'image/png', size: 7 });
const app = createApp();
app.use(handler);
const request = toWebHandler(app);
const call = () => request(new Request('http://localhost/api/storage/chat-attachment-capability', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' }, body: JSON.stringify({ files: [file(first), file(second)] }) }));

beforeEach(() => {
    vi.resetAllMocks();
    state.access.mockResolvedValue(undefined);
    state.query.mockImplementation(async (_event, input) => ({ hasMore: false, items: [{ kind: 'metadata',
        hash: input.hash, storageId: `ws:${input.hash}`, mimeType: 'image/png', fileKind: 'image', sizeBytes: 7 }] }));
    state.presign.mockImplementation(async (_event, input) => {
        if (input.hash === second) throw new Error('not committed');
        return { url: '/private-token', storageId: input.storageId };
    });
});

describe('Cloud attachment capability', () => {
    it('only opts committed canonical files into references and never returns private URLs', async () => {
        const response = await call();
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(await response.json()).toEqual({ version: 1, workspaceId: 'ws', eligible: [0] });
        expect(state.access).toHaveBeenCalledTimes(2);
    });

    it('rejects preflight after workspace access is revoked', async () => {
        state.access.mockRejectedValue(Object.assign(new Error('Forbidden'), { statusCode: 403 }));
        const response = await call();
        expect(response.status).toBe(403);
        expect(state.query).not.toHaveBeenCalled();
        expect(state.presign).not.toHaveBeenCalled();
    });
});
