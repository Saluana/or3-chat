import { sha256 } from '@noble/hashes/sha2.js';

export type BackgroundClientToolIdentity = {
    jobId: string;
    userId: string;
    workspaceId: string;
    threadId: string;
    messageId: string;
    call: { id: string; name: string; arguments: string; definition: unknown };
};

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, canonical(child)]));
}

/** Security binding; do not use the diagnostic FNV argument fingerprint here. */
export function backgroundClientToolDigest(identity: BackgroundClientToolIdentity): string {
    const serialized = JSON.stringify(canonical({ version: 1, ...identity }));
    return Array.from(sha256(new TextEncoder().encode(serialized)), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The random component stays opaque; provider equality fences fabricated tokens. */
export function backgroundClientToolTokenDigest(token: string): string | null {
    return /^or3ct1\.([a-f0-9]{64})\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.exec(token)?.[1] ?? null;
}
