import { promises as fs } from 'node:fs';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import {
    preflightPluginStateCompatibility,
    type PluginStateCompatibilityPolicy,
    type PluginStatePreflightResult,
} from '../../../shared/plugins/state-compatibility';
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

export type PromotePluginPackageResult =
    | {
          readonly status: 'promoted';
          readonly pointer: PluginPackagePointer;
          readonly evidence: CandidateCanaryEvidence;
      }
    | {
          readonly status: 'blocked';
          readonly stage:
              | 'pointer'
              | 'canary-evidence'
              | 'state'
              | 'migration'
              | 'pointer-write';
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
          readonly stage: 'pointer' | 'state' | 'migration' | 'pointer-write';
          readonly code: string;
          readonly currentPointerUnchanged: true;
          readonly state?: PluginStatePreflightResult;
      };

export interface PromotePluginPackageInput {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly expectedCandidateDigest: Sha256;
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
    readonly now?: () => number;
    readonly faultBeforePointerSwap?: () => void | Promise<void>;
    readonly pointerWriteOptions?: PackagePointerWriteOptions;
}

export interface RollbackPluginPackageInput {
    readonly pluginId: string;
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

    async promote(input: PromotePluginPackageInput): Promise<PromotePluginPackageResult> {
        return this.packages.runPluginOperation(input.pluginId, async () => {
            const pointer = await this.pointers.readPointer(input.pluginId);
            if (!pointer?.candidate) {
                return blockedPromote('pointer', 'candidate-missing');
            }
            if (pointer.candidate.packageDigest !== input.expectedCandidateDigest) {
                return blockedPromote('pointer', 'candidate-digest-mismatch');
            }

            const state = preflightPluginStateCompatibility({
                operation: 'upgrade',
                storedStateVersion: input.storedStateVersion,
                target: pointer.candidate.stateCompatibility,
                current: pointer.current?.stateCompatibility,
            });
            if (state.status === 'blocked') {
                return blockedPromote('state', state.code, state);
            }
            if (state.status === 'migration-required' && !input.migrateState) {
                return blockedPromote('state', 'promotion-migration-required', state);
            }

            let snapshot: CandidateStateValue;
            let snapshotDigest: Sha256;
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
                    `grant-review-${grantReview.status ?? 'invalid'}`,
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
                    evidence.schemaVersion !== 2 ||
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
                        from: pointer.current,
                        to: pointer.candidate,
                        snapshot,
                    });
                }
                await input.faultBeforePointerSwap?.();
            } catch (error) {
                await input.restoreState(snapshot);
                return blockedPromote(
                    'migration',
                    error instanceof Error ? error.message : 'migration-failed',
                    state
                );
            }

            const next: PluginPackagePointer = {
                schemaVersion: 1,
                pluginId: input.pluginId,
                revision: pointer.revision + 1,
                current: {
                    ...pointer.candidate,
                    recordedAt: (input.now ?? Date.now)(),
                },
                candidate: null,
                previous: pointer.current,
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
            const promoted = (): PromotePluginPackageResult =>
                Object.freeze({
                    status: 'promoted',
                    pointer: next,
                    evidence: promotionEvidence,
                });
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
                await input.restoreState(snapshot);
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

            const state = preflightPluginStateCompatibility({
                operation: 'rollback',
                storedStateVersion: input.storedStateVersion,
                target: pointer.previous.stateCompatibility,
                current: pointer.current.stateCompatibility,
            });
            if (state.status === 'blocked') {
                return blockedRollback('state', state.code, state);
            }
            if (state.status === 'migration-required' && !input.migrateState) {
                return blockedRollback('state', 'rollback-migration-required', state);
            }

            const snapshot = structuredClone(await input.snapshotState()) as CandidateStateValue;
            try {
                if (state.status === 'migration-required') {
                    await input.migrateState?.({
                        from: pointer.current,
                        to: pointer.previous,
                        snapshot,
                    });
                }
            } catch (error) {
                await input.restoreState(snapshot);
                return blockedRollback(
                    'migration',
                    error instanceof Error ? error.message : 'migration-failed',
                    state
                );
            }

            const next: PluginPackagePointer = {
                schemaVersion: 1,
                pluginId: input.pluginId,
                revision: pointer.revision + 1,
                current: {
                    ...pointer.previous,
                    recordedAt: (input.now ?? Date.now)(),
                },
                candidate: null,
                previous: pointer.current,
            };
            const rolledBack = (): RollbackPluginPackageResult =>
                Object.freeze({ status: 'rolled-back', pointer: next });
            try {
                await this.pointers.writePointerWithinOperation(
                    input.pluginId,
                    next,
                    input.pointerWriteOptions
                );
            } catch (error) {
                const persisted = await this.pointers.readPointer(input.pluginId).catch(() => null);
                if (pointerWasCommitted(persisted, next)) return rolledBack();
                await input.restoreState(snapshot);
                return blockedRollback(
                    'pointer-write',
                    error instanceof Error ? error.message : 'pointer-write-failed',
                    state
                );
            }

            return rolledBack();
        });
    }
}

export type { PluginStateCompatibilityPolicy };
