import type {
    ExternalStorageGenerationClaimResult,
    ExternalStorageGenerationCoordinatorV1,
    ExternalStorageGenerationKey,
    ExternalStorageGenerationRecord,
} from './generation-lifecycle';

/** Dormant trusted-server upload contract. No registry or runtime capability
 * selects it. The caller must resolve the current session and authorize the
 * workspace before using owner-bound methods; userId is not client authority.
 * Generation upload credentials must be rejected by legacy mutable-path routes.
 */
export interface ExternalStorageGenerationUploadKey extends ExternalStorageGenerationKey {
    intentId: string;
    userId: string;
}

export interface ExternalStorageGenerationUploadIntent extends ExternalStorageGenerationUploadKey {
    /** Restore reservations reuse an exact verified target and issue no upload
     * credentials. Only upload-origin bindings allocate a new generation. */
    purpose: 'upload' | 'restore';
    storageProviderId: string;
    namespaceId: string;
    storageId: string;
    mimeType: string;
    sizeBytes: number;
    /** Canonical accounting charge, not a reclaimed-disk-byte observation. */
    reservedBytes: number;
    createdAt: number;
    /** Server epoch seconds for credentials, independent of the accounting hold. */
    expiresAt: number;
    state: 'reserved' | 'ready' | 'published_pending_metadata' | 'materialized'
        | 'abandon_claimed' | 'abandoned';
    /** Trusted immutable filesystem readiness identity, never a client proof. */
    readyReceiptId?: string;
    readyAt?: number;
    publishedAt?: number;
    materializedAt?: number;
    claimedAt?: number;
    deletedAt?: number;
    claimId?: string;
}

export type ExternalStorageGenerationUploadClaimKey = ExternalStorageGenerationKey & {
    intentId: string;
    claimId: string;
};

export type ExternalStorageGenerationUploadClaimResult =
    | { status: 'claimed' | 'replayed'; intent: ExternalStorageGenerationUploadIntent }
    | {
        status: 'blocked';
        reason: Extract<ExternalStorageGenerationClaimResult, { status: 'blocked' }>['reason']
            | 'not_ready' | 'not_expired' | 'materialized';
    };

/** Optional extension, independently versioned. Original v1 generation state
 * and deletion authority do not gain an allocated/unverified interpretation.
 * Unsupported runtimes and mixed/missing guards must refuse every operation.
 */
export interface ExternalStorageGenerationUploadCoordinatorV1 extends ExternalStorageGenerationCoordinatorV1 {
    readonly uploadVersion: 1;

    /** Atomically installs a permanent allocation binding and quota hold visible
     * to older quota readers. Pending hashes are fenced against legacy writes.
     * Never silently adopts legacy metadata or replaces an unclaimed head.
     */
    reserveGenerationUpload(input: ExternalStorageGenerationUploadKey & {
        namespaceId: string;
        storageId: string;
        mimeType: string;
        sizeBytes: number;
        expiresInSeconds: number;
        workspaceQuotaBytes?: number;
    }): Promise<{ status: 'reserved' | 'replayed'; intent: ExternalStorageGenerationUploadIntent }>;

    /** Fresh, trusted-server quota admission for a managed metadata restore.
     * Derives immutable target/size from the existing verified upload binding;
     * never uploads bytes, promotes a head or alters sync payload semantics.
     * The existing guarded metadata write atomically transfers this charge.
     * Wiring the authenticated client restore roundtrip is a separate rollout
     * requirement; no existing client/route automatically invokes this method.
     */
    reserveGenerationRestore(input: ExternalStorageGenerationUploadKey & {
        expiresInSeconds: number;
        workspaceQuotaBytes?: number;
    }): Promise<{ status: 'reserved' | 'replayed'; intent: ExternalStorageGenerationUploadIntent }>;

    getGenerationUpload(input: ExternalStorageGenerationUploadKey): Promise<ExternalStorageGenerationUploadIntent | null>;

    /** Records independently verified durable readiness. A late receipt may
     * enable reconciliation but never extends expired upload credentials.
     * Incomplete/pre-ready allocation is not authority to reclaim a slot.
     */
    markGenerationUploadReady(input: ExternalStorageGenerationUploadKey & {
        storageId: string;
        readyReceiptId: string;
    }): Promise<{ status: 'ready' | 'replayed'; intent: ExternalStorageGenerationUploadIntent }>;

    /** Atomically installs verified generation state from server-owned byte
     * verification. The charge persists until exact live canonical metadata
     * transfers it atomically, or a no-reference/no-metadata claim ends it.
     * Token expiry alone cannot release a source-first referenced generation.
     */
    publishGenerationUpload(input: ExternalStorageGenerationUploadKey & {
        storageId: string;
        sizeBytes: number;
        readyReceiptId: string;
    }): Promise<{
        status: 'published' | 'replayed';
        intent: ExternalStorageGenerationUploadIntent;
        generation: ExternalStorageGenerationRecord;
    }>;

    /** Trusted recovery only. Ready unpublished allocations have a distinct
     * abandonment authority; they are never fabricated as verified generations.
     * Published allocations must atomically fence their real generation too.
     */
    claimAbandonedGenerationUpload(input: ExternalStorageGenerationUploadClaimKey & {
        retentionSeconds: number;
    }): Promise<ExternalStorageGenerationUploadClaimResult>;

    /** Exact-claim durable authorization read. Reject unsafe settings, missing
     * guards and outer transactions; only abandon_claimed/abandoned may return.
     * A transaction-local claim must never authorize filesystem unlink.
     */
    getGenerationUploadClaim(input: ExternalStorageGenerationUploadClaimKey): Promise<ExternalStorageGenerationUploadIntent | null>;

    /** Acknowledges independently proved exact ready-payload removal. Never
     * selects bytes or treats a missing/incomplete allocation as removal proof.
     */
    completeGenerationUploadAbandonment(input: ExternalStorageGenerationUploadClaimKey): Promise<{
        status: 'abandoned' | 'replayed';
        intent: ExternalStorageGenerationUploadIntent;
    }>;

    /** Bounded observations, not a deletion candidate authorization. Cursor is
     * opaque and scoped to the workspace. Unknown/pre-ready slots stay retained.
     */
    listGenerationUploadRecovery(input: {
        workspaceId: string;
        cursor?: string;
        limit?: number;
    }): Promise<{ items: ExternalStorageGenerationUploadIntent[]; hasMore: boolean; nextCursor?: string }>;
}
