import { promises as fs } from 'node:fs';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import {
    preflightPluginStateCompatibility,
    type PluginStateCompatibilityPolicy,
    type PluginStatePreflightResult,
} from '~~/shared/plugins/state-compatibility';
import {
    PluginPackageCandidateCanaryService,
    createCandidateStateSnapshotDigest,
    type CandidateCanaryGrantReview,
    type CandidateCanaryGrantReviewInput,
    type CandidateCanaryEvidence,
    type CandidateStateValue,
} from './package-candidate-canary';
import {
    PluginPackagePointerStore,
    type PluginPackagePointer,
    type PluginPackagePointerTarget,
    type PackagePointerWriteOptions,
} from './package-pointer-store';
import { ImmutablePluginPackageStore } from './package-store';
import { revokeHostActivationsForPlugin } from '../../utils/plugins/isolation/activation-registry';

export type PromotePluginPackageResult =
    | {
          readonly status: 'promoted';
          readonly pointer: PluginPackagePointer;
          readonly evidence: CandidateCanaryEvidence;
          /** True when a prior selection or installation record existed. */
          readonly wasInstalled: boolean;
      }
    | {
          readonly status: 'blocked';
          readonly stage:
              | 'pointer'
              | 'canary-evidence'
              | 'state'
              | 'migration'
              | 'workspaces'
              | 'pointer-write'
              | 'policy';
          readonly code: string;
          readonly currentPointerUnchanged: true;
          readonly state?: PluginStatePreflightResult;
      };

export type RollbackPluginPackageResult =
    | {
          readonly status: 'rolled-back';
          readonly pointer: PluginPackagePointer;
      }
    | {
          readonly status: 'blocked';
          readonly stage: 'pointer' | 'state' | 'migration' | 'workspaces' | 'pointer-write';
          readonly code: string;
          readonly currentPointerUnchanged: true;
          readonly state?: PluginStatePreflightResult;
          readonly blocking?: readonly { readonly workspaceId: string; readonly code: string }[];
      };

export interface PromotePluginPackageInput {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly expectedCandidateDigest: Sha256;
    /** Checked under the package operation lease immediately before promotion. */
    readonly verifySiteApproval?: () => boolean | Promise<boolean>;
    /** Recheck every affected workspace under the package lease just before pointer commit. */
    readonly preflightWorkspaces?: () => Promise<{ readonly blocking: readonly { readonly workspaceId: string; readonly code: string }[] }>;
    readonly storedStateVersion: number | null;
    readonly snapshotState: () => CandidateStateValue | Promise<CandidateStateValue>;
    /** Reads the review that applies to the candidate while its pointer is locked. */
    readonly readGrantReview: (
        input: CandidateCanaryGrantReviewInput
    ) => CandidateCanaryGrantReview | Promise<CandidateCanaryGrantReview>;
    readonly restoreState: (
        snapshot: CandidateStateValue
    ) => void | Promise<void>;
    readonly migrateState?: (input: {
        readonly from: PluginPackagePointerTarget | null;
        readonly to: PluginPackagePointerTarget;
        readonly snapshot: CandidateStateValue;
    }) => void | Promise<void>;
    readonly requireCanaryEvidence?: boolean;
    /** Transfer the operation-owned setup overlay before pointer commit. */
    readonly prepareSetupPromotion?: (input: {
        /** The verified running target (recovered previous included), or null. */
        readonly running: PluginPackagePointerTarget | null;
    }) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
    readonly now?: () => number;
    readonly faultBeforePointerSwap?: () => void | Promise<void>;
    readonly pointerWriteOptions?: PackagePointerWriteOptions;
}

export interface RollbackPluginPackageInput {
    readonly pluginId: string;
    /** HTTP callers require all three expectations from the reviewed impact. */
    readonly expectedCurrentDigest?: Sha256;
    readonly expectedPreviousDigest?: Sha256;
    readonly expectedPointerRevision?: number;
    /** Rechecked under the package operation lock, including before pointer commit. */
    readonly preflightWorkspaces?: (input: {
        readonly current: PluginPackagePointerTarget;
        readonly previous: PluginPackagePointerTarget;
    }) => Promise<{ readonly checked: number; readonly blocking: readonly { readonly workspaceId: string; readonly code: string }[] }>;
    readonly pointerWriteOptions?: PackagePointerWriteOptions;
    readonly storedStateVersion: number | null;
    readonly snapshotState: () => CandidateStateValue | Promise<CandidateStateValue>;
    readonly restoreState: (
        snapshot: CandidateStateValue
    ) => void | Promise<void>;
    readonly migrateState?: (input: {
        readonly from: PluginPackagePointerTarget;
        readonly to: PluginPackagePointerTarget;
        readonly snapshot: CandidateStateValue;
    }) => void | Promise<void>;
    readonly now?: () => number;
}

function blockedPromote(
    stage: Extract<PromotePluginPackageResult, { status: 'blocked' }>['stage'],
    code: string,
    state?: PluginStatePreflightResult
): PromotePluginPackageResult {
    return Object.freeze({
        status: 'blocked',
        stage,
        code,
        currentPointerUnchanged: true,
        ...(state ? { state } : {}),
    });
}

function blockedRollback(
    stage: Extract<RollbackPluginPackageResult, { status: 'blocked' }>['stage'],
    code: string,
    state?: PluginStatePreflightResult
): RollbackPluginPackageResult {
    return Object.freeze({
        status: 'blocked',
        stage,
        code,
        currentPointerUnchanged: true,
        ...(state ? { state } : {}),
    });
}

function pointerWasCommitted(
    persisted: PluginPackagePointer | null,
    expected: PluginPackagePointer
): boolean {
    return persisted !== null && JSON.stringify(persisted) === JSON.stringify(expected);
}

function isCandidateCanaryEvidence(value: unknown): value is CandidateCanaryEvidence {
    if (!value || typeof value !== 'object') return false;
    const evidence = value as Partial<CandidateCanaryEvidence>;
    const validStep = (step: unknown) => {
        if (!step || typeof step !== 'object') return false;
        const status = (step as { status?: unknown }).status;
        return status === 'passed' || status === 'skipped' || status === 'blocked';
    };
    return (
        evidence.schemaVersion === 2 &&
        typeof evidence.pluginId === 'string' &&
        typeof evidence.workspaceId === 'string' &&
        typeof evidence.packageDigest === 'string' &&
        typeof evidence.manifestDigest === 'string' &&
        Number.isSafeInteger(evidence.pointerRevision) &&
        typeof evidence.clientId === 'string' &&
        typeof evidence.stateSnapshotDigest === 'string' &&
        typeof evidence.grantReviewRevision === 'string' &&
        validStep(evidence.server) &&
        validStep(evidence.client) &&
        typeof evidence.completedAt === 'number' &&
        Number.isFinite(evidence.completedAt)
    );
}

/**
 * Promotes a verified candidate to current after canary evidence and state
 * protection. Failures before the pointer swap restore host-managed state.
 */
export class PluginPackagePromotionService {
    constructor(
        readonly packages: ImmutablePluginPackageStore,
        readonly pointers: PluginPackagePointerStore,
        readonly canary: PluginPackageCandidateCanaryService = new PluginPackageCandidateCanaryService(
            packages,
            pointers
        )
    ) {}

    /**
     * Retain a slot reference only while its immutable bytes still verify. A
     * corrupt current version is dropped from the new pointer instead of making
     * the pointer write (which validates every retained slot) impossible.
     * Callers must already hold the package operation lease.
     */
    async #retainVerifiedTarget(
        pluginId: string,
        target: PluginPackagePointerTarget | null
    ): Promise<PluginPackagePointerTarget | null> {
        if (!target) return null;
        try {
            const verification = await this.packages.verifyStoredPackage(
                pluginId,
                target.packageDigest
            );
            return verification.manifestDigest === target.manifestDigest ? target : null;
        } catch {
            return null;
        }
    }

    async promote(input: PromotePluginPackageInput): Promise<PromotePluginPackageResult> {
        return this.packages.runPluginOperation(input.pluginId, async () => {
            const pointer = await this.pointers.readPointer(input.pluginId);
            if (!pointer?.candidate) {
                return blockedPromote('pointer', 'candidate-missing');
            }
            if (pointer.candidate.packageDigest !== input.expectedCandidateDigest) {
                return blockedPromote('pointer', 'candidate-digest-mismatch');
            }
            if (input.verifySiteApproval) {
                const approved = await Promise.resolve().then(input.verifySiteApproval).catch(() => false);
                if (!approved) return blockedPromote('policy', 'site-approval-required');
            }

            // The verified running selection is the authority for compatibility,
            // inheritance and the retained rollback target. With a corrupt
            // current and a valid previous the runtime runs the previous, so
            // raw slot reads would compare and retain the wrong version.
            const startup = await this.pointers
                .readStartupSelection(input.pluginId)
                .catch(() => null);
            const running = startup?.selected ?? null;

            const state = preflightPluginStateCompatibility({
                operation: 'upgrade',
                storedStateVersion: input.storedStateVersion,
                target: pointer.candidate.stateCompatibility,
                current: running?.stateCompatibility,
            });
            if (state.status === 'blocked') {
                return blockedPromote('state', state.code, state);
            }
            if (state.status === 'migration-required' && !input.migrateState) {
                return blockedPromote('state', 'promotion-migration-required', state);
            }

            let snapshot: CandidateStateValue;
            let snapshotDigest: Sha256;
            let undoSetupPromotion: (() => void | Promise<void>) | undefined;
            const rollbackSetupPromotion = async (): Promise<boolean> => {
                try {
                    await undoSetupPromotion?.();
                    return true;
                } catch {
                    // The pointer is still unchanged; keep the original
                    // promotion failure visible and let the next lifecycle
                    // attempt revalidate the digest-scoped record.
                    return false;
                }
            };
            try {
                snapshot = structuredClone(await input.snapshotState()) as CandidateStateValue;
                snapshotDigest = createCandidateStateSnapshotDigest(snapshot);
            } catch {
                return blockedPromote('state', 'state-snapshot-invalid', state);
            }

            let grantReview: CandidateCanaryGrantReview;
            try {
                grantReview = await input.readGrantReview(
                    Object.freeze({
                        pluginId: input.pluginId,
                        packageDigest: pointer.candidate.packageDigest,
                        manifestDigest: pointer.candidate.manifestDigest,
                    })
                );
            } catch {
                return blockedPromote('canary-evidence', 'grant-review-unavailable', state);
            }
            if (
                grantReview.status !== 'current' ||
                typeof grantReview.revision !== 'string' ||
                grantReview.revision.length === 0
            ) {
                return blockedPromote(
                    'canary-evidence',
                    `grant-review-${grantReview.status}`,
                    state
                );
            }

            const requireEvidence = input.requireCanaryEvidence !== false;
            let evidence: CandidateCanaryEvidence | null = null;
            if (requireEvidence) {
                let path: string;
                try {
                    path = this.canary.evidencePath(
                        input.pluginId,
                        input.expectedCandidateDigest,
                        input.workspaceId
                    );
                } catch {
                    return blockedPromote('canary-evidence', 'canary-evidence-invalid', state);
                }
                try {
                    const parsed: unknown = JSON.parse(await fs.readFile(path, 'utf8'));
                    if (!isCandidateCanaryEvidence(parsed)) {
                        return blockedPromote(
                            'canary-evidence',
                            'canary-evidence-invalid',
                            state
                        );
                    }
                    evidence = parsed;
                } catch {
                    return blockedPromote('canary-evidence', 'canary-evidence-missing', state);
                }
                if (
                    (evidence.schemaVersion as unknown) !== 2 ||
                    evidence.pluginId !== input.pluginId ||
                    evidence.workspaceId !== input.workspaceId ||
                    evidence.packageDigest !== input.expectedCandidateDigest ||
                    evidence.manifestDigest !== pointer.candidate.manifestDigest ||
                    evidence.pointerRevision !== pointer.revision ||
                    evidence.stateSnapshotDigest !== snapshotDigest ||
                    evidence.grantReviewRevision !== grantReview.revision ||
                    evidence.server.status === 'blocked' ||
                    evidence.client.status === 'blocked'
                ) {
                    return blockedPromote('canary-evidence', 'canary-evidence-invalid', state);
                }
            }

            try {
                if (state.status === 'migration-required') {
                    await input.migrateState?.({
                        from: running ?? pointer.current,
                        to: pointer.candidate,
                        snapshot,
                    });
                }
                undoSetupPromotion =
                    (await input.prepareSetupPromotion?.({ running })) ?? undefined;
                await input.faultBeforePointerSwap?.();
            } catch (error) {
                if (!(await rollbackSetupPromotion())) {
                    return blockedPromote('migration', 'setup-promotion-rollback-failed', state);
                }
                if (state.status === 'migration-required') await input.restoreState(snapshot);
                return blockedPromote(
                    'migration',
                    error instanceof Error ? error.message : 'migration-failed',
                    state
                );
            }

            if (input.preflightWorkspaces) {
                let blocker: string | null = null;
                try {
                    const review = await input.preflightWorkspaces();
                    if (review.blocking.length > 0) blocker = 'workspace-preflight-blocked';
                } catch { blocker = 'workspace-preflight-unavailable'; }
                if (blocker) {
                    if (!(await rollbackSetupPromotion())) return blockedPromote('workspaces', 'setup-promotion-rollback-failed', state);
                    if (state.status === 'migration-required') await input.restoreState(snapshot);
                    return blockedPromote('workspaces', blocker, state);
                }
            }

            // Setup configuration is stored per package digest, so swapping the
            // pointer is the commit: the promoted digest already owns the
            // settings prepared for it, and a failure before this point leaves
            // the running version's document untouched. The pointer write itself
            // is revision-checked and atomic. A recovered previous is the
            // verified running version, so it becomes the rollback target
            // instead of the unreadable current slot.
            const retainedPrevious = await this.#retainVerifiedTarget(
                input.pluginId,
                running ?? pointer.current
            );
            const next: PluginPackagePointer = {
                schemaVersion: 1,
                pluginId: input.pluginId,
                revision: pointer.revision + 1,
                current: {
                    ...pointer.candidate,
                    recordedAt: (input.now ?? Date.now)(),
                },
                candidate: null,
                previous: retainedPrevious,
            };
            const promotionEvidence =
                evidence ??
                ({
                    schemaVersion: 2,
                    pluginId: input.pluginId,
                    workspaceId: input.workspaceId,
                    packageDigest: input.expectedCandidateDigest,
                    manifestDigest: pointer.candidate.manifestDigest,
                    pointerRevision: pointer.revision,
                    clientId: 'evidence-skipped',
                    stateSnapshotDigest: snapshotDigest,
                    grantReviewRevision: grantReview.revision,
                    server: { status: 'skipped' },
                    client: { status: 'skipped' },
                    completedAt: (input.now ?? Date.now)(),
                } satisfies CandidateCanaryEvidence);
            const wasInstalled = pointer.current !== null || pointer.previous !== null;
            const promoted = (): PromotePluginPackageResult => {
                // Lifecycle commit hook: the selected package changed, so live
                // handles sealed to the old digest are revoked here — at the
                // commit point every caller shares — and their in-flight calls
                // are aborted instead of finishing on superseded bytes.
                revokeHostActivationsForPlugin(input.pluginId, 'selected-package-changed');
                return Object.freeze({
                    status: 'promoted',
                    pointer: next,
                    evidence: promotionEvidence,
                    wasInstalled,
                });
            };
            try {
                await this.pointers.writePointerWithinOperation(
                    input.pluginId,
                    next,
                    input.pointerWriteOptions
                );
            } catch (error) {
                const persisted = await this.pointers.readPointer(input.pluginId).catch(() => null);
                // rename(2) is the pointer commit point. A later fsync/fault
                // must not restore old settings while the new package is live.
                if (pointerWasCommitted(persisted, next)) return promoted();
                if (!(await rollbackSetupPromotion())) {
                    return blockedPromote('pointer-write', 'setup-promotion-rollback-failed', state);
                }
                if (state.status === 'migration-required') await input.restoreState(snapshot);
                return blockedPromote(
                    'pointer-write',
                    error instanceof Error ? error.message : 'pointer-write-failed',
                    state
                );
            }

            return promoted();
        });
    }

    async rollback(input: RollbackPluginPackageInput): Promise<RollbackPluginPackageResult> {
        return this.packages.runPluginOperation(input.pluginId, async () => {
            const pointer = await this.pointers.readPointer(input.pluginId);
            if (!pointer?.current || !pointer.previous) {
                return blockedRollback('pointer', 'previous-missing');
            }
            if ((input.expectedCurrentDigest && pointer.current.packageDigest !== input.expectedCurrentDigest) ||
                (input.expectedPreviousDigest && pointer.previous.packageDigest !== input.expectedPreviousDigest) ||
                (input.expectedPointerRevision !== undefined && pointer.revision !== input.expectedPointerRevision)) {
                return blockedRollback('pointer', 'pointer-changed');
            }

            // The rollback target must still verify before it can be committed;
            // otherwise the pointer write would fail after the state preflight.
            try {
                const verification = await this.packages.verifyStoredPackage(
                    input.pluginId,
                    pointer.previous.packageDigest
                );
                if (verification.manifestDigest !== pointer.previous.manifestDigest) {
                    return blockedRollback('pointer', 'previous-unavailable');
                }
            } catch {
                return blockedRollback('pointer', 'previous-unavailable');
            }

            if (input.preflightWorkspaces && pointer.current.stateCompatibility.rollback !== 'safe') {
                return blockedRollback('state', pointer.current.stateCompatibility.rollback === 'unsupported'
                    ? 'rollback-unsupported' : 'rollback-migration-required');
            }

            const preflight = async (): Promise<RollbackPluginPackageResult | null> => {
                if (!input.preflightWorkspaces) return null;
                try {
                    const result = await input.preflightWorkspaces({ current: pointer.current!, previous: pointer.previous! });
                    return result.blocking.length
                        ? { status: 'blocked', stage: 'workspaces', code: 'workspace-preflight-blocked',
                            currentPointerUnchanged: true, blocking: result.blocking }
                        : null;
                } catch {
                    return blockedRollback('workspaces', 'workspace-preflight-unavailable');
                }
            };
            const initialPreflight = await preflight();
            if (initialPreflight) return initialPreflight;

            // The HTTP rollback path validates every enabled workspace inside
            // preflightWorkspaces. Its initiating admin workspace may be disabled
            // and must not become an unrelated state gate or mutation target.
            const state = input.preflightWorkspaces ? null : preflightPluginStateCompatibility({
                operation: 'rollback',
                storedStateVersion: input.storedStateVersion,
                target: pointer.previous.stateCompatibility,
                current: pointer.current.stateCompatibility,
            });
            if (state?.status === 'blocked') {
                return blockedRollback('state', state.code, state);
            }
            if (state?.status === 'migration-required' && !input.migrateState) {
                return blockedRollback('state', 'rollback-migration-required', state);
            }

            const snapshot = state ? structuredClone(await input.snapshotState()) as CandidateStateValue : null;
            try {
                if (state?.status === 'migration-required' && snapshot !== null) {
                    await input.migrateState?.({
                        from: pointer.current,
                        to: pointer.previous,
                        snapshot,
                    });
                }
            } catch (error) {
                if (snapshot !== null) await input.restoreState(snapshot);
                return blockedRollback(
                    'migration',
                    error instanceof Error ? error.message : 'migration-failed',
                    state ?? undefined
                );
            }

            // Recovery commits the verified previous target and removes a
            // broken current reference instead of retaining it as previous
            // (which the pointer write validates and would reject).
            const retainedPrevious = await this.#retainVerifiedTarget(
                input.pluginId,
                pointer.current
            );
            const next: PluginPackagePointer = {
                schemaVersion: 1,
                pluginId: input.pluginId,
                revision: pointer.revision + 1,
                current: {
                    ...pointer.previous,
                    recordedAt: (input.now ?? Date.now)(),
                },
                candidate: null,
                previous: retainedPrevious,
            };
            const finalPreflight = await preflight();
            if (finalPreflight) {
                if (state?.status === 'migration-required' && snapshot !== null) await input.restoreState(snapshot);
                return finalPreflight;
            }
            const rolledBack = (): RollbackPluginPackageResult => {
                // Same lifecycle commit hook as promotion: a rollback also
                // swaps the live bytes and state, so stale handles must fail
                // closed instead of finishing on the superseded selection.
                revokeHostActivationsForPlugin(input.pluginId, 'selected-package-rolled-back');
                return Object.freeze({ status: 'rolled-back', pointer: next });
            };
            try {
                await this.pointers.writePointerWithinOperation(
                    input.pluginId,
                    next,
                    input.pointerWriteOptions
                );
            } catch (error) {
                const persisted = await this.pointers.readPointer(input.pluginId).catch(() => null);
                if (pointerWasCommitted(persisted, next)) return rolledBack();
                if (state?.status === 'migration-required' && snapshot !== null) await input.restoreState(snapshot);
                return blockedRollback(
                    'pointer-write',
                    error instanceof Error ? error.message : 'pointer-write-failed',
                    state ?? undefined
                );
            }

            return rolledBack();
        });
    }
}

export type { PluginStateCompatibilityPolicy };
