/** Portable canonical Explorer contract, also used by the storage providers. */
export const EXPLORER_CAPABILITY = 'v1' as const;
export const EXPLORER_FOLDER_POST_TYPE = 'or3:explorer-folder';
export const EXPLORER_PLACEMENT_POST_TYPE = 'or3:explorer-placement';

const folderPrefix = 'explorer-folder-';
const placementPrefix = 'explorer-placement-';
const folderId = /^explorer-folder-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const placementId = /^explorer-placement-[0-9a-f]{64}$/u;
const bytes = new TextEncoder();

function object(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;
}

export function isExplorerPostType(type: unknown): boolean {
    return type === EXPLORER_FOLDER_POST_TYPE || type === EXPLORER_PLACEMENT_POST_TYPE;
}

export function hasExplorerSemantics(table: string, key: string, payload?: unknown): boolean {
    if (table !== 'posts') return false;
    const row = object(payload);
    return key.startsWith(folderPrefix) || key.startsWith(placementPrefix)
        || isExplorerPostType(row?.post_type) || isExplorerPostType(row?.postType);
}

export function validExplorerKey(key: string): boolean {
    return folderId.test(key) || placementId.test(key);
}

export interface ExplorerIdentity {
    type: typeof EXPLORER_FOLDER_POST_TYPE | typeof EXPLORER_PLACEMENT_POST_TYPE;
    title: string;
    hashInput?: string;
}

/** Read the wire identity and enforce shape before any canonical write. */
export function explorerIdentity(key: string, payload: unknown): ExplorerIdentity | null {
    const row = object(payload);
    if (!row || row.id !== key || typeof row.title !== 'string' || typeof row.content !== 'string'
        || row.content.length > 8192 || bytes.encode(row.content).byteLength > 8192
        || (row.meta !== undefined && row.meta !== null && row.meta !== '')
        || (row.file_hashes !== undefined && row.file_hashes !== null && row.file_hashes !== '[]')
        || (row.post_type !== undefined && row.postType !== undefined && row.post_type !== row.postType)) return null;
    let content: Record<string, unknown> | undefined;
    try { content = object(JSON.parse(row.content)); }
    catch { return null; }
    const scope = object(content?.scope);
    if (!content || content.version !== 1 || !scope
        || !(content.parent_id === null || (typeof content.parent_id === 'string' && folderId.test(content.parent_id)))) return null;
    const title = scope.kind === 'files' ? JSON.stringify(['files'])
        : scope.kind === 'project' && typeof scope.project_id === 'string' && scope.project_id
            ? JSON.stringify(['project', scope.project_id]) : undefined;
    if (!title || title !== row.title) return null;
    const type = row.post_type ?? row.postType;
    if (type === EXPLORER_FOLDER_POST_TYPE && folderId.test(key)) {
        const { name } = content;
        if (typeof name !== 'string' || name !== name.trim() || !name || name === '.' || name === '..'
            || /[\p{Cc}/\\]/u.test(name) || [...name].length > 255) return null;
        return { type, title };
    }
    if (type === EXPLORER_PLACEMENT_POST_TYPE && placementId.test(key)) {
        const item = object(content.item);
        if (!item || typeof item.item_id !== 'string' || !item.item_id
            || (item.kind !== 'file' && item.kind !== 'document' && !(item.kind === 'chat' && scope.kind === 'project'))) return null;
        return { type, title, hashInput: JSON.stringify([title, item.kind, item.item_id]) };
    }
    return null;
}

export function explorerIdentityMatches(key: string, identity: ExplorerIdentity, digest?: string): boolean {
    return identity.hashInput === undefined || key === placementPrefix + digest;
}

/** Bare deletes are allowed only for reserved, valid IDs. Retained rows keep their original scope and type. */
export function explorerMutationIdentity(table: string, key: string, operation: 'put' | 'delete',
    payload: unknown, stored?: unknown): { valid: boolean; incoming?: ExplorerIdentity; existing?: ExplorerIdentity } {
    if (!hasExplorerSemantics(table, key, payload) && !hasExplorerSemantics(table, key, stored)) return { valid: true };
    if (!validExplorerKey(key)) return { valid: false };
    const existing = stored == null ? undefined : explorerIdentity(key, stored) ?? undefined;
    if (stored != null && !existing) return { valid: false };
    if (operation === 'delete' && (payload == null || Object.keys(object(payload) ?? {}).every(field =>
        field === 'id' || field === 'deleted' || field === 'clock' || field === 'hlc' || field === 'op_id'))) {
        return { valid: payload == null || !!object(payload) && (object(payload)?.id === undefined || object(payload)?.id === key), existing };
    }
    const incoming = explorerIdentity(key, payload) ?? undefined;
    return { valid: !!incoming && (!existing || incoming.type === existing.type && incoming.title === existing.title), incoming, existing };
}
