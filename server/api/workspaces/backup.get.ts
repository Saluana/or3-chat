import { createError, defineEventHandler, getHeader, getQuery, getRequestURL, sendStream, setResponseHeader } from 'h3';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { requireWorkspaceSession } from './_helpers';
import { requireStorageWorkspaceAccess } from '../../utils/storage/workspace-access';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';
import { getActiveStorageGatewayAdapter } from '../../storage/gateway/registry';
import { setNoCacheHeaders } from '../../utils/headers';
import { isSyncEnabled } from '../../utils/sync/is-sync-enabled';
import { enforceRateLimit } from '../../utils/rate-limit/enforce';
import { checkSyncRateLimit, recordSyncRequest } from '../../utils/sync/rate-limiter';
import { SnapshotResponseSchema, getSnapshotResponseContractError, TABLE_PAYLOAD_SCHEMAS } from '~~/shared/sync/schemas';
import { isLocalOnlyKvChange } from '~~/shared/sync/local-only-kv';
import { FILE_KIND_CAPABILITY } from '~~/shared/files/file-capability';
import { WORKSPACE_ITEM_CAPABILITY } from '~~/shared/posts/workspace-item-capability';
import { ARCHIVE_TABLES, CLOUD_BACKUP_MAGIC, MAX_ARCHIVE_ROW_BYTES, encodeCloudHeader, type CloudBackupHeader } from '~~/shared/storage/workspace-archive';
import type { SnapshotRequest } from '~~/shared/sync/types';

export default defineEventHandler(async event => {
    setNoCacheHeaders(event);
    if (!isSyncEnabled(event)) throw createError({ statusCode: 404 });
    const session = await requireWorkspaceSession(event);
    const requestedWorkspaceId = getQuery(event).workspaceId;
    if (typeof requestedWorkspaceId !== 'string' || requestedWorkspaceId !== session.workspace?.id) throw createError({ statusCode: 403 });
    const workspaceId: string = requestedWorkspaceId;
    await requireStorageWorkspaceAccess(event, session, workspaceId);
    enforceRateLimit(event, checkSyncRateLimit(session.user!.id, 'sync:snapshot'));
    recordSyncRequest(session.user!.id, 'sync:snapshot');
    const sync = getActiveSyncGatewayAdapter();
    const storage = getActiveStorageGatewayAdapter();
    if (!sync?.backupSnapshot || (storage?.id === 'convex' && !storage.readBackupFile)) {
        throw createError({ statusCode: 503, statusMessage: 'Update the Cloud provider and backend before exporting workspace backups' });
    }
    const directory = await mkdtemp(join(tmpdir(), 'or3-workspace-backup-'));
    const path = join(directory, 'records.jsonl');
    let rows = 0;
    const originals = new Set<string>();
    const references = new Set<string>();
    try {
        const file = await open(path, 'wx', 0o600);
        try {
            let pageToken: string | undefined;
            let snapshotId: string | undefined;
            let watermark: number | undefined;
            const tokens = new Set<string>();
            do {
                const request: SnapshotRequest = { scope: { workspaceId }, pageSize: 200, pageToken, tables: [...ARCHIVE_TABLES], fileKindCapability: FILE_KIND_CAPABILITY, workspaceItemCapability: WORKSPACE_ITEM_CAPABILITY };
                const page = SnapshotResponseSchema.parse(await sync.backupSnapshot!(event, request));
                if (getSnapshotResponseContractError(request, page)) throw new Error('Invalid snapshot page.');
                if (snapshotId && (snapshotId !== page.snapshotId || watermark !== page.highWatermark)) throw new Error('Backup snapshot changed while paging.');
                snapshotId = page.snapshotId; watermark = page.highWatermark;
                await requireStorageWorkspaceAccess(event, session, workspaceId);
                for (const item of page.items) {
                    if (item.kind !== 'row') continue;
                    const table = item.tableName as typeof ARCHIVE_TABLES[number];
                    if (!ARCHIVE_TABLES.includes(table)) throw new Error('Unexpected backup table.');
                    const row = TABLE_PAYLOAD_SCHEMAS[table]!.parse(item.payload) as Record<string, unknown>;
                    if (isLocalOnlyKvChange(table, item.pk, row)) continue;
                    if (Buffer.byteLength(JSON.stringify(row)) > MAX_ARCHIVE_ROW_BYTES) throw new Error('Backup record exceeds the supported size.');
                    if (table === 'file_meta') {
                        if (!storage || typeof row.storage_id !== 'string' || row.storage_provider_id !== storage.id || !/^(sha256:[a-f0-9]{64}|md5:[a-f0-9]{32})$/.test(String(row.hash))) throw new Error('An original is not committed to the active Cloud provider.');
                        originals.add(String(row.hash));
                    }
                    if ((table === 'messages' || table === 'posts') && typeof row.file_hashes === 'string') {
                        const hashes: unknown = JSON.parse(row.file_hashes);
                        if (!Array.isArray(hashes) || hashes.some(hash => typeof hash !== 'string')) throw new Error('Invalid backup attachment references.');
                        for (const hash of hashes as string[]) references.add(hash);
                    }
                    await file.write(JSON.stringify({ table, row }) + '\n'); rows++;
                }
                pageToken = page.nextPageToken ?? undefined;
                if (pageToken && tokens.has(pageToken)) throw new Error('Repeated backup snapshot page.');
                if (pageToken) tokens.add(pageToken);
            } while (pageToken);
            if ([...references].some(hash => !originals.has(hash))) throw new Error('A referenced original is missing from the Cloud snapshot.');
        } finally { await file.close(); }
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }

    async function* stream() {
        const digest = createHash('sha256');
        const header = (value: CloudBackupHeader) => { const bytes = encodeCloudHeader(value); digest.update(bytes); return bytes; };
        let files = 0;
        try {
            yield new TextEncoder().encode(CLOUD_BACKUP_MAGIC);
            yield header({ type: 'meta', version: 1, size: 0, workspaceName: session.workspace!.name });
            for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
                const record = JSON.parse(line) as { table: typeof ARCHIVE_TABLES[number]; row: Record<string, unknown> };
                const body = new TextEncoder().encode(JSON.stringify(record.row));
                yield header({ type: 'row', table: record.table, size: body.length });
                digest.update(body); yield body;
            }
            // Read binary originals only after the consistent metadata snapshot is captured.
            for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
                const { table, row } = JSON.parse(line) as { table: string; row: Record<string, unknown> };
                if (table !== 'file_meta') continue;
                if (typeof row.storage_id !== 'string' || row.storage_provider_id !== storage!.id) throw new Error('An original is not committed to the active Cloud provider.');
                const hash = String(row.hash), size = Number(row.size_bytes);
                await requireStorageWorkspaceAccess(event, session, workspaceId);
                let response: Response;
                if (storage!.readBackupFile) {
                    response = await storage!.readBackupFile(event, { workspaceId, hash, storageId: row.storage_id });
                } else {
                    const grant = await storage!.presignDownload(event, { workspaceId, hash, storageId: row.storage_id, disposition: 'attachment' });
                    const origin = getRequestURL(event);
                    const url = new URL(grant.url, origin);
                    const headers = new Headers(grant.headers);
                    if (url.origin === origin.origin) {
                        for (const key of ['cookie', 'authorization']) { const value = getHeader(event, key); if (value) headers.set(key, value); }
                    }
                    response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(120_000) });
                }
                if (!response.ok || !response.body) throw new Error('An original file is unavailable.');
                yield header({ type: 'file', hash, size });
                const reader = response.body.getReader();
                const content = createHash(hash.startsWith('md5:') ? 'md5' : 'sha256');
                let received = 0;
                try {
                    for (;;) {
                        const chunk = await reader.read();
                        if (chunk.done) break;
                        received += chunk.value.length;
                        if (received > size) throw new Error('Original file size mismatch.');
                        content.update(chunk.value); digest.update(chunk.value); yield chunk.value;
                    }
                } finally { await reader.cancel().catch(() => {}); }
                if (received !== size || content.digest('hex') !== hash.split(':')[1]) throw new Error('Original file checksum mismatch.');
                files++;
            }
            yield encodeCloudHeader({ type: 'end', size: 0, rows, files, sha256: digest.digest('hex') });
        } finally { await rm(directory, { recursive: true, force: true }); }
    }
    setResponseHeader(event, 'Content-Type', 'application/octet-stream');
    setResponseHeader(event, 'Content-Disposition', 'attachment; filename="or3-cloud-workspace.or3cloud"');
    return sendStream(event, Readable.from(stream()));
});
