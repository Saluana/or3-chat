import { getActiveWorkspaceId, getDb } from '~/db/client';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import type { useSessionContext } from '~/composables/auth/useSessionContext';
import { createGatewayWorkspaceApi } from '~/core/workspace/gateway-workspace-api';
import { createGatewaySyncProvider } from '~/core/sync/providers/gateway-sync-provider';
import { generateHLC, getDeviceId } from '~/core/sync/hlc';
import { getStorageTransferQueue } from '~/core/storage/transfer-queue';
import { getActiveStorageProvider } from '~/core/storage/provider-registry';
import { FileMetaSchema, type FileMeta } from '~/db/schema';
import { createRuntimeUuid } from '~~/shared/runtime-id';
import { ARCHIVE_TABLES, CloudBackupError, createCloudBackupStreamCheck, readCloudBackupRows, scanCloudBackup } from '~~/shared/storage/workspace-archive';
import type { PendingOp } from '~~/shared/sync/types';
import { normalizeError } from '~~/shared/errors';
import { loadFilePolicy } from '~/core/storage/file-policy';
import { ADMIN_HEADERS } from '~/composables/admin/useAdminExtensions';

type BackupWriter = { write(chunk: Uint8Array<ArrayBuffer>): Promise<unknown>; close(): Promise<unknown>; abort(reason?: unknown): Promise<unknown> };

async function retryRateLimit<T>(operation: () => Promise<T>, assertCurrent: () => void): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        assertCurrent();
        try { return await operation(); }
        catch (error) {
            const metadata = normalizeError(error);
            if (metadata.status !== 429 || attempt >= 4) throw error;
            const deadline = Date.now() + Math.max(1_000, metadata.retryAfterMs ?? 60_000);
            while (Date.now() < deadline) { assertCurrent(); await new Promise(resolve => setTimeout(resolve, Math.min(250, deadline - Date.now()))); }
        }
    }
}

function captureOrigin() {
    const session = getCachedSessionContext();
    const workspaceId = session?.workspace?.id;
    const subject = session?.user?.id;
    const db = getDb();
    if (!session?.authenticated || !workspaceId || !subject || getActiveWorkspaceId() !== workspaceId) throw new CloudBackupError('Cloud workspace is not ready.');
    return { workspaceId, subject, db, assertCurrent() {
        const current = getCachedSessionContext();
        if (!current?.authenticated || current.user?.id !== subject || current.workspace?.id !== workspaceId || getDb() !== db || getActiveWorkspaceId() !== workspaceId) {
            throw new CloudBackupError('Account or workspace changed during backup. Please retry.');
        }
    } };
}

function writeFailed(cause: unknown): never {
    // A cancelled download stays a cancellation, not a failure.
    if ((cause as { name?: unknown } | null)?.name === 'AbortError') throw cause;
    throw new CloudBackupError('The backup file could not be saved. Delete the incomplete file, check free disk space, and export again.', { cause });
}

/** Only canonical, fully uploaded data can be represented by a Cloud snapshot. */
export async function exportCloudWorkspace(writer: BackupWriter): Promise<void> {
    const origin = captureOrigin();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const check = createCloudBackupStreamCheck();
    try {
        const deadline = Date.now() + 30_000;
        for (;;) {
            origin.assertCurrent();
            const [ops, uploads] = await Promise.all([
                origin.db.pending_ops.filter(op => op.status !== 'applied' && op.status !== 'discarded').count(),
                origin.db.file_transfers.filter(transfer => transfer.direction === 'upload' && transfer.state !== 'done').count(),
            ]);
            if (!ops && !uploads && !getStorageTransferQueue()?.hasDirectUploads()) break;
            if (Date.now() >= deadline) throw new CloudBackupError('Backup is waiting for sync or uploads. Resolve unfinished transfers and retry; local originals have been kept.');
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        origin.assertCurrent();
        const response = await fetch(`/api/workspaces/backup?workspaceId=${encodeURIComponent(origin.workspaceId)}`, { cache: 'no-store' });
        if (!response.ok || !response.body) throw new CloudBackupError('Cloud backup could not start. Check sync and storage availability.');
        reader = response.body.getReader();
        for (;;) {
            origin.assertCurrent();
            const { done, value } = await reader.read();
            origin.assertCurrent();
            if (done) break;
            check.write(value);
            await writer.write(value.slice()).catch(writeFailed);
        }
        check.finish();
        await writer.close().catch(writeFailed);
    } catch (error) { await writer.abort(error).catch(() => {}); throw error; }
    finally { await reader?.cancel().catch(() => {}); }
}

/** Validate first, then restore through existing authorized upload and sync contracts. */
export async function restoreCloudWorkspace(file: Blob, session: ReturnType<typeof useSessionContext>, onProgress: (value: number) => void): Promise<void> {
    const origin = captureOrigin();
    const originals: Array<{ hash: string; body: Blob }> = [];
    const metadata = new Map<string, FileMeta>();
    let rowCount = 0;
    const meta = await scanCloudBackup(file, async frame => {
        origin.assertCurrent();
        if (frame.header.type === 'row') {
            rowCount++;
            if (frame.header.table === 'file_meta') {
                const row = FileMetaSchema.parse(frame.row);
                metadata.set(row.hash, row);
            }
        } else if (frame.header.type === 'file') originals.push({ hash: frame.header.hash, body: frame.body });
    });
    origin.assertCurrent();
    const largestFile = originals.reduce((largest, original) => Math.max(largest, original.body.size), 0);
    if (largestFile > 1024 * 1024 * 1024) throw new CloudBackupError('A backup original exceeds the supported 1 GiB Cloud upload limit. No workspace was created.');
    const api = createGatewayWorkspaceApi();
    const name = `${meta.workspaceName.replace(/(?: \(restored\))+$/, '').slice(0, 75)} (restored)`;
    const target = await api.create({ name: `${name} — incomplete`, description: 'Restoring a Cloud workspace backup.' });
    origin.assertCurrent();
    let switched = false;
    try {
        await api.setActive({ id: target.id });
        switched = true;
        await session.refresh();
        const deadline = Date.now() + 10_000;
        while (getActiveWorkspaceId() !== target.id || (originals.length > 0 && getStorageTransferQueue()?.getWorkspaceId() !== target.id)) {
            if (Date.now() >= deadline) throw new CloudBackupError('Restored workspace is not ready.');
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        const destination = captureOrigin();
        if (destination.subject !== origin.subject || destination.workspaceId !== target.id) throw new CloudBackupError('Account changed during restore.');
        const queue = getStorageTransferQueue();
        const provider = getActiveStorageProvider();
        if (originals.length > 0 && (!queue || !provider?.commitUpload)) throw new CloudBackupError('Verified Cloud uploads are unavailable.');
        const policy = originals.length ? await loadFilePolicy(target.id) : null;
        destination.assertCurrent();
        if (policy && largestFile > policy.maxUploadBytes) {
            // The restoring user owns this new workspace. Admit its verified originals.
            await $fetch('/api/admin/workspace/file-policy', { method: 'POST', headers: ADMIN_HEADERS,
                body: { workspaceId: target.id, policy: { ...policy, maxUploadBytes: largestFile } } });
            destination.assertCurrent();
        }
        const rebound = new Map<string, FileMeta>();
        let completed = 0;
        for (const original of originals) {
            destination.assertCurrent();
            const row = metadata.get(original.hash)!;
            // The backup File is the durable source. Never stage its originals in IndexedDB.
            rebound.set(row.hash, await retryRateLimit(() => queue!.uploadDirect(row, original.body,
                { db: destination.db, workspaceId: target.id }, destination.assertCurrent), destination.assertCurrent));
            onProgress(Math.round(++completed / (originals.length + rowCount || 1) * 100));
        }
        const sync = createGatewaySyncProvider();
        // Native upload commits already authored metadata in the destination.
        // Restore must advance those revisions, never reset their clocks.
        const clocks = new Map<string, number>();
        let pageToken: string | undefined;
        do {
            destination.assertCurrent();
            const page = await retryRateLimit(() => sync.snapshot!({ scope: { workspaceId: target.id },
                tables: [...ARCHIVE_TABLES], pageSize: 200, pageToken }), destination.assertCurrent);
            destination.assertCurrent();
            for (const item of page.items) clocks.set(`${item.tableName}:${item.pk}`, item.revision.clock + 1);
            pageToken = page.nextPageToken ?? undefined;
        } while (pageToken);
        let ops: PendingOp[] = [];
        let bytes = 0;
        const flush = async () => {
            if (!ops.length) return;
            destination.assertCurrent();
            const result = await retryRateLimit(() => sync.push({ scope: { workspaceId: target.id }, ops }), destination.assertCurrent);
            destination.assertCurrent();
            if (result.results.some(item => !item.success || item.applied !== true)) throw new CloudBackupError('Some restored records were not applied.');
            completed += ops.filter(op => op.operation === 'put').length; ops = []; bytes = 0;
            onProgress(Math.round(completed / (originals.length + rowCount || 1) * 100));
        };
        const enqueue = async (op: PendingOp) => {
            const size = new TextEncoder().encode(JSON.stringify(op)).length;
            if (size > 256 * 1024) throw new CloudBackupError('A restored record exceeds the sync record limit.');
            if (ops.length >= 50 || bytes + size > 1024 * 1024) await flush();
            ops.push(op); bytes += size;
        };
        for await (const { table, row } of readCloudBackupRows(file)) {
            destination.assertCurrent();
            const pk = String(table === 'file_meta' ? row.hash : row.id);
            const clock = clocks.get(`${table}:${pk}`) ?? 1;
            const payload = { ...(table === 'file_meta' ? rebound.get(pk)! : row), clock, deleted: false } as Record<string, unknown>;
            // Identity belongs to the new workspace; transport revisions never come from backup.
            delete payload.hlc; delete payload.op_id; delete payload.server_version;
            delete payload.workspace_id;
            if (table === 'notifications') payload.user_id = destination.subject;
            const opId = createRuntimeUuid();
            const op: PendingOp = { id: opId, tableName: table, operation: 'put', pk,
                payload, stamp: { deviceId: getDeviceId(), opId, clock, hlc: generateHLC() }, createdAt: Date.now(), attempts: 0, status: 'pending' };
            await enqueue(op);
            if (row.deleted === true) {
                // Preserve the full metadata, then soft-delete it through the
                // sync protocol. A deleted flag on a put is not a portable delete.
                const deleteId = createRuntimeUuid();
                await enqueue({ ...op, id: deleteId, operation: 'delete', payload: undefined,
                    stamp: { ...op.stamp, opId: deleteId, clock: clock + 1, hlc: generateHLC() } });
            }
        }
        await flush();
        destination.assertCurrent();
        await api.update({ id: target.id, name, description: 'Restored from a verified Cloud backup.' });
        await session.refresh();
        onProgress(100);
    } catch (error) {
        // Preserve both workspaces. Do not redirect a user who deliberately switched accounts/workspaces.
        const current = getCachedSessionContext();
        if (switched && current?.user?.id === origin.subject && current.workspace?.id === target.id) {
            await api.setActive({ id: origin.workspaceId }).then(() => session.refresh()).catch(() => {});
        }
        const reason = error instanceof CloudBackupError ? ` ${error.message}` : '';
        throw new CloudBackupError(`Restore did not finish. Your source and backup are safe; workspace "${name} — incomplete" was kept.${reason}`, { cause: error });
    }
}
