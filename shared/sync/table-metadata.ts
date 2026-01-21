export const TABLE_METADATA = {
    threads: { pk: 'id' },
    messages: { pk: 'id' },
    projects: { pk: 'id' },
    posts: { pk: 'id' },
    kv: { pk: 'id' },
    file_meta: { pk: 'hash' },
} as const;

export function getPkField(tableName: string): string {
    if (tableName in TABLE_METADATA) {
        return TABLE_METADATA[tableName as keyof typeof TABLE_METADATA].pk;
    }
    return 'id';
}
