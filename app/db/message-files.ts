/**
 * @module app/db/message-files
 *
 * Purpose:
 * Utilities for associating file hashes with messages.
 *
 * Responsibilities:
 * - Resolve file metadata for message attachments
 * - Add or remove file references and update ref counts
 *
 * Non-responsibilities:
 * - Uploading or downloading file blobs
 * - Rendering attachment previews
 */
import { getDb } from './client';
import type { FileMeta } from './schema';
import { parseFileHashes, serializeFileHashes } from './files-util';
import { createOrRefFile, derefFile, getFileMeta } from './files';
import { useHooks } from '../core/hooks/useHooks';
import { nowSec, nextClock, getWriteTxTableNames } from './util';

/** Discriminated union for adding files to messages */
/**
 * Purpose:
 * Payload type for adding files to messages.
 *
 * Behavior:
 * Supports either a raw Blob or a previously stored hash reference.
 *
 * Constraints:
 * - Blob entries must include valid Blob instances.
 *
 * Non-Goals:
 * - Does not carry metadata beyond name or hash.
 */
export type AddableFile =
    | { type: 'blob'; blob: Blob; name?: string }
    | { type: 'hash'; hash: string };

/**
 * Purpose:
 * Resolve file metadata entries for a given message.
 *
 * Behavior:
 * Parses stored hashes from the message and loads metadata rows.
 *
 * Constraints:
 * - Returns an empty array when the message is missing or has no hashes.
 *
 * Non-Goals:
 * - Does not ensure blobs are available locally.
 */
export async function filesForMessage(messageId: string): Promise<FileMeta[]> {
    const msg = await getDb().messages.get(messageId);
    if (!msg) return [];
    const hashes = parseFileHashes(msg.file_hashes);
    if (!hashes.length) return [];
    return getDb().file_meta.where('hash').anyOf(hashes).toArray();
}

/**
 * Purpose:
 * Attach files to a message by blob or hash.
 *
 * Behavior:
 * Creates or references file metadata, updates message file hashes, and
 * applies validation hooks.
 *
 * Constraints:
 * - Runs inside a transaction to keep message and file state aligned.
 *
 * Non-Goals:
 * - Does not enforce UI selection limits.
 */
export async function addFilesToMessage(
    messageId: string,
    files: AddableFile[]
): Promise<void> {
    if (!files.length) return;
    const hooks = useHooks();
    const db = getDb();
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'messages', {
            include: ['file_meta', 'file_blobs'],
        }),
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
                clock: nextClock(msg.clock),
            });
        }
    );
}

/**
 * Purpose:
 * Remove a file reference from a message.
 *
 * Behavior:
 * Updates the message hash list and decrements file ref counts.
 *
 * Constraints:
 * - No-op if the message does not exist or the hash is absent.
 *
 * Non-Goals:
 * - Does not delete file metadata or blobs.
 */
export async function removeFileFromMessage(
    messageId: string,
    hash: string
): Promise<void> {
    const db = getDb();
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'messages', { include: ['file_meta'] }),
        async () => {
        const msg = await db.messages.get(messageId);
        if (!msg) return;
        const hashes = parseFileHashes(msg.file_hashes);
        const next = hashes.filter((h) => h !== hash);
        if (next.length === hashes.length) return; // no change
        await db.messages.put({
            ...msg,
            file_hashes: serializeFileHashes(next),
            updated_at: nowSec(),
            clock: nextClock(msg.clock),
        });
        await derefFile(hash);
    });
}
