import assert from 'node:assert/strict';
const profileRoot = process.argv[2];
if (!profileRoot?.startsWith('/private/tmp/or3-workspace-cloud-e2e-'))
    throw Error('Requires an owned disposable cloud profile');
const profile = await Bun.file(profileRoot + '/profile.json').json();
if (profile.root !== profileRoot || new URL(profile.origin).hostname !== '127.0.0.1')
    throw Error('Disposable loopback only');
const origin = profile.origin;
const storageProvider = profile.storageProvider;
const receipts: string[] = [];
let cookies = '';
async function request(path: string, data?: unknown, jar?: {
    cookie: string;
}, intent = 'mutation') {
    const headers: Record<string, string> = { origin, 'x-or3-cloud-intent': intent, 'content-type': 'application/json' };
    if (jar?.cookie ?? cookies)
        headers.cookie = jar?.cookie ?? cookies;
    const r = await fetch(origin + path, { method: data ? 'POST' : 'GET', headers, ...(data ? { body: JSON.stringify(data) } : {}) });
    const set = r.headers.getSetCookie();
    if (set.length) {
        const combined = set.map(c => c.split(';')[0]).join('; ');
        if (jar)
            jar.cookie = combined;
        else
            cookies = combined;
    }
    return r;
}
async function json(path: string, data?: unknown, jar?: {
    cookie: string;
}, intent = 'mutation') { const r = await request(path, data, jar, intent); const text = await r.text(); assert(r.ok, `${path}: ${r.status} ${text.slice(0, 1200)}`); return JSON.parse(text); }
await json('/api/basic-auth/sign-in', { email: 'workspace-e2e@example.test', password: 'DisposableWorkspaceE2e!123' });
const session = await json('/api/auth/session');
assert(session.appAccessAllowed);
assert.equal(session.workspaceItemCapability, 'v1');
const workspaceId = session.session.workspace.id;
receipts.push('Authenticated gateway advertises qualified adapter');
const bytes = new TextEncoder().encode('Saffron authenticated cloud catalog evidence.');
const hash = 'sha256:' + Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
const upload = await json('/api/storage/presign-upload', { workspace_id: workspaceId, hash, mime_type: 'text/plain', size_bytes: bytes.length, file_kind_capability: 'v1' });
const uploaded = await fetch(new URL(upload.url, origin), { method: upload.method || 'POST', headers: { ...upload.headers, cookie: cookies, 'content-type': 'text/plain' }, body: bytes });
assert(uploaded.ok, 'Blob upload: ' + uploaded.status);
const storageId = upload.storageId ?? (await uploaded.json()).storageId;
await json('/api/storage/commit', { workspace_id: workspaceId, hash, storage_id: storageId, intent_id: upload.intentId, storage_provider_id: storageProvider, mime_type: 'text/plain', size_bytes: bytes.length, name: 'cloud-proof.txt', kind: 'file', file_kind_capability: 'v1' });
receipts.push('Actual presign/upload/commit original bytes');
let clock = 1;
const op = (tableName: string, pk: string, payload: unknown) => ({ id: crypto.randomUUID(), tableName, pk, payload, operation: 'put', stamp: { deviceId: 'sandbox-gateway', opId: crypto.randomUUID(), hlc: Date.now() + ':0:sandbox-gateway', clock: clock++ }, createdAt: Date.now(), attempts: 0, status: 'pending' });
const id = 'workspace-cloud-proof-' + storageProvider;
const catalog = { id, title: 'Authenticated cloud proof', post_type: 'or3:file', content: new TextDecoder().decode(bytes), file_hashes: JSON.stringify([hash]), meta: JSON.stringify({ plugin_key: 'retain', 'or3.workspace-item': { version: 1, trashed_at: null, text: { coverage: 'full', indexed_bytes: bytes.length } } }), created_at: 1, updated_at: 1, clock: 1, deleted: false };
const body = { scope: { workspaceId }, fileKindCapability: 'v1', workspaceItemCapability: 'v1', ops: [op('file_meta', hash, { hash, name: 'cloud-proof.txt', mime_type: 'text/plain', kind: 'file', size_bytes: bytes.length, ref_count: 1, storage_id: storageId, storage_provider_id: storageProvider, deleted: false, created_at: 1, updated_at: 1, clock: 1 }), op('posts', id, catalog)] };
const push = await json('/api/sync/push', body);
assert(push.results.every((r: any) => r.success), JSON.stringify(push));
const replay = await json('/api/sync/push', body);
assert.equal(push.serverVersion, replay.serverVersion);
receipts.push('Gateway push and lost-response replay');
const snap = await json('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, fileKindCapability: 'v1', workspaceItemCapability: 'v1' });
assert.equal(snap.items.find((r: any) => r.pk === id).payload.content, catalog.content);
receipts.push('New-device materialized catalog snapshot');
assert.equal((await request('/api/sync/pull', { scope: { workspaceId }, cursor: 0, limit: 100, fileKindCapability: 'v1' })).status, 426);
assert.equal((await request('/api/sync/push', { scope: { workspaceId }, ops: [op('posts', id, { ...catalog, meta: '', post_type: 'doc' })] })).status, 426);
receipts.push('Old gateway read/write rejected before mutation');
const download = await json('/api/storage/presign-download', { workspace_id: workspaceId, hash, storage_id: storageId, file_kind_capability: 'v1' });
assert.deepEqual(new Uint8Array(await (await fetch(new URL(download.url, origin), { headers: { cookie: cookies } })).arrayBuffer()), bytes);
receipts.push('Original bytes preserved through gateway');
console.log(JSON.stringify({ origin, workspaceId, receipts }, null, 2));
const member = { cookie: '' }, adminJar = { cookie: '' };
await json('/api/basic-auth/register', { email: 'viewer-' + crypto.randomUUID() + '@example.test', password: 'DisposableMemberE2e!123', confirmPassword: 'DisposableMemberE2e!123' }, member);
const memberSession = await json('/api/auth/session', undefined, member);
const adminLogin = await fetch(origin + '/api/admin/auth/login', { method: 'POST', headers: { origin, 'x-or3-admin-intent': 'admin', 'content-type': 'application/json' }, body: JSON.stringify({ username: 'workspace-e2e-admin', password: 'DisposableAdminE2e!123' }) });
assert(adminLogin.ok);
adminJar.cookie = adminLogin.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
async function adminRequest(path: string, data: unknown) { const r = await fetch(origin + path, { method: 'POST', headers: { origin, 'x-or3-admin-intent': 'admin', 'content-type': 'application/json', cookie: adminJar.cookie }, body: JSON.stringify(data) }); assert(r.ok, await r.text()); }
await adminRequest('/api/admin/workspace/members/upsert', { workspaceId, provider: 'basic-auth', emailOrProviderId: memberSession.session.providerUserId, role: 'viewer' });
await json('/api/workspaces/active', { id: workspaceId }, member);
const viewerSnapshot = await json('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, fileKindCapability: 'v1', workspaceItemCapability: 'v1' }, member);
assert(viewerSnapshot.items.some((r: any) => r.pk === id));
assert.equal((await request('/api/sync/push', body, member)).status, 403);
receipts.push('Viewer snapshot allowed; gateway writes denied');
await adminRequest('/api/admin/workspace/members/remove', { workspaceId, userId: memberSession.session.user.id });
assert.equal((await request('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, fileKindCapability: 'v1', workspaceItemCapability: 'v1' }, member)).status, 403);
assert.equal((await request('/api/storage/presign-download', { workspace_id: workspaceId, hash, storage_id: storageId, file_kind_capability: 'v1' }, member)).status, 403);
receipts.push('Membership loss denies snapshot and original download');
console.log(JSON.stringify({ origin, workspaceId, receipts }, null, 2));
const target = await json('/api/workspaces', { name: 'Isolated switch target' });
await json('/api/workspaces/active', { id: target.id });
assert.equal((await request('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, fileKindCapability: 'v1', workspaceItemCapability: 'v1' })).status, 403);
const targetSnapshot = await json('/api/sync/snapshot', { scope: { workspaceId: target.id }, pageSize: 100, fileKindCapability: 'v1', workspaceItemCapability: 'v1' });
assert(!JSON.stringify(targetSnapshot).includes('Saffron'));
await json('/api/workspaces/active', { id: workspaceId });
receipts.push('Active workspace switch rejects old scope and isolates snapshot');
await Bun.write(profileRoot + '/gateway-receipt.json', JSON.stringify({ origin, workspaceId, syncProvider: profile.syncProvider, storageProvider, receipts }, null, 2));
console.log(JSON.stringify({ checks: receipts.length, receipts }, null, 2));
