import Dexie from 'dexie';
import type { Or3DB } from './client';
import type { ExplorerItemKey, FileMeta } from './schema';

export interface ExplorerItemMetadata {
    id: string;
    kind: 'document' | 'file';
    title: string;
    updatedAt: number;
    clock: number;
    textCoverage: ExplorerItemKey[6];
    file?: FileMeta;
}

/** Only the explicit search and activation paths need full post values. */
export async function listExplorerItems(db: Or3DB, state: ExplorerItemKey[0]): Promise<ExplorerItemMetadata[]> {
    const keys: ExplorerItemKey[] = [];
    await db.posts.where('explorer_item_key').between(
        [state, Dexie.minKey], [state, Dexie.maxKey], true, true,
    ).eachKey(key => { keys.push(key as ExplorerItemKey); });

    const hashes = [...new Set(keys.map(key => key[5]).filter(Boolean))];
    const fileMeta = new Map<string, FileMeta>();
    for (let start = 0; start < hashes.length; start += 100) {
        for (const row of await db.file_meta.bulkGet(hashes.slice(start, start + 100))) {
            if (row && !row.deleted) fileMeta.set(row.hash, row);
        }
    }
    return keys.flatMap(([, kind, updatedAt, title, id, hash, textCoverage, clock]) => {
        const file = fileMeta.get(hash);
        if (kind === 'file' && !file) return [];
        return [{ kind, updatedAt, title, id, textCoverage, clock, file }];
    });
}
