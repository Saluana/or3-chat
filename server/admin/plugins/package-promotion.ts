import { promises as fs } from 'node:fs';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import {
    preflightPluginStateCompatibility,
    type PluginStateCompatibilityPolicy,
    type PluginStatePreflightResult,
} from '../../../shared/plugins/state-compatibility';
import {
    PluginPackageCandidateCanaryService,
    type CandidateCanaryEvidence,
    type CandidateStateValue,
} from './package-candidate-canary';
import {
    PluginPackagePointerStore,
    type PluginPackagePointer,
    type PluginPackagePointerTarget,
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
    readonly expectedCandidateDigest: Sha256;
    readonly storedStateVersion: number | null;
    readonly snapshotState: () => CandidateStateValue | Promise<CandidateStateValue>;
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
}

export interface RollbackPluginPackageInput {
    readonly pluginId: string;
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

            const requireEvidence = input.requireCanaryEvidence !== false;
            let evidence: CandidateCanaryEvidence | null = null;
            if (requireEvidence) {
                const path = this.canary.evidencePath(
                    input.pluginId,
                    input.expectedCandidateDigest
                );
                try {
                    evidence = JSON.parse(await fs.readFile(path, 'utf8')) as CandidateCanaryEvidence;
                } catch {
                    return blockedPromote('canary-evidence', 'canary-evidence-missing');
                }
                if (
                    evidence.pluginId !== input.pluginId ||
                    evidence.packageDigest !== input.expectedCandidateDigest ||
                    evidence.manifestDigest !== pointer.candidate.manifestDigest ||
                    evidence.server.status === 'blocked' ||
                    evidence.client.status === 'blocked'
                ) {
                    return blockedPromote('canary-evidence', 'canary-evidence-invalid');
                }
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

            const snapshot = structuredClone(await input.snapshotState()) as CandidateStateValue;
            try {
                if (state.status === 'migration-required' || input.migrateState) {
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
            try {
                await this.pointers.writePointerWithinOperation(input.pluginId, next);
            } catch (error) {
                await input.restoreState(snapshot);
                return blockedPromote(
                    'pointer-write',
                    error instanceof Error ? error.message : 'pointer-write-failed',
                    state
                );
            }

            return Object.freeze({
                status: 'promoted',
                pointer: next,
                evidence:
                    evidence ??
                    ({
                        schemaVersion: 1,
                        pluginId: input.pluginId,
                        packageDigest: input.expectedCandidateDigest,
                        manifestDigest: pointer.candidate.manifestDigest,
                        pointerRevision: pointer.revision,
                        clientId: 'evidence-skipped',
                        stateSnapshotDigest: `sha256-${'0'.repeat(64)}` as Sha256,
                        server: { status: 'skipped' },
                        client: { status: 'skipped' },
                        completedAt: (input.now ?? Date.now)(),
                    } satisfies CandidateCanaryEvidence),
            });
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
            try {
                await this.pointers.writePointerWithinOperation(input.pluginId, next);
            } catch (error) {
                await input.restoreState(snapshot);
                return blockedRollback(
                    'pointer-write',
                    error instanceof Error ? error.message : 'pointer-write-failed',
                    state
                );
            }

            return Object.freeze({ status: 'rolled-back', pointer: next });
        });
    }
}

export type { PluginStateCompatibilityPolicy };
