export const FIELD_MAPPINGS: Record<string, Record<string, string>> = {
    posts: {
        post_type: 'postType',
    },
};

export function toClientFormat(tableName: string, payload: Record<string, unknown>): Record<string, unknown> {
    const mappings = FIELD_MAPPINGS[tableName];
    if (!mappings) return payload;

    const result = { ...payload };
    for (const [snake, camel] of Object.entries(mappings)) {
        if (snake in result) {
            result[camel] = result[snake];
            delete result[snake];
        }
    }
    return result;
}

export function toServerFormat(tableName: string, payload: Record<string, unknown>): Record<string, unknown> {
    const mappings = FIELD_MAPPINGS[tableName];
    if (!mappings) return payload;

    const result = { ...payload };
    for (const [snake, camel] of Object.entries(mappings)) {
        if (camel in result) {
            result[snake] = result[camel];
            delete result[camel];
        }
    }
    return result;
}
