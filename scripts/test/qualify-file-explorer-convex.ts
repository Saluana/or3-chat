import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { explorerPlacementId, type ExplorerItemRef } from '../../shared/explorer/records';

const root = resolve(process.argv[2] ?? '');
if (!root.startsWith(join(tmpdir(), 'or3-files-convex-'))) throw new Error('Requires a disposable Convex sandbox.');
const config = await Bun.file(join(root, 'sandbox.json')).json();
if (config.root !== root || new URL(config.url).hostname !== '127.0.0.1') throw new Error('Loopback sandbox only.');
const identity = 'explorer-' + crypto.randomUUID();
const admin = new ConvexHttpClient(config.url);
admin.setAdminAuth(config.adminKey, { issuer: 'https://clerk.or3.ai', subject: identity, or3_server: true });
const initial = crypto.randomUUID();
const initialized = await admin.mutation(anyApi.syncHistory.initialize, { incarnation: initial });
if (!initialized.ready && initialized.attemptId === initial) {
    await admin.mutation(anyApi.syncHistory.finishReplacement, { attempt_id: initial });
}
const enrollment = { provider: 'clerk', provider_user_id: identity };
await admin.mutation(anyApi.workspaces.ensure, enrollment);
const key = await crypto.subtle.importKey('jwk', await Bun.file(join(root, 'signing-key.json')).json(),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const message = b64({ alg: 'RS256', kid: 'sandbox', typ: 'JWT' }) + '.' + b64({
    iss: 'https://sandbox.or3.test/auth/clerk', aud: 'convex', sub: identity,
    exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000),
});
const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(message));
function createDevice() {
    const client = new ConvexHttpClient(config.url);
    client.setAuth(message + '.' + Buffer.from(signature).toString('base64url'));
    return client;
}
const left = createDevice(), right = createDevice();
const { id: workspace_id } = await left.mutation(anyApi.workspaces.ensure, enrollment);
const history_incarnation = await left.query(anyApi.sync.getHistoryIncarnation, { workspace_id });
const protocols = { workspace_id, history_incarnation, history_incarnation_capability: 'incarnation-v1',
    unavailable_record_capability: 'unavailable-v1' };
const scope = { kind: 'files' } as const;
const folderA = 'explorer-folder-' + crypto.randomUUID();
const folderB = 'explorer-folder-' + crypto.randomUUID();
function operation(id: string, content: object, clock: number, device: string,
    action: 'put' | 'delete' = 'put') {
    const name = 'or3.explorer/' + encodeURIComponent('["files"]') + '/' + id;
    return { op_id: crypto.randomUUID(), table_name: 'kv', pk: 'kv:' + name, operation: 'put',
        clock, hlc: `1700000000000:${clock}:${device}`, device_id: device,
        payload: { id: 'kv:' + name, name, clock, created_at: 1, updated_at: 1, deleted: false,
            value: JSON.stringify([JSON.stringify({ version: 1, scope, ...content }), action === 'delete']) },
    };
}
const A = operation(folderA, { parent_id: null, name: 'A' }, 1, 'left');
const B = operation(folderB, { parent_id: null, name: 'B' }, 1, 'right');
const first = await left.mutation(anyApi.sync.push, { ...protocols, ops: [A, B] });
assert(first.results.every((row: { success: boolean }) => row.success));
const initialSnapshot = await right.mutation(anyApi.sync.snapshot, { ...protocols, page_size: 100 });
assert.equal(initialSnapshot.highWatermark, first.serverVersion);
const movingA = operation(folderA, { parent_id: folderB, name: 'A' }, 2, 'left');
const movingB = operation(folderB, { parent_id: folderA, name: 'B' }, 2, 'right');
for (const [device, op] of [[left, movingA], [right, movingB]] as const) {
    const receipt = await device.mutation(anyApi.sync.push, { ...protocols, ops: [op] });
    assert(receipt.results[0].success, JSON.stringify(receipt));
}
const opposite = await left.mutation(anyApi.sync.pullChecked, { ...protocols, cursor: first.serverVersion, limit: 100 });
assert.deepEqual(opposite.changes.map((row: { pk: string }) => row.pk), [A.pk, B.pk]);
const wake = await admin.query(anyApi.sync.watchChanges, { ...protocols, cursor: first.serverVersion, limit: 100 });
assert.equal(wake.version, opposite.nextCursor);
const remove = operation(folderB, { parent_id: folderA, name: 'B' }, 3, 'right', 'delete');
const item: ExplorerItemRef = { kind: 'document', item_id: 'existing-document' };
const placement = await explorerPlacementId(scope, item);
const late = operation(placement, { parent_id: folderB, item }, 3, 'left');
for (const op of [remove, late]) {
    const receipt = await left.mutation(anyApi.sync.push, { ...protocols, ops: [op] });
    assert(receipt.results[0].success, JSON.stringify(receipt));
}
const oldEdit = { ...operation(item.item_id, {}, 2, 'right'), table_name: 'posts', pk: item.item_id,
    payload: { id: item.item_id, post_type: 'doc', title: 'Renamed by older client', content: '{}',
        clock: 2, created_at: 1, updated_at: 2, deleted: false } };
const editReceipt = await right.mutation(anyApi.sync.push, { ...protocols, ops: [oldEdit] });
assert(editReceipt.results[0].success, JSON.stringify(editReceipt));
const restored = await right.mutation(anyApi.sync.snapshot, { ...protocols, page_size: 100 });
assert(restored.items.some((row: { pk: string; payload?: { title?: string } }) =>
    row.pk === item.item_id && row.payload?.title === oldEdit.payload.title));
assert(restored.items.some((row: { pk: string; kind: string; payload?: { value?: string } }) =>
    row.pk === B.pk && row.kind === 'row' && row.payload?.value === remove.payload.value));
assert(restored.items.some((row: { pk: string; kind: string }) => row.pk === late.pk && row.kind === 'row'));
const receipt = {
    provider: config.provider.version, transport: 'direct',
    checks: ['ordinary KV sync', 'new-device snapshot', 'opposite moves',
        'watch wakeup', 'late placement after parent removal', 'retained tombstone'],
};
await Bun.write(join(root, 'explorer-receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
