/** Library state is independent of the blob's shared storage availability. */
export const WORKSPACE_ITEM_META_KEY = 'or3.workspace-item';
export const FILE_CATALOG_POST_TYPE = 'or3:file';
export interface WorkspaceItemMetadata {
    version: 1;
    trashed_at: number | null;
    text?: { coverage: 'full' | 'prefix' | 'none'; indexed_bytes: number };
}

function metadataObject(meta: unknown): Record<string, unknown> {
    if (meta === '') return {};
    const value: unknown = typeof meta === 'string' ? JSON.parse(meta) : meta;
    if (value == null) return {};
    if (Array.isArray(value)) {
        return Object.fromEntries(value.map((entry: { key: string; value?: unknown }) => [entry.key, entry.value]));
    }
    if (typeof value !== 'object') throw new Error('Unsupported item metadata.');
    if ('key' in value && typeof value.key === 'string') {
        return { [value.key]: 'value' in value ? value.value : null };
    }
    return value as Record<string, unknown>;
}

export function workspaceItemMetadata(meta: unknown): WorkspaceItemMetadata | null {
    try {
        let value = metadataObject(meta)[WORKSPACE_ITEM_META_KEY];
        if (typeof value === 'string') value = JSON.parse(value);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const candidate = value as WorkspaceItemMetadata;
        if (candidate.version !== 1 || !(candidate.trashed_at === null || (typeof candidate.trashed_at === 'number' && Number.isFinite(candidate.trashed_at) && candidate.trashed_at >= 0))) return null;
        if (candidate.text && (!['full', 'prefix', 'none'].includes(candidate.text.coverage)
            || !Number.isSafeInteger(candidate.text.indexed_bytes) || candidate.text.indexed_bytes < 0 || candidate.text.indexed_bytes > 65536)) {
            return { version: 1, trashed_at: candidate.trashed_at };
        }
        return candidate;
    } catch { return null; }
}

export function isVisibleWorkspaceItem(post: { deleted?: boolean; meta?: unknown }): boolean {
    if (post.deleted) return false;
    try {
        if (!Object.hasOwn(metadataObject(post.meta), WORKSPACE_ITEM_META_KEY)) return true;
        const state = workspaceItemMetadata(post.meta);
        return !!state && state.trashed_at === null;
    } catch { return false; }
}

export function mergeWorkspaceItemMetadata(meta: unknown, value: WorkspaceItemMetadata): string {
    if (Object.hasOwn(metadataObject(meta), WORKSPACE_ITEM_META_KEY) && !workspaceItemMetadata(meta)) {
        throw new Error('Unsupported workspace item state. Update OR3 before changing this item.');
    }
    return JSON.stringify({ ...metadataObject(meta), [WORKSPACE_ITEM_META_KEY]: value });
}
