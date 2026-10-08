export interface CardOrigin {
    plugin_id: string | null;
    tool: string;
    call_id: string;
    message_id: string;
    label: string;
}
export interface ToolCardStateEntry {
    v: 1;
    state: unknown;
    updated_at: number;
}
export type ToolCardStateMap = Record<string, ToolCardStateEntry>;
export const CARD_STATE_BYTES = 16 * 1024;
export const CARD_MESSAGE_BYTES = 64 * 1024;
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;
export function jsonCardValue(value: unknown): unknown {
    const active = new Set<object>();
    let nodes = 0;
    const visit = (item: unknown, depth: number): void => {
        if (++nodes > 20000) throw new Error('quota-exceeded');
        if (depth > 64) throw new Error('invalid-input');
        if (item === null || typeof item === 'string' || typeof item === 'boolean')
            return;
        if (typeof item === 'number' && Number.isFinite(item)) return;
        if (typeof item !== 'object' || active.has(item))
            throw new Error('invalid-input');
        if (
            !Array.isArray(item) &&
            Object.getPrototypeOf(item) !== Object.prototype &&
            Object.getPrototypeOf(item) !== null
        )
            throw new Error('invalid-input');
        active.add(item);
        for (const [key, child] of Object.entries(item)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key))
                throw new Error('invalid-input');
            visit(child, depth + 1);
        }
        if (Array.isArray(item) && Object.keys(item).length !== item.length)
            throw new Error('invalid-input');
        active.delete(item);
    };
    visit(value, 0);
    return JSON.parse(JSON.stringify(value));
}
export function assertCardStateLimits(entries: Record<string, unknown>): void {
    for (const value of Object.values(entries))
        if (utf8Bytes(JSON.stringify(value)) > CARD_STATE_BYTES)
            throw new Error('quota-exceeded');
    if (utf8Bytes(JSON.stringify(entries)) > CARD_MESSAGE_BYTES)
        throw new Error('quota-exceeded');
}
export function readToolCardStates(value: unknown): ToolCardStateMap | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const entries = Object.create(null) as ToolCardStateMap;
    for (const [id, entry] of Object.entries(value)) {
        if (
            ['__proto__', 'constructor', 'prototype'].includes(id) ||
            !entry ||
            typeof entry !== 'object'
        )
            continue;
        const e = entry as ToolCardStateEntry;
        if (e.v !== 1 || !Number.isFinite(e.updated_at) || !('state' in e)) continue;
        try {
            const copy = jsonCardValue(e) as ToolCardStateEntry;
            if (utf8Bytes(JSON.stringify(copy)) <= CARD_STATE_BYTES) entries[id] = copy;
        } catch {
            /* ignore malformed sync rows */
        }
    }
    try {
        assertCardStateLimits(entries);
        return entries;
    } catch {
        return;
    }
}
export function readCardOrigin(value: unknown): CardOrigin | undefined {
    if (!value || typeof value !== 'object') return;
    const e = value as CardOrigin;
    if (
        (e.plugin_id === null || typeof e.plugin_id === 'string') &&
        ['tool', 'call_id', 'message_id', 'label'].every(
            (key) => typeof (e as unknown as Record<string, unknown>)[key] === 'string'
        ) &&
        e.label.length <= 100
    )
        return {
            plugin_id: e.plugin_id,
            tool: e.tool,
            call_id: e.call_id,
            message_id: e.message_id,
            label: e.label
        };
}
