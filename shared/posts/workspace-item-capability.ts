import { FILE_CATALOG_POST_TYPE, WORKSPACE_ITEM_META_KEY } from './workspace-item';

export const WORKSPACE_ITEM_CAPABILITY = 'v1' as const;
export type WorkspaceItemCapability = typeof WORKSPACE_ITEM_CAPABILITY;

function decoded(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return null; }
}

/** Detect semantics even when their version/content is malformed or unknown. */
export function hasWorkspaceItemSemantics(tableName: string, payload: unknown): boolean {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const row = payload as Record<string, unknown>;
    if (tableName === 'posts') {
        if ((row.post_type ?? row.postType) === FILE_CATALOG_POST_TYPE) return true;
        const meta = decoded(row.meta);
        if (Array.isArray(meta)) return meta.some(entry => entry?.key === WORKSPACE_ITEM_META_KEY);
        return !!meta && typeof meta === 'object'
            && (Object.hasOwn(meta, WORKSPACE_ITEM_META_KEY) || ('key' in meta && meta.key === WORKSPACE_ITEM_META_KEY));
    }
    if (tableName === 'projects') {
        const entries = decoded(row.data);
        return Array.isArray(entries) && entries.some(entry => entry && typeof entry === 'object' && entry.kind === 'file');
    }
    return false;
}
