import { randomURLSecret } from './crypto';
import { reconcileClaimedConnectEnvironment } from './lifecycle';
import { requireConnectStore } from './store/require';
import {
    CONNECT_LIFECYCLE_CLAIM_MS,
    type ConnectEnvironmentScope,
} from './store/types';

export type ConnectRevocationResult =
    | 'revoked'
    | 'in_progress'
    | 'not_found';

export async function revokeConnectEnvironment(
    environmentId: string,
    scope: ConnectEnvironmentScope,
    encryptionKey: string,
    store = requireConnectStore()
): Promise<ConnectRevocationResult> {
    const now = Date.now();
    const claimToken = randomURLSecret(24);
    const claim = await store.beginEnvironmentRevocation({
        environmentId,
        scope,
        claimToken,
        claimUntil: now + CONNECT_LIFECYCLE_CLAIM_MS,
        now,
    });
    if (!claim) return 'not_found';
    if (claim.environment.status === 'revoked') return 'revoked';
    if (!claim.claimed) return 'in_progress';

    await reconcileClaimedConnectEnvironment(
        claim.environment,
        claimToken,
        { encryptionKey, store }
    );
    return 'revoked';
}
