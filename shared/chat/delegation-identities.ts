import { sha256 } from '@noble/hashes/sha2.js';

/** Bind a parked child to its complete immutable admission without storing credentials. */
export function delegationAdmissionFingerprint(admission: object): string {
    const serialized = JSON.stringify(admission, (_key, value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
        return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    });
    const digest = sha256(new TextEncoder().encode(serialized));
    return `sha256:v1:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Stable identities bind one child position to the originating authority and generation. */
export function delegationChildIdentities(scope: {
    userId: string;
    workspaceId: string;
    parentGenerationId: string;
    callId: string;
    index: number;
}) {
    for (const value of [scope.userId, scope.workspaceId, scope.parentGenerationId, scope.callId]) {
        if (typeof value !== 'string' || !value || value.length > 256)
            throw new Error('Invalid delegation identity scope');
    }
    if (!Number.isInteger(scope.index) || scope.index < 0 || scope.index > 3)
        throw new Error('Invalid delegation child index');
    const bytes = new TextEncoder();
    const derive = (kind: string) => {
        const input = JSON.stringify(['or3-delegation-child-v1', kind, scope.userId, scope.workspaceId,
            scope.parentGenerationId, scope.callId, scope.index]);
        return Array.from(sha256(bytes.encode(input)), byte => byte.toString(16).padStart(2, '0')).join('');
    };
    return {
        admissionId: `delegation-admission-${derive('admission')}`,
        threadId: `delegated-${derive('thread')}`,
        userMessageId: `delegation-user-${derive('user-message')}`,
        assistantMessageId: `delegation-assistant-${derive('assistant-message')}`,
        generationId: `delegation-generation-${derive('generation')}`,
    };
}
