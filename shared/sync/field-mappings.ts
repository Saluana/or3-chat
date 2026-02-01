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
        } else if (camel in result && snake in result) {
            // Should be unreachable due to first check, but for safety:
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
        }   else if (snake in result && camel in result) {
             delete result[camel];
        }
    }
    return result;
}
