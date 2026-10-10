/**
 * Dormant, trusted-server contract for external immutable blob generations.
 * This is not a public request payload or permission to delete bytes. Callers
 * must authenticate/authorize the workspace and independently verify uploaded
 * bytes before registration. No provider currently advertises this capability.
 *
 * Native Convex deletionCoordination is a separate contract. External cleanup
 * remains disabled until canonical writers, upload publication, immutable
 * filesystem targets and crash/retry behavior are all qualified together.
 */
export interface ExternalStorageGenerationKey {
    workspaceId: string;
    /** Canonical SHA-256 digest; providers must validate and normalize aliases. */
    hash: string;
    /** Never reused, including after deletion. */
    generationId: string;
}

export interface ExternalStorageGenerationRecord extends ExternalStorageGenerationKey {
    /** Immutable, provider-owned target. Never taken from a cleanup caller. */
    storageId: string;
    sizeBytes: number;
    state: 'verified' | 'claimed' | 'deleted';
    /** Server epoch seconds, not client metadata timestamps. */
    createdAt: number;
    /** Canonical writes/removals restart retention under the same DB lock. */
    lastActivityAt: number;
    claimId?: string;
    claimedAt?: number;
    deletedAt?: number;
}

export type ExternalStorageGenerationClaimResult =
    | { status: 'claimed' | 'replayed'; generation: ExternalStorageGenerationRecord }
    | {
        status: 'blocked';
        reason: 'not_current' | 'in_use' | 'unknown_references' | 'active_upload'
            | 'claim_conflict' | 'missing' | 'retention' | 'proof_incomplete';
    };

export interface ExternalStorageGenerationCoordinatorV1 {
    readonly version: 1;
    readonly storageProviderId: string;

    /** Trusted publication receipt only, after independent byte verification.
     * Must reject legacy adoption and identity reuse. A replacement uses a new
     * generation; it never makes a claimed generation writable again.
     */
    registerVerifiedGeneration(
        input: ExternalStorageGenerationKey & { storageId: string; sizeBytes: number },
    ): Promise<{ status: 'registered' | 'replayed'; generation: ExternalStorageGenerationRecord }>;

    /** Destructive callers may use a claimed/deleted record as authority, so
     * this must observe durably committed state on a qualified connection.
     * Reject an enclosing transaction, unsafe durability, or missing guards;
     * never expose a transaction-local claim that can subsequently roll back.
     */
    getGeneration(input: ExternalStorageGenerationKey): Promise<ExternalStorageGenerationRecord | null>;

    /** Atomically proves retention, no live metadata/references and no active
     * upload before recording an irreversible generation-specific barrier.
     * Malformed or over-budget reference state must block, never imply absence.
     * Worker leases may change ownership but cannot release this barrier.
     */
    claimGeneration(
        input: ExternalStorageGenerationKey & { claimId: string; retentionSeconds: number },
    ): Promise<ExternalStorageGenerationClaimResult>;

    /** Acknowledgement of independently verified exact-generation removal.
     * Idempotent for the same durable claim; never deletes or selects bytes.
     * Future filesystem integration must prove removal cannot be undone by a
     * delayed publisher/allocator before calling this method.
     */
    completeDeletion(
        input: ExternalStorageGenerationKey & { claimId: string },
    ): Promise<{ status: 'deleted' | 'replayed'; generation: ExternalStorageGenerationRecord }>;
}
