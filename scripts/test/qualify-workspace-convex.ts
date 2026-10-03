import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import assert from 'node:assert/strict';
const sandboxRoot = process.argv[2];
if (!sandboxRoot?.startsWith('/private/tmp/or3-files-convex-'))
    throw Error('Requires a disposable Convex sandbox');
const config = await Bun.file(sandboxRoot + '/sandbox.json').json();
if (new URL(config.url).hostname !== '127.0.0.1')
    throw Error('Loopback sandbox only');
const privateKey = await crypto.subtle.importKey('jwk', await Bun.file(sandboxRoot + '/signing-key.json').json(), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
const base = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
async function client(subject: string) { const header = base({ alg: 'RS256', kid: 'sandbox', typ: 'JWT' }); const body = base({ iss: 'https://sandbox.or3.test/auth/clerk', aud: 'convex', sub: subject, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), email: subject + '@example.test' }); const message = header + '.' + body; const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(message)); const c = new ConvexHttpClient(config.url); c.setAuth(message + '.' + Buffer.from(signature).toString('base64url')); return c; }
const c = await client('direct-owner-' + crypto.randomUUID());
const workspace = await c.mutation(anyApi.workspaces.ensure, { provider: 'clerk', provider_user_id: (await c.query(anyApi.users.me, {})).tokenIdentifier.split('|').at(-1) });
const workspace_id = workspace.id;
const receipts: string[] = ['JWT authenticated direct workspace provision'];
let clock = 1;
function op(table_name: string, pk: string, payload: unknown) { return { op_id: crypto.randomUUID(), table_name, operation: 'put', pk, payload, clock: clock++, hlc: Date.now() + ':0:local-direct', device_id: 'local-direct' }; }
const metadata = { 'plugin-key': 'preserved', 'or3.workspace-item': { version: 1, trashed_at: null, text: { coverage: 'full', indexed_bytes: 7 } } };
const post = { id: 'live-catalog', title: 'Live catalog', post_type: 'or3:file', content: 'Saffron', file_hashes: '["shared-hash"]', meta: JSON.stringify(metadata), deleted: false, created_at: 1, updated_at: 1, clock: 1 };
const ops = [op('posts', post.id, post), op('projects', 'live-project', { id: 'live-project', name: 'Live project', data: [{ kind: 'file', id: post.id, extension_key: 'retained' }, { kind: 'plugin', id: 'opaque', extension_key: 7 }], deleted: false, created_at: 1, updated_at: 1, clock: 1 })];
const pushed = await c.mutation(anyApi.sync.push, { workspace_id, workspace_item_capability: 'v1', ops });
assert(pushed.results.every((r: any) => r.success), JSON.stringify(pushed));
receipts.push('Direct catalog and project push');
const replay = await c.mutation(anyApi.sync.push, { workspace_id, workspace_item_capability: 'v1', ops });
assert.equal(replay.serverVersion, pushed.serverVersion);
receipts.push('Same-operation retry retains one server version');
const pull = await c.query(anyApi.sync.pull, { workspace_id, workspace_item_capability: 'v1', cursor: 0, limit: 100 });
assert.equal(pull.changes.find((r: any) => r.pk === post.id).payload.content, 'Saffron');
receipts.push('Pull preserves catalog text');
const snapshot = await c.mutation(anyApi.sync.snapshot, { workspace_id, workspace_item_capability: 'v1', page_size: 100, tables: ['posts', 'projects'] });
assert.equal(snapshot.items.find((r: any) => r.pk === post.id).payload.meta, post.meta);
assert.equal(snapshot.items.find((r: any) => r.pk === 'live-project').payload.data[0].extension_key, 'retained');
receipts.push('Materialized snapshot preserves namespaced metadata and extension memberships');
await assert.rejects(c.query(anyApi.sync.pull, { workspace_id, cursor: 0, limit: 100 }), /OR3_WORKSPACE_ITEM_UPDATE_REQUIRED/);
await assert.rejects(c.mutation(anyApi.sync.snapshot, { workspace_id, page_size: 100, tables: ['posts'] }), /OR3_WORKSPACE_ITEM_UPDATE_REQUIRED/);
receipts.push('Old direct readers rejected');
await assert.rejects(c.mutation(anyApi.sync.push, { workspace_id, ops: [op('posts', post.id, { ...post, post_type: 'doc', meta: '' })] }), /OR3_WORKSPACE_ITEM_UPDATE_REQUIRED/);
await assert.rejects(c.mutation(anyApi.sync.push, { workspace_id, ops: [op('projects', 'live-project', { id: 'live-project', name: 'Old writer', data: [], deleted: false, created_at: 1, updated_at: 2, clock: 2 })] }), /OR3_WORKSPACE_ITEM_UPDATE_REQUIRED/);
receipts.push('Old direct writers cannot erase catalog or membership semantics');
const stranger = await client('stranger');
await stranger.mutation(anyApi.workspaces.ensure, { provider: 'clerk', provider_user_id: 'stranger' });
await assert.rejects(stranger.query(anyApi.sync.pull, { workspace_id, workspace_item_capability: 'v1', cursor: 0, limit: 100 }), /Forbidden/);
receipts.push('Other workspace subject denied');
const admin = new ConvexHttpClient(config.url);
(admin as any).setAdminAuth(config.adminKey, { issuer: 'or3-admin', subject: 'sandbox-admin' });
await admin.mutation(anyApi.admin.upsertWorkspaceMember, { workspace_id, email_or_provider_id: 'stranger', provider: 'clerk', role: 'viewer' });
await assert.rejects(stranger.mutation(anyApi.sync.push, { workspace_id, workspace_item_capability: 'v1', ops: [op('posts', 'viewer-write', post)] }), /Forbidden/);
await assert.rejects(stranger.mutation(anyApi.storage.generateUploadUrl, { workspace_id, hash: 'a'.repeat(64), mime_type: 'text/plain', size_bytes: 1 }), /Forbidden/);
receipts.push('Viewer cannot reserve upload or mutate catalog');
const bytes = new TextEncoder().encode('Original Saffron bytes');
const digest = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
const hash = 'sha256:' + digest;
const upload = await c.mutation(anyApi.storage.generateUploadUrl, { workspace_id, hash, mime_type: 'text/plain', size_bytes: bytes.length });
const uploaded = await fetch(upload.uploadUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: bytes });
assert(uploaded.ok);
const { storageId } = await uploaded.json();
await c.mutation(anyApi.storage.commitUpload, { workspace_id, intent_id: upload.intentId, hash, storage_id: storageId, storage_provider_id: 'convex', mime_type: 'text/plain', size_bytes: bytes.length, name: 'original.txt', kind: 'file' });
const retained = { ...post, id: 'physical-catalog', file_hashes: JSON.stringify([hash]), meta: JSON.stringify({ ...metadata, 'or3.workspace-item': { version: 1, trashed_at: 1, text: { coverage: 'full', indexed_bytes: bytes.length } } }) };
assert((await c.mutation(anyApi.sync.push, { workspace_id, workspace_item_capability: 'v1', ops: [op('posts', retained.id, retained)] })).results.every((r: any) => r.success));
await assert.rejects(c.mutation(anyApi.storage.deleteObject, { workspace_id, hash, storage_id: storageId }), /Cannot delete a referenced file/);
await c.mutation(anyApi.storage.gcDeletedFiles, { workspace_id, retention_seconds: 0, limit: 10 });
const original = await c.query(anyApi.storage.getFileUrl, { workspace_id, hash });
assert(original?.url);
assert.deepEqual(new Uint8Array(await (await fetch(original.url)).arrayBuffer()), bytes);
receipts.push('Physical original survives trashed catalog, deletion and GC');
const viewerOriginal = await stranger.query(anyApi.storage.getFileUrl, { workspace_id, hash });
assert(viewerOriginal?.url);
receipts.push('Viewer retains authorized original read access');
await admin.mutation(anyApi.admin.removeWorkspaceMember, { workspace_id, user_id: (await stranger.mutation(anyApi.workspaces.ensure, { provider: 'clerk', provider_user_id: 'stranger' })).user_id });
await assert.rejects(stranger.query(anyApi.storage.getFileUrl, { workspace_id, hash }), /Forbidden/);
receipts.push('Revoked subject cannot download');
// Real deployed auxiliary stores: public callers cannot reach internal
// persistence even with an authenticated subject. Server admin calls below
// exercise stored jobs and fencing without a paid model request.
await assert.rejects(c.mutation(anyApi.backgroundJobs.create, { user_id: workspace.user_id, thread_id: 'broad-thread', message_id: 'broad-message', model: 'synthetic', max_concurrent_jobs: 4, max_concurrent_jobs_per_user: 2 }), /internal|public|Could not find/i);
const internalAdmin = new ConvexHttpClient(config.url);
(internalAdmin as any).setAdminAuth(config.adminKey);
const jobInput = { user_id: workspace.user_id, thread_id: 'broad-thread', message_id: 'broad-message', model: 'synthetic', execution: { version: 1 }, idempotency_key: crypto.randomUUID(), max_concurrent_jobs: 4, max_concurrent_jobs_per_user: 2 };
const createdJob = await internalAdmin.mutation(anyApi.backgroundJobs.create, jobInput);
const job = typeof createdJob === 'string' ? createdJob : createdJob.jobId;
assert.equal(await internalAdmin.mutation(anyApi.backgroundJobs.create, jobInput), job);
const claimed = await internalAdmin.mutation(anyApi.backgroundJobs.claim, { job_id: job, lease_owner: 'worker-a', lease_ms: 60000 });
assert(claimed);
assert.equal(await internalAdmin.mutation(anyApi.backgroundJobs.claim, { job_id: job, lease_owner: 'worker-b', lease_ms: 60000 }), null);
assert.equal(await internalAdmin.mutation(anyApi.backgroundJobs.update, { job_id: job, lease_owner: 'worker-b', content_chunk: 'wrong' }), false);
assert.equal(await internalAdmin.mutation(anyApi.backgroundJobs.update, { job_id: job, lease_owner: 'worker-a', content_chunk: 'Stored synthetic completion', chunks_received: 1 }), true);
assert.equal(await internalAdmin.query(anyApi.backgroundJobs.get, { job_id: job, user_id: 'wrong-owner' }), null);
assert.equal(await internalAdmin.mutation(anyApi.backgroundJobs.complete, { job_id: job, lease_owner: 'worker-a', content: 'Stored synthetic completion' }), true);
assert.equal((await internalAdmin.query(anyApi.backgroundJobs.get, { job_id: job, user_id: workspace.user_id })).status, 'complete');
receipts.push('Background job persistence, retry, lease fencing, ownership and completion');
const rateArgs = { key: 'sandbox-rate-' + crypto.randomUUID(), maxRequests: 1, windowMs: 60000 };
assert.equal((await internalAdmin.mutation(anyApi.rateLimits.checkAndRecord, rateArgs)).allowed, true);
assert.equal((await internalAdmin.mutation(anyApi.rateLimits.checkAndRecord, rateArgs)).allowed, false);
receipts.push('Atomic persistent rate limit');
const notification = await internalAdmin.mutation(anyApi.notifications.create, { workspace_id, user_id: workspace.user_id, type: 'system', title: 'Sandbox notification' });
assert(notification);
const notices = await internalAdmin.query(anyApi.notifications.getByUser, { workspace_id, user_id: workspace.user_id, limit: 10 });
assert(notices.some((n: any) => n.title === 'Sandbox notification'));
receipts.push('Notification persistence');
// Exercise the deployed wire schema for the ordinary app records as well.
const common = { created_at: 1, updated_at: 1, clock: 1, deleted: false };
const native = [
    ['threads', 'native-thread', { ...common, id: 'native-thread', title: 'Synthetic native chat', status: 'active', pinned: false, forked: false }],
    ['messages', 'native-message', { ...common, id: 'native-message', thread_id: 'native-thread', role: 'user', index: 0, order_key: '1:0:direct', data: { type: 'text', content: 'Native message marker' }, file_hashes: JSON.stringify([hash]) }],
    ['posts', 'native-document', { ...common, id: 'native-document', title: 'Synthetic native document', post_type: 'doc', content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Native document marker' }] }] }), file_hashes: JSON.stringify([hash]) }],
    ['kv', 'native-preference', { ...common, id: 'native-preference', name: 'sandbox-pref', value: 'Native preference marker' }],
    ['notifications', 'native-notice', { ...common, id: 'native-notice', user_id: workspace.user_id, type: 'system', title: 'Native notification marker' }],
] as const;
const nativePush = await c.mutation(anyApi.sync.push, { workspace_id, workspace_item_capability: 'v1', ops: native.map(([table, pk, payload]) => op(table, pk, payload)) });
assert(nativePush.results.every((result: any) => result.success), JSON.stringify(nativePush));
const nativeSnapshot = await c.mutation(anyApi.sync.snapshot, { workspace_id, workspace_item_capability: 'v1', page_size: 100 });
for (const [table, pk, payload] of native) {
    const row = nativeSnapshot.items.find((item: any) => item.tableName === table && item.pk === pk);
    assert(row, table + ' materialized');
    assert(row.payload.clock >= payload.clock);
    for (const [key, value] of Object.entries(payload))
        if (key !== 'clock')
            assert.deepEqual(row.payload[key], value, table + '.' + key);
}
receipts.push('Ordinary chats, ordered messages, native documents, preferences and notifications round-trip through deployed sync');
const server = new ConvexHttpClient(config.url);
(server as any).setAdminAuth(config.adminKey, { issuer: 'https://or3.ai/auth/basic-auth', subject: 'sandbox-host', or3_server: true });
const setting = { workspace_id, key: 'sandbox-private-setting' };
await server.mutation(anyApi.hostSettings.setHostSetting, { ...setting, value: 'first' });
assert.equal(await server.query(anyApi.hostSettings.getHostSetting, setting), 'first');
assert.equal(await server.mutation(anyApi.hostSettings.compareAndSetHostSetting, { ...setting, expected_value: 'first', value: 'winner' }), true);
assert.equal(await server.mutation(anyApi.hostSettings.compareAndSetHostSetting, { ...setting, expected_value: 'first', value: 'stale' }), false);
await assert.rejects(c.query(anyApi.hostSettings.getHostSetting, setting), /internal|public|Could not find/i);
assert(!JSON.stringify(nativeSnapshot).includes('sandbox-private-setting'));
receipts.push('Private host settings persist, reject stale CAS and stay outside client sync');
// Real deployed transactions must serialize reference admission with physical deletion.
assert.deepEqual(await c.query(anyApi.storage.deletionCapability, { workspace_id }), { version: 1 });
for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = new TextEncoder().encode('Deletion race ' + crypto.randomUUID());
    const hash = 'sha256:' + Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
    const upload = await c.mutation(anyApi.storage.generateUploadUrl, { workspace_id, hash, mime_type: 'text/plain', size_bytes: bytes.length });
    const response = await fetch(upload.uploadUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: bytes });
    assert(response.ok); const { storageId } = await response.json();
    const commit = (id: string, intent: string) => c.mutation(anyApi.storage.commitUpload, { workspace_id, intent_id: intent, hash, storage_id: id, storage_provider_id: 'convex', mime_type: 'text/plain', size_bytes: bytes.length, name: 'race.txt', kind: 'file' });
    await commit(storageId, upload.intentId);
    const originalUrl = (await c.query(anyApi.storage.getFileUrl, { workspace_id, hash }))?.url;
    assert(originalUrl);
    clock = 2_000_000_000 + attempt * 100;
    const metadata = { hash, name: 'race.txt', mime_type: 'text/plain', size_bytes: bytes.length, kind: 'file', storage_id: storageId, storage_provider_id: 'convex', ref_count: 0, deleted: true, created_at: 1, updated_at: 1 };
    const retired = await c.mutation(anyApi.sync.push, { workspace_id, workspace_item_capability: 'v1', ops: [op('file_meta', hash, metadata)] });
    assert(retired.results.every((result: any) => result.success), JSON.stringify(retired));
    const row = { ...post, id: 'race-reference-' + attempt, file_hashes: JSON.stringify([hash]) };
    const [admitted, deleted] = await Promise.allSettled([
        c.mutation(anyApi.sync.push, { workspace_id, workspace_item_capability: 'v1', ops: [op('posts', row.id, row)] }),
        c.mutation(anyApi.storage.deleteObject, { workspace_id, hash, storage_id: storageId }),
    ]);
    const referenceWon = admitted.status === 'fulfilled' && admitted.value.results.every((result: any) => result.success);
    if (referenceWon) {
        assert.equal(deleted.status, 'rejected');
        const original = await fetch(originalUrl);
        assert(original.ok); assert.deepEqual(new Uint8Array(await original.arrayBuffer()), bytes);
        assert((await c.mutation(anyApi.sync.push, { workspace_id, workspace_item_capability: 'v1', ops: [op('posts', row.id, { ...row, deleted: true })] })).results.every((result: any) => result.success));
        await c.mutation(anyApi.storage.deleteObject, { workspace_id, hash, storage_id: storageId });
    } else {
        assert.equal(deleted.status, 'fulfilled'); assert(deleted.value.deleted);
    }
    const stale = await c.mutation(anyApi.sync.push, { workspace_id, workspace_item_capability: 'v1', ops: [op('posts', row.id, row), op('file_meta', hash, { ...metadata, deleted: false })] });
    assert(stale.results.every((result: any) => !result.success), JSON.stringify(stale));
    const replacement = await c.mutation(anyApi.storage.generateUploadUrl, { workspace_id, hash, mime_type: 'text/plain', size_bytes: bytes.length });
    const replaced = await fetch(replacement.uploadUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: bytes });
    assert(replaced.ok); const replacementId = (await replaced.json()).storageId;
    await commit(replacementId, replacement.intentId);
    const obsolete = await c.mutation(anyApi.sync.push, { workspace_id, workspace_item_capability: 'v1', ops: [op('file_meta', hash, { ...metadata, deleted: false })] });
    assert(obsolete.results.every((result: any) => !result.success), JSON.stringify(obsolete));
    const restored = await c.mutation(anyApi.sync.push, { workspace_id, workspace_item_capability: 'v1', ops: [op('posts', row.id, row)] });
    assert(restored.results.every((result: any) => result.success), JSON.stringify(restored));
}
receipts.push('Five concurrent reference/deletion transactions preserve originals or reject references; stale restores and storage IDs fail; verified re-upload releases claims');
await Bun.write(sandboxRoot + '/direct-receipt.json', JSON.stringify({ backend: config.url, workspace_id, receipts }, null, 2));
console.log(JSON.stringify({ checks: receipts.length, receipts }, null, 2));
