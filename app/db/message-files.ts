import { db } from './client';
import type { FileMeta } from './schema';
import { parseFileHashes, serializeFileHashes } from './files-util';
import { createOrRefFile, derefFile, getFileMeta } from './files';
import { useHooks } from '../core/hooks/useHooks';
import { nowSec } from './util';

/** Discriminated union for adding files to messages */
export type AddableFile =
    | { type: 'blob'; blob: Blob; name?: string }
    | { type: 'hash'; hash: string };

/** Resolve file metadata list for a message id */
export async function filesForMessage(messageId: string): Promise<FileMeta[]> {
    const msg = await db.messages.get(messageId);
    if (!msg) return [];
    const hashes = parseFileHashes(msg.file_hashes);
    if (!hashes.length) return [];
    return db.file_meta.where('hash').anyOf(hashes).toArray();
}

/** Add files (blobs or existing hashes) to a message, updating ref counts */
export async function addFilesToMessage(
    messageId: string,
    files: AddableFile[]
): Promise<void> {
    if (!files.length) return;
    const hooks = useHooks();
    await db.transaction(
        'rw',
        db.messages,
        db.file_meta,
        db.file_blobs,
        async () => {
            const msg = await db.messages.get(messageId);
            if (!msg) throw new Error('message not found');
            const existing = parseFileHashes(msg.file_hashes);
            const newHashes: string[] = [];
            for (const f of files) {
                // Handle blob variant
                if ('blob' in f && f.blob instanceof Blob) {
                    const meta = await createOrRefFile(
                        f.blob,
                        f.name || 'file'
                    );
                    newHashes.push(meta.hash);
                }
                // Handle hash variant
                else if ('hash' in f && typeof f.hash === 'string') {
                    // Validate meta exists
                    const meta = await getFileMeta(f.hash);
                    if (meta) newHashes.push(meta.hash);
                }
            }
            const combined = existing.concat(newHashes);
            // Provide hook for validation & pruning
            const filtered = await hooks.applyFilters(
                'db.messages.files.validate:filter:hashes',
                combined
            );
            const serialized = serializeFileHashes(filtered);
            await db.messages.put({
                ...msg,
                file_hashes: serialized,
                updated_at: nowSec(),
            });
        }
    );
}

/** Remove a single file hash from a message, adjusting ref count */
export async function removeFileFromMessage(
    messageId: string,
    hash: string
): Promise<void> {
    await db.transaction('rw', db.messages, db.file_meta, async () => {
        const msg = await db.messages.get(messageId);
        if (!msg) return;
        const hashes = parseFileHashes(msg.file_hashes);
        const next = hashes.filter((h) => h !== hash);
        if (next.length === hashes.length) return; // no change
        await db.messages.put({
            ...msg,
            file_hashes: serializeFileHashes(next),
            updated_at: nowSec(),
        });
        await derefFile(hash);
    });
}
