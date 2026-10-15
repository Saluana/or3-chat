/** Device secrets and caches must never be admitted to the sync wire. */
export const LOCAL_ONLY_KV_NAMES = ['MODELS_CATALOG', 'openrouter_api_key', 'workspace.manager.cache'] as const;

export function isLocalOnlyKvChange(tableName: string, pk: string, payload?: unknown, names: ReadonlySet<string> = new Set(LOCAL_ONLY_KV_NAMES)): boolean {
    if (tableName !== 'kv') return false;
    const row = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    return [pk, row.id, row.name].some(value => typeof value === 'string' && names.has(value.replace(/^kv:/, '')));
}
