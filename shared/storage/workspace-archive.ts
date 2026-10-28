import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { TABLE_PAYLOAD_SCHEMAS } from '../sync/schemas';
import { isLocalOnlyKvChange } from '../sync/local-only-kv';

export const CLOUD_BACKUP_MAGIC = 'OR3CLOUD1\n';
export const ARCHIVE_TABLES = ['projects', 'threads', 'messages', 'posts', 'kv', 'file_meta', 'notifications'] as const;
export const MAX_ARCHIVE_ROW_BYTES = 2 * 1024 * 1024;
const hashSchema = z.string().regex(/^(?:sha256:[a-f0-9]{64}|md5:[a-f0-9]{32})$/);
const MetaSchema = z.object({ type: z.literal('meta'), version: z.literal(1), size: z.literal(0), workspaceName: z.string().min(1).max(100) }).strict();
const HeaderSchema = z.discriminatedUnion('type', [
    MetaSchema,
    z.object({ type: z.literal('row'), table: z.enum(ARCHIVE_TABLES), size: z.number().int().min(1).max(MAX_ARCHIVE_ROW_BYTES) }).strict(),
    z.object({ type: z.literal('file'), hash: hashSchema, size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict(),
    z.object({ type: z.literal('end'), size: z.literal(0), rows: z.number().int().nonnegative(), files: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export type CloudBackupHeader = z.infer<typeof HeaderSchema>;
export type CloudBackupMeta = z.infer<typeof MetaSchema>;
export type CloudBackupFrame = { header: CloudBackupHeader; body: Blob; row?: Record<string, unknown> };
export const encodeCloudHeader = (header: CloudBackupHeader): Uint8Array => new TextEncoder().encode(JSON.stringify(HeaderSchema.parse(header)) + '\n');

/** A backup or restore failure whose message is written for users and safe to display. */
export class CloudBackupError extends Error {
    override name = 'CloudBackupError';
}
const DAMAGED_BACKUP = 'This backup is damaged or incomplete.';

/** Check frame boundaries/counts on download; restore also verifies checksums. */
export function createCloudBackupStreamCheck() {
    const buffer = new Uint8Array(16 * 1024);
    let magic = 0, length = 0, remaining = 0, rows = 0, files = 0;
    let sawMeta = false, complete = false;
    return {
        write(chunk: Uint8Array) {
            let position = 0;
            while (position < chunk.length) {
                if (complete) throw new Error('Unexpected bytes after the backup terminal marker.');
                if (magic < CLOUD_BACKUP_MAGIC.length) {
                    if (chunk[position++] !== CLOUD_BACKUP_MAGIC.charCodeAt(magic++)) throw new Error('Unsupported Cloud backup.');
                    continue;
                }
                if (remaining) {
                    const size = Math.min(remaining, chunk.length - position);
                    remaining -= size; position += size;
                    continue;
                }
                const newline = chunk.indexOf(10, position);
                const end = newline < 0 ? chunk.length : newline + 1;
                if (length + end - position > buffer.length) throw new Error('Backup header is too large.');
                buffer.set(chunk.subarray(position, end), length);
                length += end - position; position = end;
                if (newline < 0) continue;
                const header = HeaderSchema.parse(JSON.parse(new TextDecoder().decode(buffer.subarray(0, length))));
                length = 0;
                if (header.type === 'meta') {
                    if (sawMeta) throw new Error('Unexpected backup metadata.');
                    sawMeta = true;
                } else if (!sawMeta) throw new Error('Backup metadata is missing.');
                else if (header.type === 'end') {
                    if (header.rows !== rows || header.files !== files) throw new Error('Backup frame counts do not match.');
                    complete = true;
                } else {
                    if (header.type === 'row') rows++; else files++;
                    remaining = header.size;
                }
            }
        },
        finish() {
            if (!complete) throw new Error('Cloud backup ended before all originals were verified. Discard this incomplete file and retry.');
        },
    };
}

async function headerAt(file: Blob, offset: number) {
    const bytes = new Uint8Array(await file.slice(offset, offset + 16 * 1024).arrayBuffer());
    const end = bytes.indexOf(10);
    if (end < 0) throw new CloudBackupError(DAMAGED_BACKUP);
    const line = bytes.subarray(0, end + 1);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(line)); }
    catch { throw new CloudBackupError(DAMAGED_BACKUP); }
    const header = HeaderSchema.safeParse(value);
    if (header.success) return { header: header.data, bytes: line };
    const version = (value as { type?: unknown; version?: unknown } | null)?.type === 'meta' ? (value as { version?: unknown }).version : undefined;
    if (typeof version === 'number' && version > 1) throw new CloudBackupError('This backup was made by a newer version of OR3. Update OR3, then restore it.');
    throw new CloudBackupError(DAMAGED_BACKUP);
}
function parseRow(table: typeof ARCHIVE_TABLES[number], text: string): Record<string, unknown> {
    try { return TABLE_PAYLOAD_SCHEMAS[table]!.parse(JSON.parse(text)) as Record<string, unknown>; }
    catch { throw new CloudBackupError('This backup contains an invalid record.'); }
}
export async function peekCloudBackup(file: Blob): Promise<CloudBackupMeta> {
    if (await file.slice(0, CLOUD_BACKUP_MAGIC.length).text() !== CLOUD_BACKUP_MAGIC) throw new CloudBackupError('This file is not an OR3 Cloud backup.');
    const { header } = await headerAt(file, CLOUD_BACKUP_MAGIC.length);
    if (header.type !== 'meta') throw new CloudBackupError(DAMAGED_BACKUP);
    return header;
}

/** Re-read bounded records from an already validated, immutable backup File. */
export async function* readCloudBackupRows(file: Blob): AsyncGenerator<{ table: typeof ARCHIVE_TABLES[number]; row: Record<string, unknown> }> {
    await peekCloudBackup(file);
    let offset = CLOUD_BACKUP_MAGIC.length;
    while (offset < file.size) {
        const { header, bytes } = await headerAt(file, offset);
        offset += bytes.length;
        if (offset + header.size > file.size) throw new CloudBackupError(DAMAGED_BACKUP);
        if (header.type === 'row') yield { table: header.table, row: parseRow(header.table, await file.slice(offset, offset + header.size).text()) };
        if (header.type === 'end') return;
        offset += header.size;
    }
    throw new CloudBackupError(DAMAGED_BACKUP);
}

/** Binary frames reference File slices. Only bounded records/chunks enter memory. */
export async function scanCloudBackup(file: Blob, visit?: (frame: CloudBackupFrame) => Promise<void>): Promise<CloudBackupMeta> {
    const meta = await peekCloudBackup(file);
    const digest = sha256.create();
    let offset = CLOUD_BACKUP_MAGIC.length;
    let rows = 0, files = 0, sawMeta = false, sawEnd = false;
    const keys = new Set<string>();
    const originals = new Map<string, number>();
    const seenFiles = new Set<string>();
    const references = new Set<string>();
    while (offset < file.size) {
        const { header, bytes } = await headerAt(file, offset);
        offset += bytes.length;
        if (header.type === 'end') {
            if (offset !== file.size || header.rows !== rows || header.files !== files ||
                header.sha256 !== bytesToHex(digest.digest())) throw new CloudBackupError('This backup failed its checksum. It may be damaged.');
            sawEnd = true;
            break;
        }
        if (offset + header.size > file.size) throw new CloudBackupError(DAMAGED_BACKUP);
        digest.update(bytes);
        const body = file.slice(offset, offset + header.size);
        let fileDigest: ReturnType<typeof sha256.create> | undefined;
        let md5: { append(data: ArrayBuffer): unknown; end(): string } | undefined;
        if (header.type === 'file') {
            if (header.hash.startsWith('sha256:')) fileDigest = sha256.create();
            else { const { default: SparkMD5 } = await import('spark-md5'); md5 = new SparkMD5.ArrayBuffer(); }
        }
        // Blob streams can deliver large chunks without yielding to UI tasks.
        // Bound both the allocation and uninterrupted hashing time explicitly.
        let yieldAt = Date.now() + 16;
        for (let position = 0; position < body.size; position += 1024 * 1024) {
            const part = new Uint8Array(await body.slice(position, position + 1024 * 1024).arrayBuffer());
            digest.update(part); fileDigest?.update(part);
            md5?.append(part.buffer);
            if (Date.now() >= yieldAt) {
                await new Promise(resolve => setTimeout(resolve, 0));
                yieldAt = Date.now() + 16;
            }
        }
        let row: Record<string, unknown> | undefined;
        if (header.type === 'meta') {
            if (sawMeta || rows || files) throw new CloudBackupError(DAMAGED_BACKUP);
            sawMeta = true;
        } else if (!sawMeta) throw new CloudBackupError(DAMAGED_BACKUP);
        else if (header.type === 'row') {
            row = parseRow(header.table, await body.text());
            const key = header.table === 'file_meta' ? row.hash : row.id;
            if (typeof key !== 'string' || keys.has(`${header.table}:${key}`)) throw new CloudBackupError('This backup contains a duplicate or invalid record.');
            keys.add(`${header.table}:${key}`);
            if (isLocalOnlyKvChange(header.table, key, row)) throw new CloudBackupError('Cloud backups cannot contain device credentials or transport settings.');
            if (header.table === 'file_meta') {
                if (!hashSchema.safeParse(key).success) throw new CloudBackupError('This backup contains an invalid record.');
                originals.set(key, Number(row.size_bytes));
            }
            if ((header.table === 'posts' || header.table === 'messages') && typeof row.file_hashes === 'string') {
                let hashes: unknown;
                try { hashes = JSON.parse(row.file_hashes); } catch { hashes = null; }
                if (!Array.isArray(hashes) || hashes.some(hash => typeof hash !== 'string')) throw new CloudBackupError('This backup contains an invalid record.');
                for (const hash of hashes as string[]) references.add(hash);
            }
            rows++;
        } else {
            if (seenFiles.has(header.hash) || originals.get(header.hash) !== header.size) throw new CloudBackupError('An original file in this backup is missing, duplicated, or the wrong size.');
            const actual = fileDigest ? `sha256:${bytesToHex(fileDigest.digest())}` : `md5:${md5!.end()}`;
            if (actual !== header.hash) throw new CloudBackupError('An original file in this backup failed its checksum.');
            seenFiles.add(header.hash); files++;
        }
        await visit?.({ header, body, row });
        offset += header.size;
    }
    if (!sawEnd || originals.size !== seenFiles.size || [...references].some(hash => !seenFiles.has(hash))) {
        throw new CloudBackupError('This backup is incomplete or missing an original file.');
    }
    return meta;
}
