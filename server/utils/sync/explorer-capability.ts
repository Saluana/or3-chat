import { createHash } from 'node:crypto';
import { createError } from 'h3';
import { EXPLORER_CAPABILITY, explorerIdentityMatches, explorerMutationIdentity,
    hasExplorerSemantics } from '~~/shared/explorer/sync-contract';

export function requireExplorerCapability(capability: unknown): void {
    if (capability === EXPLORER_CAPABILITY) return;
    throw createError({ statusCode: 426, statusMessage: 'Update OR3 Chat to sync workspace folders',
        data: { code: 'OR3_EXPLORER_UPDATE_REQUIRED', requiredCapability: EXPLORER_CAPABILITY } });
}

export function checkExplorerPage(capability: unknown, ...pages: ReadonlyArray<
    readonly { tableName: string; pk: string; payload?: unknown }[]
>): void {
    if (pages.some(page => page.some(row => hasExplorerSemantics(row.tableName, row.pk, row.payload)))) {
        requireExplorerCapability(capability);
    }
}

export function validateExplorerOperation(op: {tableName: string; pk: string; operation: 'put' | 'delete'; payload?: unknown}) {
    const identity = explorerMutationIdentity(op.tableName, op.pk, op.operation, op.payload);
    const incoming = identity.incoming;
    if (!identity.valid || (incoming && !explorerIdentityMatches(op.pk, incoming,
        incoming.hashInput && createHash('sha256').update(incoming.hashInput).digest('hex')))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid workspace folder record' });
    }
}
