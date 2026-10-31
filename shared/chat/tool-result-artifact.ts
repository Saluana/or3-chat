/** Immutable workspace KV chunks for completed tool output that cannot be inline. */
import { sha256 } from '@noble/hashes/sha2.js';

export const TOOL_RESULT_INLINE_JSON_BYTES = 16 * 1024;
const PART_JSON_BYTES = 64 * 1024;
const encoder = new TextEncoder();
export type ToolResultArtifactRow = {
    id: string; name: string; value: string; deleted: false;
    clock: number; created_at: number; updated_at: number;
};
function digest(value: string): string {
    const bytes = sha256(encoder.encode(value));
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function splitResult(result: string): string[] {
    const parts: string[] = []; let current = ''; let bytes = 2;
    for (const point of result) {
        const cost = encoder.encode(JSON.stringify(point)).length - 2;
        if (bytes + cost > PART_JSON_BYTES) { parts.push(current); current = ''; bytes = 2; }
        current += point; bytes += cost;
    }
    if (current) parts.push(current);
    return parts;
}
export function toolResultArtifactPrefix(threadId: string): string {
    return `chat.tool-result:${encodeURIComponent(threadId)}:`;
}
export function parseToolResultArtifact(value: string) {
    const match = /^or3-tool-result:v1\/([^/]+)\/([a-f0-9]{64})\/([a-f0-9]{64})\/(\d+)$/.exec(value);
    if (!match) return null;
    const parts = Number(match[4]);
    if (!Number.isSafeInteger(parts) || parts < 1 || parts > 32) return null;
    try { return { threadId: decodeURIComponent(match[1]!), id: match[2]!, sha256: match[3]!, parts }; }
    catch { return null; }
}
export function matchesToolResultStorage(reference: string, result: string,
    identity: { threadId: string; parentAssistantId: string; callId: string }): boolean {
    const manifest = parseToolResultArtifact(reference);
    if (!manifest || encoder.encode(JSON.stringify(result)).length <= TOOL_RESULT_INLINE_JSON_BYTES ||
        encoder.encode(result).length > 256 * 1024) return false;
    return manifest.threadId === identity.threadId &&
        manifest.id === digest(JSON.stringify([identity.threadId, identity.parentAssistantId, identity.callId, result])) &&
        manifest.sha256 === digest(result) && manifest.parts === splitResult(result).length;
}
export async function prepareToolResultStorage(result: string, identity: { threadId: string; parentAssistantId: string; callId: string }) {
    // Measure JSON escaping, rather than raw characters. The existing accepted
    // result cap remains unchanged; every overflow byte is retained below.
    if (encoder.encode(JSON.stringify(result)).length <= TOOL_RESULT_INLINE_JSON_BYTES)
        return { result, rows: [] as ToolResultArtifactRow[] };
    if (encoder.encode(result).length > 256 * 1024) throw new Error('Tool result exceeds its durable limit');
    const id = digest(JSON.stringify([identity.threadId, identity.parentAssistantId, identity.callId, result]));
    const checksum = digest(result);
    const parts = splitResult(result);
    const now = Math.floor(Date.now() / 1000);
    const rows = parts.map((value, index): ToolResultArtifactRow => ({
        id: `tool-result:${id}:${index}`, name: `${toolResultArtifactPrefix(identity.threadId)}${id}:${index}`,
        value, clock: 1, deleted: false, created_at: now, updated_at: now,
    }));
    return { result: `or3-tool-result:v1/${encodeURIComponent(identity.threadId)}/${id}/${checksum}/${parts.length}`, rows };
}
export async function readToolResultStorage(reference: string, read: (id: string) => Promise<{ value?: string | null; deleted?: boolean } | undefined>): Promise<string> {
    const manifest = parseToolResultArtifact(reference);
    if (!manifest) throw new Error('Invalid tool result reference');
    const rows = await Promise.all(Array.from({ length: manifest.parts }, (_, index) => read(`tool-result:${manifest.id}:${index}`)));
    if (rows.some(row => !row || row.deleted || typeof row.value !== 'string')) throw new Error('Full tool result has not synchronized yet. Retry after sync finishes.');
    const result = rows.map(row => row!.value!).join('');
    if (await digest(result) !== manifest.sha256) throw new Error('Full tool result failed its integrity check');
    return result;
}
