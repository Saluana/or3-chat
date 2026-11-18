import type { Or3DB } from './client';
import type { Kv, Post } from './schema';
import { EXPLORER_FOLDER_POST_TYPE, EXPLORER_PLACEMENT_POST_TYPE } from '~~/shared/explorer/records';

export function explorerPrefix(scopeKey: string) {
    return 'or3.explorer/' + encodeURIComponent(scopeKey) + '/';
}

export function explorerKvRow(row: Post): Kv {
    const name = explorerPrefix(row.title) + row.id;
    return { id: 'kv:' + name, name, value: JSON.stringify([row.content, row.deleted]),
        deleted: false, clock: row.clock, created_at: row.created_at, updated_at: row.updated_at };
}

export function explorerFromKv(row: Kv, scopeKey: string): Post {
    // Keep the revision even for unreadable entries. An older preview post must
    // never resurrect a removed location or overwrite a newer payload format.
    let value: unknown;
    if (row.value) {
        try { value = JSON.parse(row.value); } catch { /* Leave an unreadable entry unprojected. */ }
    }
    let content = '';
    let deleted = row.deleted;
    if (Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'boolean') {
        content = value[0];
        deleted ||= value[1];
    }
    const id = row.name.slice(explorerPrefix(scopeKey).length);
    return { id, title: scopeKey, content, deleted,
        postType: id.startsWith('explorer-folder-') ? EXPLORER_FOLDER_POST_TYPE : EXPLORER_PLACEMENT_POST_TYPE,
        clock: row.clock, hlc: row.hlc, created_at: row.created_at, updated_at: row.updated_at };
}

export async function explorerRecordById(db: Or3DB, key: string, id: string) {
    const row = await db.kv.get('kv:' + explorerPrefix(key) + id);
    return row ? explorerFromKv(row, key) : db.posts.get(id);
}
