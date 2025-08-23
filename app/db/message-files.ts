import { db } from './client';
import { parseFileHashes, serializeFileHashes } from './files-util';
import { computeFileHash } from '../utils/hash';
import { createOrRefFile, derefFile, getFileMeta } from './files';
import { useHooks } from '../composables/useHooks';
import { nowSec } from './util';

export type AddableFile = Blob | { hash: string };

/** Resolve file metadata list for a message id */
export async function filesForMessage(messageId: string) {
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
) {
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
                if (f instanceof Blob) {
                    const meta = await createOrRefFile(
                        f,
                        (f as any).name || 'file'
                    );
                    newHashes.push(meta.hash);
                } else if (f && typeof f === 'object' && 'hash' in f) {
                    // Validate meta exists
                    const meta = await getFileMeta(f.hash);
                    if (meta) newHashes.push(meta.hash);
                }
            }
            let combined = existing.concat(newHashes);
            // Provide hook for validation & pruning
            combined = await hooks.applyFilters(
                'db.messages.files.validate:filter:hashes',
                combined
            );
            const serialized = serializeFileHashes(combined);
            await db.messages.put({
                ...msg,
                file_hashes: serialized,
                updated_at: nowSec(),
            });
        }
    );
}

/** Remove a single file hash from a message, adjusting ref count */
export async function removeFileFromMessage(messageId: string, hash: string) {
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
