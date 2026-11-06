/** Offline preparation only. No caller selects this during ordinary restore;
 * no network, database, migration activation or deletion is performed here.
 * The original archive must remain the recovery source until a separately
 * approved fresh-workspace restore has been qualified.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { CLOUD_BACKUP_MAGIC, CloudBackupError, encodeCloudHeader, MAX_ARCHIVE_ROW_BYTES,
    readCloudBackupRows, scanCloudBackup, type CloudBackupHeader } from './workspace-archive';

const legacyIdentity = /md5:[a-f0-9]{32}/i;
async function digestBlob(body: Blob, digest = sha256.create()) {
    for (let position = 0; position < body.size; position += 1024 * 1024) {
        digest.update(new Uint8Array(await body.slice(position, position + 1024 * 1024).arrayBuffer()));
    }
    return digest;
}
export async function prepareSha256CloudBackup(source: Blob): Promise<{ archive: Blob; convertedFiles: number }> {
    const originals = new Map<string, { hash: string; body: Blob }>();
    const targets = new Set<string>();
    let convertedFiles = 0;
    // The entire source, its originals and terminal checksum must validate
    // before any replacement can escape this function.
    const meta = await scanCloudBackup(source, async frame => {
        if (frame.header.type !== 'file') return;
        const hash = `sha256:${bytesToHex((await digestBlob(frame.body)).digest())}`;
        if (targets.has(hash)) throw new CloudBackupError('Two file identities contain the same bytes. Resolve their metadata before conversion.');
        targets.add(hash); originals.set(frame.header.hash, { hash, body: frame.body });
        if (frame.header.hash !== hash) convertedFiles++;
    });
    if (!convertedFiles) return { archive: source, convertedFiles: 0 };
    const legacyDigests = new Set([...originals.keys()].filter(hash => hash.startsWith('md5:')).map(hash => hash.slice(4)));
    const hasLegacyReference = (text: string) => legacyIdentity.test(text) ||
        [...text.matchAll(/(?<![a-f0-9])([a-f0-9]{32})(?![a-f0-9])/gi)].some(match => legacyDigests.has(match[1]!.toLowerCase()));
    const remap = (hash: unknown): string => {
        if (typeof hash !== 'string' || !originals.has(hash)) throw new CloudBackupError('A file reference has no verified original.');
        return originals.get(hash)!.hash;
    };
    // Walk only the documented editor image reference. Never substitute hashes
    // in arbitrary text, opaque plugin values or encoded revision payloads.
    function rewriteDocument(node: unknown, depth = 0): void {
        if (depth > 128) throw new CloudBackupError('This document is too deeply nested to convert safely.');
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        const value = node as Record<string, unknown>;
        if (value.type === 'or3Image' && value.attrs && typeof value.attrs === 'object' && !Array.isArray(value.attrs)) {
            const attrs = value.attrs as Record<string, unknown>;
            attrs.hash = remap(attrs.hash);
        }
        if (Array.isArray(value.content)) for (const child of value.content) rewriteDocument(child, depth + 1);
    }
    const parts: BlobPart[] = [CLOUD_BACKUP_MAGIC]; const digest = sha256.create();
    let rows = 0, files = 0;
    const append = async (header: CloudBackupHeader, body?: Blob) => {
        const line = Uint8Array.from(encodeCloudHeader(header)); parts.push(line); digest.update(line);
        if (body) { parts.push(body); await digestBlob(body, digest); }
    };
    await append(meta);
    for await (const { table, row } of readCloudBackupRows(source)) {
        if (table === 'kv' && row.value !== null && row.value !== undefined) {
            throw new CloudBackupError('Stored settings or extension data need a reference-aware converter before legacy identities can change.');
        }
        if (table === 'posts' && typeof row.post_type === 'string' && row.post_type.startsWith('or3:document-revision')) {
            throw new CloudBackupError('Document revision archives need a revision-aware converter before legacy identities can change.');
        }
        if (table === 'file_meta') {
            row.hash = remap(row.hash);
            delete row.storage_id; delete row.storage_provider_id;
        }
        if ((table === 'messages' || table === 'posts') && typeof row.file_hashes === 'string') {
            row.file_hashes = JSON.stringify((JSON.parse(row.file_hashes) as unknown[]).map(remap));
        }
        if (table === 'posts' && typeof row.content === 'string' && hasLegacyReference(row.content)) {
            let content: unknown;
            try { content = JSON.parse(row.content); }
            catch { throw new CloudBackupError('An unrecognized document reference needs review before conversion.'); }
            rewriteDocument(content); row.content = JSON.stringify(content);
        }
        const text = JSON.stringify(row);
        if (hasLegacyReference(text)) throw new CloudBackupError('An unrecognized legacy reference needs review before conversion.');
        const body = new Blob([text]);
        if (body.size > MAX_ARCHIVE_ROW_BYTES) throw new CloudBackupError('A converted record exceeds the backup size limit.');
        await append({ type: 'row', table, size: body.size }, body); rows++;
    }
    for (const { hash, body } of originals.values()) {
        await append({ type: 'file', hash, size: body.size }, body); files++;
    }
    parts.push(Uint8Array.from(encodeCloudHeader({ type: 'end', size: 0, rows, files, sha256: bytesToHex(digest.digest()) })));
    const archive = new Blob(parts, { type: 'application/octet-stream' });
    await scanCloudBackup(archive);
    return { archive, convertedFiles };
}
