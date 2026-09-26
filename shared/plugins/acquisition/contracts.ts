/**
 * @module shared/plugins/acquisition/contracts
 *
 * Purpose:
 * The shape of one durable plugin acquisition: which release was requested, who
 * asked for it, which instance and workspace it targets, how far the pipeline
 * got, and how it ended. One record is what makes retry, cancel, status and
 * crash recovery possible without guessing from the filesystem.
 *
 * Behavior:
 * - Stages are ordered and may only advance; a resumed operation continues from
 *   the recorded stage rather than restarting from the beginning.
 * - A terminal record is immutable: a retry creates a new attempt on the same
 *   record, and a completed operation can never be re-run silently.
 * - Nothing here touches the filesystem or the network (see the server-side
 *   operation store and acquisition service).
 *
 * Constraints:
 * - No secrets, credentials or signed download URLs are retained in a record.
 *
 * Non-Goals:
 * - Pointer, candidate, promotion and lifecycle mechanics (they already exist and
 *   are wrapped, never duplicated, by the acquisition service).
 */

import type { Sha256 } from '../runtime-descriptor';
import type { EffectiveAuthority } from '../authority/effective-authority';

/** Ordered pipeline stages, from request to receipt. */
export const PLUGIN_ACQUISITION_STAGES = [
    'requested',
    'resolved',
    'authorized',
    'reserved',
    'downloaded',
    'verified',
    'candidate-recorded',
    'health-checked',
    'promoted',
    'receipt-recorded',
] as const;

export type PluginAcquisitionStage = (typeof PLUGIN_ACQUISITION_STAGES)[number];

/**
 * `paused` is the deliberate stop for a first install whose package needs setup:
 * the candidate is recorded and the operation waits for the user, rather than
 * reporting a success the plugin cannot yet deliver.
 */
export type PluginAcquisitionPhase = 'pending' | 'running' | 'paused';
export type PluginAcquisitionTerminal = 'completed' | 'failed' | 'canceled' | 'blocked';
export type PluginAcquisitionStatus = PluginAcquisitionPhase | PluginAcquisitionTerminal;

export const PLUGIN_ACQUISITION_FAILURE_CODES = [
    'already-installed',
    'grant-review-required',
    'registry-unconfigured',
    'registry-unreachable',
    'release-not-found',
    'release-metadata-invalid',
    'release-metadata-unsigned',
    'release-key-untrusted',
    'release-identity-mismatch',
    'release-digest-mismatch',
    'release-profile-unsupported',
    'release-expired',
    'release-engine-unsupported',
    'catalog-stale',
    'advisory-stale',
    'advisory-unverified',
    'release-quarantined',
    'download-url-invalid',
    'download-url-expired',
    'coverage-required',
    'coverage-denied',
    'link-expired',
    'library-unavailable',
    'download-over-limit',
    'download-failed',
    'storage-unavailable',
    'archive-digest-mismatch',
    'package-verification-failed',
    'package-policy-mismatch',
    'package-profile-mismatch',
    'authority-mismatch',
    'client-canary-pending',
    'candidate-blocked',
    'workspace-preflight-blocked',
    'health-check-failed',
    'pointer-conflict',
    'promotion-blocked',
    'setup-required',
    'operation-conflict',
    'canceled',
    'internal-error',
] as const;

export type PluginAcquisitionFailureCode = (typeof PLUGIN_ACQUISITION_FAILURE_CODES)[number];

export interface PluginAcquisitionFailure {
    readonly code: PluginAcquisitionFailureCode;
    readonly stage: PluginAcquisitionStage;
    readonly message: string;
    /** True when retrying the same operation can make progress. */
    readonly retryable: boolean;
}

export interface PluginAcquisitionReleaseIdentity {
    readonly releaseId: string;
    readonly pluginId: string;
    readonly version: string;
    readonly archiveSha256: Sha256;
    readonly packageTreeSha256: Sha256;
    readonly manifestSha256: Sha256;
    readonly authoritySha256: Sha256;
    /** Comprehensive signed authority; absent on legacy releases. */
    readonly authority?: EffectiveAuthority;
    readonly profile: string;
    readonly sourceSha256: Sha256;
    readonly license: string;
    readonly publishedAt: string;
}

/** Structured, signed provenance returned for a covered Library acquisition. */
export interface PluginAcquisitionReceipt {
    readonly payload: {
        readonly schemaVersion: 1;
        readonly receiptId: string;
        readonly marketplaceUserId: string;
        readonly release: {
            readonly releaseId: string;
            readonly pluginId: string;
            readonly version: string;
            readonly archiveSha256: Sha256;
            readonly packageTreeSha256: Sha256 | null;
            readonly manifestSha256: Sha256 | null;
            readonly authoritySha256: Sha256 | null;
        };
        readonly coverage: {
            readonly kind: 'update-pass' | 'plus';
            readonly grantId: string;
            readonly until: string;
        };
        readonly issuedAt: string;
    };
    readonly algorithm: 'ed25519';
    readonly keyId: string;
    readonly signature: string;
}

export interface PluginAcquisitionOperation {
    readonly schemaVersion: 1;
    readonly operationId: string;
    /** Store revision; every persisted change advances it by exactly one. */
    readonly revision: number;
    readonly pluginId: string;
    readonly version: string;
    /** Acting workspace for the request; the pointer change is instance-wide. */
    readonly workspaceId: string;
    readonly requesterUserId: string;
    /** Local Chat user whose workspace connections satisfy candidate setup. */
    readonly setupOwnerUserId?: string;
    /** A buyer-approved exact-release request; identity only, never a credential. */
    readonly libraryGrant?: {
        readonly requestId: string;
        readonly buyerUserId: string;
        readonly linkId: string;
        readonly accountId: string;
        readonly releaseId: string;
        readonly archiveSha256: string;
    };
    /** Target instance, so an operation cannot be replayed against another host. */
    readonly instanceId: string;
    readonly release: PluginAcquisitionReleaseIdentity;
    readonly stage: PluginAcquisitionStage;
    readonly status: PluginAcquisitionStatus;
    readonly failure: PluginAcquisitionFailure | null;
    /** Candidate recorded in the pointer, when one has been recorded. */
    readonly candidateDigest: Sha256 | null;
    /**
     * Pointer revision the promotion expects. Recorded when the candidate is
     * recorded, so a racing admin or a later pointer write blocks promotion
     * instead of overwriting the winner.
     */
    readonly expectedPointerRevision: number | null;
    /** Setup revision (or null when the package declares no setup). */
    readonly setupRevision: number | null;
    /** Authority hash the candidate was reviewed against. */
    readonly authoritySha256: Sha256;
    /** Highest advisory sequence accepted at resolve time (rollback guard). */
    readonly acceptedAdvisorySequence: number;
    /**
     * Highest security-state revision accepted at resolve time. The revision is
     * the snapshot identity, so a resume compares it together with the digest
     * rather than sequence alone.
     */
    readonly acceptedSecurityRevision?: number;
    /** Fresh signed checkpoint that authorized the recorded release. */
    readonly advisoryCheckpointSha256?: Sha256 | null;
    readonly advisoryCheckpointIssuedAt?: string | null;
    readonly advisoryCheckpointExpiresAt?: number | null;
    /** Provenance for a covered artifact; credentials and URLs are never stored. */
    readonly acquisitionReceipt?: PluginAcquisitionReceipt | null;
    readonly acquisitionSource?: 'public' | 'library' | null;
    /** Bytes staged so far, so a resume does not restart the download. */
    readonly downloadedBytes: number;
    /** Staging object, when it is still needed to resume. */
    readonly stagingObject: string | null;
    /** When the signed download URL became unusable, if that is known. */
    readonly downloadUrlExpiresAt: number | null;
    /** Attempts made; a retry increases it and clears terminal failure state. */
    readonly attempts: number;
    /** Set by cancel; the pipeline must stop before the next side effect. */
    readonly cancelRequested: boolean;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly completedAt: number | null;
}

export const TERMINAL_ACQUISITION_STATUSES: readonly PluginAcquisitionTerminal[] = [
    'completed',
    'failed',
    'canceled',
    'blocked',
];

export function isTerminalAcquisitionStatus(
    status: PluginAcquisitionStatus
): status is PluginAcquisitionTerminal {
    return (TERMINAL_ACQUISITION_STATUSES as readonly string[]).includes(status);
}

export function isActiveAcquisitionStatus(status: PluginAcquisitionStatus): boolean {
    return status === 'pending' || status === 'running' || status === 'paused';
}

/** Stage order index, used to refuse an operation that would move backwards. */
export function acquisitionStageIndex(stage: PluginAcquisitionStage): number {
    return PLUGIN_ACQUISITION_STAGES.indexOf(stage);
}

/**
 * Whether an operation at `from` may advance to `to`. Equal or later stages are
 * allowed (a resumed run re-enters the stage it recorded), earlier ones are not:
 * a recorded `verified` must never fall back to `downloaded` on a retry.
 */
export function canAdvanceAcquisitionStage(
    from: PluginAcquisitionStage,
    to: PluginAcquisitionStage
): boolean {
    return acquisitionStageIndex(to) >= acquisitionStageIndex(from);
}

/**
 * The stage work must resume from. A download that was interrupted resumes at
 * `reserved` (the artifact is re-fetched or continued into staging); everything
 * later resumes at its own recorded stage.
 */
export function resumeStageFor(operation: PluginAcquisitionOperation): PluginAcquisitionStage {
    if (operation.stage === 'downloaded' && operation.downloadedBytes === 0) {
        return 'reserved';
    }
    return operation.stage;
}

/** Whether an interrupted download may continue from the staged bytes. */
export function shouldResumeDownload(operation: PluginAcquisitionOperation): boolean {
    return (
        operation.stage === 'downloaded' &&
        operation.downloadedBytes > 0 &&
        operation.stagingObject !== null &&
        operation.downloadUrlExpiresAt !== null &&
        operation.downloadUrlExpiresAt > Date.now()
    );
}

export interface AcquisitionStatusView {
    readonly operationId: string;
    readonly pluginId: string;
    /** The workspace this operation installs into. */
    readonly workspaceId: string;
    readonly version: string;
    readonly stage: PluginAcquisitionStage;
    readonly status: PluginAcquisitionStatus;
    readonly percentComplete: number;
    readonly needsSetup: boolean;
    /** An unfinished operation this caller can pick up again from its stage. */
    readonly resumable: boolean;
    readonly interrupted?: boolean;
    readonly retryable: boolean;
    readonly canceled: boolean;
    /** Exact selected identity, so the client can bind confirmation to these bytes. */
    readonly release: {
        readonly releaseId: string;
        readonly archiveSha256: Sha256;
        readonly packageTreeSha256: Sha256;
        readonly manifestSha256: Sha256;
        readonly authoritySha256: Sha256;
    };
    readonly failure: PluginAcquisitionFailure | null;
    readonly updatedAt: number;
}

/**
 * A status the dashboard can render without knowing the pipeline: the percentage
 * is stage-based, `needsSetup` is the paused first-install stop, and `resumable`
 * says the operation is waiting on the caller rather than dead.
 */
export function describeAcquisitionStatus(
    operation: PluginAcquisitionOperation,
    interrupted = false
): AcquisitionStatusView {
    const total = PLUGIN_ACQUISITION_STAGES.length - 1;
    const index = acquisitionStageIndex(operation.stage);
    return {
        operationId: operation.operationId,
        pluginId: operation.pluginId,
        workspaceId: operation.workspaceId,
        version: operation.version,
        stage: operation.stage,
        status: operation.status,
        percentComplete: total === 0 ? 100 : Math.round((index / total) * 100),
        needsSetup: operation.status === 'paused' && operation.failure?.code === 'setup-required',
        resumable: !operation.cancelRequested && (interrupted || operation.status === 'paused'),
        interrupted,
        // A paused operation carries a retryable pause failure (for example
        // `setup-required`); hiding Retry behind the failed/blocked statuses
        // left the operator with a durable operation and no way to continue it.
        retryable:
            !operation.cancelRequested && (interrupted || (operation.failure?.retryable === true &&
            (operation.status === 'failed' ||
                operation.status === 'blocked' ||
                operation.status === 'paused'))),
        canceled: operation.status !== 'completed' && (operation.cancelRequested || operation.status === 'canceled'),
        release: {
            releaseId: operation.release.releaseId,
            archiveSha256: operation.release.archiveSha256,
            packageTreeSha256: operation.release.packageTreeSha256,
            manifestSha256: operation.release.manifestSha256,
            authoritySha256: operation.release.authoritySha256,
        },
        failure: operation.failure,
        updatedAt: operation.updatedAt,
    };
}
