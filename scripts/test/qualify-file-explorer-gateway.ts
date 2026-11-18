import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { explorerPlacementId } from '../../shared/explorer/records';
import { scanCloudBackup } from '../../shared/storage/workspace-archive';

const root = resolve(process.argv[2] ?? '');
if (!root.startsWith(join(tmpdir(), 'or3-workspace-cloud-e2e-'))) throw new Error('Requires a disposable gateway profile.');
const profile = await Bun.file(join(root, 'profile.json')).json();
const origin = profile.origin;
if (profile.root !== root || new URL(origin).hostname !== '127.0.0.1') throw new Error('Loopback gateway only.');
assert.equal(profile.storageProvider, 'fs', 'Use the disposable loopback file store for this qualification.');

function client() {
    const cookies = new Map<string, string>();
    return async (route: string, input?: unknown, upload?: { method: string; headers: Record<string, string>; body: Uint8Array<ArrayBuffer> }) => {
        const url = new URL(route, origin);
        assert.equal(url.origin, origin);
        const response = await fetch(url, {
            method: upload?.method ?? (input === undefined ? 'GET' : 'POST'),
            headers: { origin, 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation',
                cookie: [...cookies.values()].join('; '), ...upload?.headers },
            body: upload?.body ?? (input === undefined ? undefined : JSON.stringify(input)),
        });
        for (const raw of response.headers.getSetCookie()) {
            const cookie = raw.split(';')[0]!;
            cookies.set(cookie.split('=')[0]!, cookie);
        }
        return response;
    };
}
async function json(response: Response) {
    const result = await response.text();
    assert(response.ok, `${response.status} ${new URL(response.url).pathname}: ${result.slice(0, 600)}`);
    return JSON.parse(result);
}
const left = client();
const right = client();
const credentials = { email: 'workspace-e2e@example.test', password: 'DisposableWorkspaceE2e!123' };
for (const device of [left, right]) await json(await device('/api/basic-auth/sign-in', credentials));
const proofWorkspace = await json(await left('/api/workspaces', { name: 'Disposable Explorer qualification' }));
for (const device of [left, right]) await json(await device('/api/workspaces/active', { id: proofWorkspace.id }));
const session = await json(await left('/api/auth/session'));
assert(session.appAccessAllowed);

const scope = { workspaceId: session.session.workspace.id };
const protocols = { scope, fileKindCapability: 'v1', workspaceItemCapability: 'v1',
    historyIncarnationCapability: 'incarnation-v1', unavailableRecordCapability: 'unavailable-v1',
    storedRecordCapability: 'stored-record-v1' };
const initial = await json(await left('/api/sync/snapshot', { ...protocols,
    historyIncarnation: null, pageSize: 100 }));
const bound = { ...protocols, historyIncarnation: initial.historyIncarnation };
const a = 'explorer-folder-' + crypto.randomUUID();
const b = 'explorer-folder-' + crypto.randomUUID();
const files = { kind: 'files' } as const;
function op(id: string, data: object, clock: number, deviceId: string, operation = 'put') {
    const name = 'or3.explorer/' + encodeURIComponent('["files"]') + '/' + id;
    return { id: crypto.randomUUID(), tableName: 'kv', pk: 'kv:' + name, operation: 'put', attempts: 0, status: 'pending', createdAt: 1,
        stamp: { clock, opId: crypto.randomUUID(), deviceId, hlc: `1700000000000:${clock}:${deviceId}` },
        payload: { id: 'kv:' + name, name, clock, created_at: 1, updated_at: 1, deleted: false,
            value: JSON.stringify([JSON.stringify({ version: 1, scope: files, ...data }), operation === 'delete']) },
    };
}
const rootA = op(a, { parent_id: null, name: 'Gateway A' }, 1, 'left');
async function push(device: typeof left, ops: unknown[]) {
    const result = await json(await device('/api/sync/push', { ...bound, ops }));
    assert(result.results.every((row: { success: boolean }) => row.success), JSON.stringify(result));
    return result;
}
const rootB = op(b, { parent_id: null, name: 'Gateway B' }, 1, 'right');
const first = await push(left, [rootA, rootB]);
await push(left, [op(a, { parent_id: b, name: 'Gateway A' }, 2, 'left')]);
await push(right, [op(b, { parent_id: a, name: 'Gateway B' }, 2, 'right')]);
const opposite = await json(await right('/api/sync/pull', { ...bound, cursor: first.serverVersion, limit: 100 }));
assert.deepEqual(opposite.changes.map((row: { pk: string }) => row.pk), [rootA.pk, rootB.pk]);
await push(left, [op(a, { parent_id: null, name: 'Gateway A' }, 3, 'left')]);
const original = new TextEncoder().encode('Explorer qualification original ' + crypto.randomUUID());
const fileHash = 'sha256:' + Buffer.from(await crypto.subtle.digest('SHA-256', original)).toString('hex');
const mime = 'text/plain';
const makeUpload = { workspace_id: scope.workspaceId, hash: fileHash, mime_type: mime, size_bytes: original.byteLength };
const grant = await json(await left('/api/storage/presign-upload', { ...makeUpload, file_kind_capability: 'v1' }));
const stored = await left(grant.url, undefined, { method: grant.method ?? 'PUT',
    headers: { 'content-type': mime, ...grant.headers }, body: original });
assert(stored.ok, `Original upload returned ${stored.status}.`);
await json(await left('/api/storage/commit', { ...makeUpload, storage_id: grant.storageId, intent_id: grant.intentId,
    storage_provider_id: profile.storageProvider, name: 'explorer-proof.txt', kind: 'file', file_kind_capability: 'v1' }));
const file = 'explorer-proof-file-' + crypto.randomUUID();
const documentWrite = op(file, {}, 1, 'left');
const fileMeta = op(fileHash, {}, 1, 'left');
await push(left, [
    { ...fileMeta, pk: fileHash, tableName: 'file_meta', payload: {
        hash: fileHash, kind: 'file', mime_type: mime, size_bytes: original.byteLength, name: 'explorer-proof.txt',
        storage_id: grant.storageId, storage_provider_id: profile.storageProvider, clock: 1, created_at: 1, updated_at: 1, deleted: false,
    } },
    { ...documentWrite, tableName: 'posts', pk: file, payload: { id: file, clock: 1, created_at: 1, updated_at: 1, deleted: false, post_type: 'or3:file', title: 'Explorer proof original',
        file_hashes: JSON.stringify([fileHash]), content: new TextDecoder().decode(original),
        meta: JSON.stringify({ 'or3.workspace-item': { version: 1, trashed_at: null } }) } },
]);
for (const [id, payload, operation] of [[b, { parent_id: a, name: 'Gateway B' }, 'delete'],
    [await explorerPlacementId(files, { kind: 'file', item_id: file }),
        { parent_id: b, item: { kind: 'file', item_id: file } }, 'put']] as const) {
    await push(left, [op(id, payload, 3, 'left', operation)]);
}
// An older client only understands ordinary content and the existing KV table.
const renamed = { id: file, post_type: 'or3:file', title: 'Renamed by older client',
    file_hashes: JSON.stringify([fileHash]), content: new TextDecoder().decode(original),
    meta: JSON.stringify({ 'or3.workspace-item': { version: 1, trashed_at: null } }),
    clock: 2, created_at: 1, updated_at: 2, deleted: false };
const edit = op(file, {}, 2, 'right');
await push(right, [{ ...edit, tableName: 'posts', pk: file, payload: renamed }]);
const snapshot = await json(await right('/api/sync/snapshot', { ...bound, pageSize: 100 }));
assert(snapshot.items.some((row: { pk: string; payload?: { title?: string } }) =>
    row.pk === file && row.payload?.title === renamed.title));
assert(snapshot.items.some((row: { pk: string; kind: string; payload?: { deleted?: boolean } }) =>
    row.pk === rootB.pk && row.kind === 'row'));
const backup = await right('/api/workspaces/backup?workspaceId=' + encodeURIComponent(scope.workspaceId));
assert(backup.ok, `Backup returned ${backup.status}.`);
const archive = await backup.blob();
let foundDeletedFolder = false;
let foundOriginal = false;
await scanCloudBackup(archive, async ({ header, row, body }) => {
    if (header.type === 'file' && header.hash === fileHash) {
        assert.deepEqual(new Uint8Array(await body.arrayBuffer()), original);
        foundOriginal = true;
    }
    if (header.type === 'row' && header.table === 'kv' && row?.id === rootB.pk) {
        const [content, removed] = JSON.parse(String(row.value));
        assert.equal(removed, true);
        assert.equal(JSON.parse(content).parent_id, a);
        foundDeletedFolder = true;
    }
});
assert(foundDeletedFolder, 'Backup archive omitted the retained Explorer folder record');
assert(foundOriginal, 'Backup archive omitted the original placed file');
await Bun.write(join(root, 'explorer.or3cloud'), archive);
const receipt = { provider: profile.syncProvider, sourceWorkspace: scope.workspaceId, survivingFolder: a, removedFolder: b, file, fileHash,
    versions: profile.providers.map(({ name, version, mode }: Record<string, string>) => ({ name, version, mode })),
    checks: ['ordinary KV push/pull/snapshot', 'opposite moves', 'late placement', 'snapshot and backup'] };
await Bun.write(join(root, 'explorer-receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
