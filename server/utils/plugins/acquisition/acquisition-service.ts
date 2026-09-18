/**
 * @module server/utils/plugins/acquisition/acquisition-service
 *
 * Purpose:
 * The reviewed acquisition pipeline: turn a request for a registry release into a
 * verified candidate, a completed health check and a conditional promotion, with
 * every step recorded so a crash, a cancel or an expired download resumes from
 * evidence rather than from guesses.
 *
 * Behavior:
 * - Resolution is read-only and happens before the durable record exists; from
 *   `resolved` onward every stage is recorded and resumable under one operation id.
 * - The pipeline wraps the existing candidate, canary, promotion, pointer, lock
 *   and lifecycle services. It never installs bytes itself and never writes a
 *   pointer except through them.
 * - Instance-wide updates require every enabled workspace to pass the same
 *   preflight; a blocking workspace keeps the update `blocked` until an owner
 *   disables it, and no grant is ever widened on a workspace's behalf.
 * - A first install whose package declares setup pauses at `paused` /
 *   `setup-required` after the candidate is recorded, instead of reporting an
 *   activation the plugin cannot yet deliver.
 *
 * Constraints:
 * - No plugin code runs in the pipeline; the server candidate dry run is the only
 *   thing that reads package modules, and it is the existing host verifier.
 * - Signed URLs and credentials are never persisted on the operation record.
 *
 * Non-Goals:
 * - Raw-ZIP owner uploads (separately gated) and the dashboard UI.
 */

import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { readPackageZip } from '@or3/plugin-sdk/package-archive';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import type { WorkspaceSettingsStore } from '../../../admin/stores/types';
import { Or3ExtensionManifestV2Schema, type Or3ExtensionManifestV2 } from '../../../admin/extensions/types';
import { OR3_PLUGIN_V2_HOST_CAPABILITIES } from '../../../admin/plugins/v2-host-capabilities';
import { verifyPackageTree } from '../../../admin/plugins/package-tree';
import type { PluginV2HostCapabilities } from '~~/shared/plugins/v2-compatibility';
import type { PluginManifestV2 } from '@or3/plugin-sdk/manifest';
import {
    defineOr3PortableProfile,
    validatePortableProfile,
    type Or3PackagePolicyV1,
    type Or3SetupDescriptorV1,
} from '@or3/plugin-sdk/profile';
import type { SetupPlan } from '~~/shared/plugins/setup/plan';
import {
    getEnabledPlugins,
    getPluginGrantReview,
    setPluginEnabled,
} from '../../../admin/plugins/workspace-plugin-store';
import { PluginPackageRouteCatalog } from '../../../admin/plugins/package-route-catalog';
import type { PluginPackagePointer } from '../../../admin/plugins/package-pointer-store';
import {
    readPackageGrantReview,
    readPluginStateSnapshot,
    restorePluginStateSnapshot,
    serverCandidateDryRun,
    type PluginPackageServices,
} from '../../../admin/plugins/package-operation-support';
import {
    preflightPluginStateCompatibility,
} from '~~/shared/plugins/state-compatibility';
import { setupValuesKey } from '../setup/settings-store';
import { loadPackageDescriptors } from '../setup/load-descriptors';
import {
    acquisitionProfileRequirement,
    type AcquisitionProfileRequirement,
    type ReleaseMetadataDocument,
} from '~~/shared/plugins/acquisition/release-metadata';
import {
    acquisitionStageIndex,
    isTerminalAcquisitionStatus,
    resumeStageFor,
    type PluginAcquisitionFailure,
    type PluginAcquisitionFailureCode,
    type PluginAcquisitionOperation,
    type PluginAcquisitionReleaseIdentity,
    type PluginAcquisitionStage,
} from '~~/shared/plugins/acquisition/contracts';
import type { AcquisitionConfig } from './config';import {
    PluginAcquisitionOperationError,
    PluginAcquisitionOperationStore,
    type AcquisitionOperationPatch,
} from './operation-store';
import type { CandidateCanaryStepResult } from '../../../admin/plugins/package-candidate-canary';
import { getPluginSettings } from '../../../admin/plugins/workspace-plugin-store';
import { RegistryClient, sha256FileIdentity, type RegistryFailureCode } from './registry-client';

export interface StartAcquisitionInput {
    readonly pluginId: string;
    readonly version?: string;
    readonly workspaceId: string;
    readonly requesterUserId: string;
    readonly instanceId: string;
}

export type StartAcquisitionResult =
    | { readonly ok: true; readonly operation: PluginAcquisitionOperation }
    | { readonly ok: false; readonly failure: PluginAcquisitionFailure };

export interface WorkspacePreflightBlock {
    readonly workspaceId: string;
    readonly code: string;
}

export interface WorkspacePreflightResult {
    readonly checked: number;
    readonly blocking: readonly WorkspacePreflightBlock[];
}

export interface ClientCanaryInput {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly operationId: string;
    readonly packageDigest: `sha256-${string}`;
    readonly packagePath: string;
}

export interface AcquisitionServiceDeps {
    readonly config: AcquisitionConfig;
    readonly store: PluginAcquisitionOperationStore;
    readonly registry: RegistryClient;
    readonly services: PluginPackageServices;
    readonly routeCatalog: PluginPackageRouteCatalog;
    /** Every workspace on this instance, used for the instance-wide preflight. */
    readonly listWorkspaceIds: () => Promise<readonly string[]>;
    /**
     * The package trust modes and profiles this host declares. Defaults to the
     * host's own capability constant: the pipeline never widens it, so a release
     * whose signed profile needs a trust mode the host cannot run is refused
     * before a loader is chosen for it.
     */
    readonly hostCapabilities?: PluginV2HostCapabilities;
    /**
     * Runs the client half of the candidate canary. A profile that requires a
     * client runtime (the portable client profile) cannot be promoted without a
     * real client pass; when no runner is configured it blocks rather than
     * recording a skip that looks like evidence.
     */
    readonly clientCanary?: (
        input: ClientCanaryInput
    ) => CandidateCanaryStepResult | Promise<CandidateCanaryStepResult>;
    /**
     * The host's setup readiness rules for the candidate package, evaluated with
     * the saved values and stored connections. `null` means the package declares
     * no setup; anything else is the same plan the setup page renders.
     */
    readonly setupPlan?: (
        pluginId: string,
        workspaceId: string,
        packageRoot: string
    ) => Promise<SetupPlan | null>;
    /** Legacy extension ids, so a V2 package cannot shadow one. */
    readonly listInstalledExtensionIds?: () => Promise<readonly string[]>;
    readonly extensionsRoot?: string;
    readonly now?: () => number;
    /**
     * Durable monotonic advisory state. When present, an accepted sequence is
     * recorded so a later replayed catalog cannot clear it.
     */
    readonly registryState?: { acceptAdvisorySequence(sequence: number): Promise<unknown> };
}

type StepResult =
    | { readonly kind: 'continue'; readonly operation: PluginAcquisitionOperation }
    | { readonly kind: 'rest'; readonly operation: PluginAcquisitionOperation };

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** Registry failure codes are a subset of acquisition codes. */
function toFailureCode(code: RegistryFailureCode): PluginAcquisitionFailureCode {
    return code as PluginAcquisitionFailureCode;
}

function restFailure(
    stage: PluginAcquisitionStage,
    code: PluginAcquisitionFailureCode,
    message: string,
    retryable: boolean
): PluginAcquisitionFailure {
    return { code, stage, message, retryable };
}

export class PluginAcquisitionService {
    readonly #deps: AcquisitionServiceDeps;
    readonly #hostCapabilities: PluginV2HostCapabilities;
    readonly #now: () => number;
    readonly #stagingRoot: string;

    constructor(deps: AcquisitionServiceDeps) {
        this.#deps = deps;
        this.#hostCapabilities = deps.hostCapabilities ?? OR3_PLUGIN_V2_HOST_CAPABILITIES;
        this.#now = deps.now ?? (() => Date.now());
        this.#stagingRoot = resolve(
            deps.extensionsRoot ?? EXTENSIONS_BASE_DIR,
            '.operations',
            'staging'
        );
    }

    get store(): PluginAcquisitionOperationStore {
        return this.#deps.store;
    }

    /**
     * Resolve the requested release and record the operation. Resolution itself is
     * read-only, so a refused request leaves no record behind; everything after it
     * is durable and resumable.
     */
    async start(input: StartAcquisitionInput): Promise<StartAcquisitionResult> {
        const refused = this.#refuseStart(input);
        if (refused) return { ok: false, failure: refused };

        const resolved = await this.#deps.registry.resolveRelease({
            expectation: {
                pluginId: input.pluginId,
                ...(input.version === undefined ? {} : { version: input.version }),
            },
        });
        if (!resolved.ok) {
            return {
                ok: false,
                failure: restFailure(
                    'resolved',
                    toFailureCode(resolved.failure.code),
                    resolved.failure.message,
                    resolved.failure.retryable
                ),
            };
        }

        const document = resolved.value.document;
        // The host has now accepted this catalog position; record it monotonically
        // so a later replayed catalog cannot clear a revocation.
        await this.#deps.registryState
            ?.acceptAdvisorySequence(resolved.value.advisorySequence)
            .catch(() => undefined);
        let record: PluginAcquisitionOperation;        try {
            record = await this.#deps.store.create({
                pluginId: input.pluginId,
                version: document.version,
                workspaceId: input.workspaceId,
                requesterUserId: input.requesterUserId,
                instanceId: input.instanceId,
                stage: 'resolved',
                acceptedAdvisorySequence: resolved.value.advisorySequence,
                release: releaseIdentity(document),
            });
        } catch (error) {
            return {
                ok: false,
                failure: restFailure(
                    'resolved',
                    error instanceof PluginAcquisitionOperationError &&
                        error.code === 'operation-conflict'
                        ? 'operation-conflict'
                        : 'internal-error',
                    error instanceof Error ? error.message : 'The operation could not be recorded.',
                    false
                ),
            };
        }
        // The durable id is returned before any long-running work: a download can
        // take minutes, and the caller must be able to poll and cancel it.
        return { ok: true, operation: record };
    }

    /**
     * Run (or resume) the pipeline to its next resting point, holding the
     * plugin's runner lock so two callers cannot advance one operation (or share
     * one staging directory) at the same time.
     */
    async advance(operationId: string): Promise<PluginAcquisitionOperation> {
        const record = await this.#deps.store.requireRecord(operationId);
        try {
            return await this.#deps.store.withRunnerLock(record.pluginId, async () => {
                for (;;) {
                    const current = await this.#deps.store.requireRecord(operationId);
                    if (isTerminalAcquisitionStatus(current.status)) return current;
                    if (current.cancelRequested) {
                        return await this.#cancelNow(current);
                    }
                    const step = await this.#step(current);
                    if (step.kind === 'rest') return step.operation;
                }
            });
        } catch (error) {
            if (
                error instanceof PluginAcquisitionOperationError &&
                error.code === 'operation-conflict'
            ) {
                // Another runner owns this plugin right now (or a concurrent
                // cancel moved the record). Report the recorded state instead of
                // starting a second run.
                return await this.#deps.store.requireRecord(operationId);
            }
            throw error;
        }
    }

    /**
     * Cancellation stops before the next side effect. Once the pointer has been
     * committed there is nothing left to cancel: the installation is live, and
     * reporting it as "canceled before activation" would be a lie, so the
     * operation is finished as completed instead.
     */
    async #cancelNow(current: PluginAcquisitionOperation): Promise<PluginAcquisitionOperation> {
        if (acquisitionStageIndex(current.stage) >= acquisitionStageIndex('promoted')) {
            return (await this.#receipt(current)).operation;
        }
        return await this.#finalize(current, 'canceled', {
            code: 'canceled',
            stage: current.stage,
            message: 'The acquisition was canceled before activation.',
            retryable: true,
        });
    }

    /**
     * Retry a failed or blocked operation. The recorded stage is the resume point,
     * so a retry continues instead of restarting from the beginning.
     */
    async retry(operationId: string): Promise<PluginAcquisitionOperation> {
        await this.#deps.store.retry(operationId);
        return await this.advance(operationId);
    }

    /** Whether the host still permits acquisition at all (resume revalidation). */
    #hostPolicyRefusal(): PluginAcquisitionFailure | null {
        const config = this.#deps.config;
        if (!config.installEnabled) {
            return restFailure(
                'resolved',
                'registry-unconfigured',
                'Registry installation is not enabled on this instance.',
                true
            );
        }
        if (config.registryOrigin.length === 0 || config.releaseKeys.length === 0) {
            return restFailure(
                'resolved',
                'registry-unconfigured',
                'No marketplace registry origin or release key is configured on this instance.',
                true
            );
        }
        return null;
    }

    /**
     * Request cancellation. A running pipeline observes the flag before its next
     * side effect; a paused operation is canceled immediately. Either way the
     * working pointer is untouched, because cancellation never promotes.
     */
    async cancel(operationId: string): Promise<PluginAcquisitionOperation> {
        const requested = await this.#deps.store.requestCancel(operationId);
        if (isTerminalAcquisitionStatus(requested.status)) return requested;
        if (requested.status === 'paused' || requested.status === 'pending') {
            return await this.#cancelNow(requested);
        }
        return requested;
    }

    async status(operationId: string): Promise<PluginAcquisitionOperation> {
        return await this.#deps.store.requireRecord(operationId);
    }

    async listForPlugin(pluginId: string): Promise<readonly PluginAcquisitionOperation[]> {
        return await this.#deps.store.list(pluginId);
    }

    /** Every recorded operation, newest first (discovery after a lost response). */
    async listAll(): Promise<readonly PluginAcquisitionOperation[]> {
        return await this.#deps.store.list();
    }

    /**
     * Instance-wide update preflight: every enabled workspace must be able to read
     * the same selected version. A blocking workspace is reported and the update
     * stays blocked until an owner explicitly disables it.
     */
    async preflightWorkspaces(
        pluginId: string,
        manifestRequestedGrants: readonly string[]
    ): Promise<WorkspacePreflightResult> {
        const workspaceIds = await this.#deps.listWorkspaceIds();
        const blocking: WorkspacePreflightBlock[] = [];
        let checked = 0;
        const pointer = await this.#deps.services.pointers.readPointer(pluginId);
        for (const workspaceId of workspaceIds) {
            const enabled = await getEnabledPlugins(this.#deps.services.settings, workspaceId);
            if (!enabled.includes(pluginId)) continue;
            checked += 1;
            const review = await getPluginGrantReview(
                this.#deps.services.settings,
                workspaceId,
                pluginId,
                manifestRequestedGrants
            );
            if (review.status !== 'current') {
                blocking.push({ workspaceId, code: `grant-review-${review.status}` });
                continue;
            }
            if (!pointer?.candidate) continue;
            const state = preflightPluginStateCompatibility({
                operation: 'upgrade',
                storedStateVersion: await this.#deps.services.migration.getStateVersion(
                    workspaceId,
                    pluginId
                ),
                target: pointer.candidate.stateCompatibility,
                current: pointer.current?.stateCompatibility,
            });
            if (state.status === 'blocked') {
                blocking.push({ workspaceId, code: state.code });
            } else if (state.status === 'migration-required') {
                // An instance-wide update cannot run a per-workspace migration.
                blocking.push({ workspaceId, code: 'state-migration-required' });
            }
        }
        return { checked, blocking: Object.freeze(blocking) };
    }

    #refuseStart(input: StartAcquisitionInput): PluginAcquisitionFailure | null {
        if (!PLUGIN_ID_PATTERN.test(input.pluginId) || input.pluginId.includes('..')) {
            return restFailure('resolved', 'internal-error', 'Invalid plugin id.', false);
        }
        if (!this.#deps.config.installEnabled) {
            return restFailure(
                'resolved',
                'registry-unconfigured',
                'Registry installation is not enabled on this instance.',
                false
            );
        }
        if (
            this.#deps.config.registryOrigin.length === 0 ||
            this.#deps.config.releaseKeys.length === 0
        ) {
            return restFailure(
                'resolved',
                'registry-unconfigured',
                'No marketplace registry origin or release key is configured on this instance.',
                false
            );
        }
        if (!input.workspaceId || !input.requesterUserId || !input.instanceId) {
            return restFailure(
                'resolved',
                'internal-error',
                'An acquisition requires a workspace, requester and instance.',
                false
            );
        }
        return null;
    }

    async #step(record: PluginAcquisitionOperation): Promise<StepResult> {
        try {
            // Policy and trust are re-read from configuration on every resumed
            // stage: disabling installation or removing a trust key after a
            // candidate was downloaded must stop it before it is activated.
            const policyRefusal = this.#hostPolicyRefusal();
            if (policyRefusal && resumeStageFor(record) !== 'resolved') {
                return await this.#fail(
                    record,
                    'registry-unconfigured',
                    policyRefusal.message,
                    true,
                    'blocked'
                );
            }
            switch (resumeStageFor(record)) {
                case 'resolved':
                    return await this.#authorize(record);
                case 'authorized':
                    return await this.#reserve(record);
                case 'reserved':
                    return await this.#download(record);
                case 'downloaded':
                    return await this.#verify(record);
                case 'verified':
                    return await this.#recordCandidate(record);
                case 'candidate-recorded':
                    return await this.#healthCheck(record);
                case 'health-checked':
                    return await this.#promote(record);
                case 'promoted':
                    return await this.#receipt(record);
                default:
                    return await this.#fail(record, 'internal-error', 'Unknown acquisition stage.', false);
            }
        } catch (error) {
            if (error instanceof PluginAcquisitionOperationError) {
                return await this.#fail(
                    await this.#deps.store.requireRecord(record.operationId),
                    error.code === 'operation-conflict' ? 'operation-conflict' : 'internal-error',
                    error.message,
                    error.code === 'operation-conflict'
                );
            }
            return await this.#fail(
                await this.#deps.store.requireRecord(record.operationId),
                'internal-error',
                error instanceof Error ? error.message : 'The acquisition failed unexpectedly.',
                false
            );
        }
    }

    /** 5.4: policy is re-checked against the resolved identity before reservation. */
    async #authorize(record: PluginAcquisitionOperation): Promise<StepResult> {
        if (!this.#deps.config.installEnabled) {
            return await this.#fail(
                record,
                'registry-unconfigured',
                'Registry installation is not enabled on this instance.',
                false
            );
        }
        if (!record.release || record.release.pluginId !== record.pluginId) {
            return await this.#fail(
                record,
                'release-identity-mismatch',
                'The resolved release does not match the requested plugin.',
                false
            );
        }
        const next = await this.#advanceTo(record, 'authorized', {});
        return { kind: 'continue', operation: next };
    }

    async #reserve(record: PluginAcquisitionOperation): Promise<StepResult> {
        const selection = await this.#deps.services.pointers.readStartupSelection(record.pluginId);
        if (selection.status !== 'ready' && selection.status !== 'inactive') {
            return await this.#fail(
                record,
                'pointer-conflict',
                `The recorded package pointer for ${record.pluginId} cannot accept a candidate.`,
                false
            );
        }
        const stagingDir = this.#operationStagingDir(record.operationId);
        await fs.rm(stagingDir, { recursive: true, force: true });
        await fs.mkdir(stagingDir, { recursive: true, mode: 0o700 });
        const next = await this.#advanceTo(record, 'reserved', {
            stagingObject: resolve(stagingDir, 'package.or3pkg'),
            downloadedBytes: 0,
            downloadUrlExpiresAt: null,
        });
        return { kind: 'continue', operation: next };
    }

    async #download(record: PluginAcquisitionOperation): Promise<StepResult> {
        const release = record.release;
        if (!release) {
            return await this.#fail(
                record,
                'internal-error',
                'The operation has no resolved release to download.',
                false
            );
        }
        const artifactPath = record.stagingObject ?? resolve(this.#operationStagingDir(record.operationId), 'package.or3pkg');

        // An interrupted operation reuses already verified bytes instead of
        // downloading them again.
        const staged = await safeFileSize(artifactPath);
        if (staged > 0 && (await safeDigest(artifactPath)) === release.archiveSha256) {
            return {
                kind: 'continue',
                operation: await this.#advanceTo(record, 'downloaded', {
                    downloadedBytes: staged,
                    stagingObject: artifactPath,
                }),
            };
        }

        // Re-resolve by the recorded release id: this is the recovery path for an
        // expired download URL and it pins the operation to one release.
        // The registry addresses releases by plugin id and version; the recorded
        // release id is then checked against what the registry serves, so a
        // re-resolution cannot swap the operation onto another release.
        const resolved = await this.#deps.registry.resolveRelease({
            expectation: {
                pluginId: record.pluginId,
                version: record.version,
                releaseId: release.releaseId,
            },
        });
        if (!resolved.ok) {
            return await this.#fail(
                record,
                toFailureCode(resolved.failure.code),
                resolved.failure.message,
                resolved.failure.retryable,
                'failed',
                { downloadedBytes: staged, stagingObject: artifactPath }
            );
        }
        if (
            resolved.value.document.archiveSha256 !== release.archiveSha256 ||
            resolved.value.document.releaseId !== release.releaseId
        ) {
            return await this.#fail(
                record,
                'release-digest-mismatch',
                'The registry served a different release than the one this operation resolved.',
                false
            );
        }

        const download = await this.#deps.registry.downloadArtifact({
            resolved: resolved.value,
            stagingPath: artifactPath,
            resumeFromBytes: staged > 0 ? staged : 0,
        });
        if (!download.ok) {
            return await this.#fail(
                record,
                toFailureCode(download.failure.code),
                download.failure.message,
                download.failure.retryable,
                'failed',
                { downloadedBytes: await safeFileSize(artifactPath), stagingObject: artifactPath }
            );
        }
        return {
            kind: 'continue',
            operation: await this.#advanceTo(record, 'downloaded', {
                downloadedBytes: download.value.bytes,
                stagingObject: artifactPath,
            }),
        };
    }

    /** Canonical tree verification plus manifest identity, before any pointer write. */
    async #verify(record: PluginAcquisitionOperation): Promise<StepResult> {
        const release = record.release;
        if (!release) {
            return await this.#fail(record, 'internal-error', 'The operation has no release.', false);
        }
        const artifactPath = record.stagingObject;
        if (!artifactPath) {
            return await this.#fail(record, 'internal-error', 'The operation has no staged artifact.', false);
        }
        const bytes = await fs.readFile(artifactPath);
        if (bytes.byteLength > this.#deps.config.maxArtifactBytes) {
            return await this.#fail(
                record,
                'download-over-limit',
                'The staged artifact exceeds the acquisition byte ceiling.',
                false
            );
        }
        const treePath = this.#treeDir(record.operationId);
        await fs.rm(treePath, { recursive: true, force: true });
        try {
            const extracted = await readPackageZip(new Uint8Array(bytes), {
                extractDirectory: treePath,
            });
            if (extracted.digest !== release.packageTreeSha256) {
                return await this.#fail(
                    record,
                    'release-digest-mismatch',
                    'The extracted package tree does not match the signed tree digest.',
                    false
                );
            }
        } catch (error) {
            return await this.#fail(
                record,
                'package-verification-failed',
                error instanceof Error ? error.message : 'The package archive failed verification.',
                false
            );
        }

        const verification = await verifyPackageTree(treePath, {
            expectedDigest: release.packageTreeSha256,
        });
        if (verification.manifestDigest !== release.manifestSha256) {
            return await this.#fail(
                record,
                'release-digest-mismatch',
                'The package manifest does not match the signed manifest digest.',
                false
            );
        }
        const manifest = await this.#readTreeManifest(treePath);
        if (!manifest) {
            return await this.#fail(
                record,
                'package-verification-failed',
                'The package manifest is missing or invalid.',
                false
            );
        }
        if (manifest.id !== release.pluginId || manifest.version !== release.version) {
            return await this.#fail(
                record,
                'release-identity-mismatch',
                'The package identity does not match the signed release metadata.',
                false
            );
        }
        return {
            kind: 'continue',
            operation: await this.#advanceTo(record, 'verified', {}),
        };
    }

    /** Records the candidate through the existing candidate service. */
    async #recordCandidate(record: PluginAcquisitionOperation): Promise<StepResult> {
        const release = record.release;
        if (!release) {
            return await this.#fail(record, 'internal-error', 'The operation has no release.', false);
        }
        const treePath = this.#treeDir(record.operationId);
        const manifest = await this.#readTreeManifest(treePath);
        if (!manifest) {
            return await this.#fail(
                record,
                'package-verification-failed',
                'The staged package tree is not usable.',
                false
            );
        }
        const profileRefusal = await this.#profileRefusal(record, treePath, manifest);
        if (profileRefusal) {
            return await this.#fail(record, profileRefusal.code, profileRefusal.message, false);
        }
        const requirement = acquisitionProfileRequirement(record.release.profile);

        const selectedPackages = await this.#deps.routeCatalog.listSelected();
        const ready = selectedPackages.filter((catalog) => catalog.status === 'ready');
        const grantReview = await getPluginGrantReview(
            this.#deps.services.settings,
            record.workspaceId,
            record.pluginId,
            manifest.requestedGrants
        );
        const result = await this.#deps.services.candidates.prepare({
            pluginId: record.pluginId,
            sourceRoot: treePath,
            expectedDigest: release.packageTreeSha256,
            host: { ...this.#hostCapabilities },
            availableDependencies: ready.map((catalog) => ({
                id: catalog.pluginId,
                version: catalog.manifest.version,
                features: [
                    ...catalog.manifest.features.required,
                    ...catalog.manifest.features.optional,
                ],
            })),
            dependencyNodes: ready.map((catalog) => ({
                id: catalog.pluginId,
                version: catalog.manifest.version,
                dependencies: catalog.manifest.dependencies,
            })),
            grantReview,
            storedStateVersion: await this.#deps.services.migration.getStateVersion(
                record.workspaceId,
                record.pluginId
            ),
            identityPreflight: () => this.#identityPreflight(record.pluginId),
            // The signed profile decides which loader this candidate is offered
            // to. A trusted-host profile must be a server package with no client
            // runtime; a portable profile must be an isolated client package with
            // no server code at all, so server modules can never ride in under a
            // client profile.
            loaderPreflight: ({ manifest: candidateManifest }) => {
                const codes: string[] = [];
                if (!requirement) codes.push('package-profile-unknown');
                else {
                    if (candidateManifest.trust !== requirement.trust) {
                        codes.push('package-profile-trust-mismatch');
                    }
                    if (
                        requirement.serverRuntime === 'forbidden' &&
                        candidateManifest.runtime.server
                    ) {
                        codes.push('package-profile-server-runtime-forbidden');
                    }
                    if (
                        requirement.clientRuntime === 'forbidden' &&
                        candidateManifest.runtime.client
                    ) {
                        codes.push('trusted-host-ui-abi-unproven');
                    }
                    if (
                        requirement.clientRuntime === 'required' &&
                        !candidateManifest.runtime.client
                    ) {
                        codes.push('package-profile-client-runtime-missing');
                    }
                    if (
                        requirement.clientRuntime === 'required' &&
                        requirement.clientIsolation &&
                        candidateManifest.runtime.client &&
                        !requirement.clientIsolation.includes(
                            candidateManifest.runtime.client.isolation
                        )
                    ) {
                        codes.push('package-profile-isolation-unsupported');
                    }
                }
                return codes.length === 0
                    ? { status: 'eligible' as const, codes: [] }
                    : { status: 'blocked' as const, codes };
            },
        });
        if (result.status === 'blocked') {
            const mapped = candidateBlockFailure(result.stage, result.codes);
            return await this.#fail(record, mapped.code, mapped.message, mapped.retryable, 'blocked');
        }

        const next = await this.#advanceTo(record, 'candidate-recorded', {
            candidateDigest: result.stored.digest,
            expectedPointerRevision: result.pointer.revision,
        });
        // A package that declares setup waits for the user when the host's own
        // readiness rules say it is not usable yet, for a first install and for
        // an upgrade that adds a requirement.
        const readiness = await this.#setupReadiness(record, result.stored.digest);
        if (readiness.status === 'blocked') {
            return await this.#fail(record, 'package-policy-mismatch', readiness.message, false);
        }
        if (readiness.status === 'needs-setup') {
            return {
                kind: 'rest',
                operation: await this.#pause(next, 'setup-required', readiness.message),
            };
        }
        return { kind: 'continue', operation: next };
    }

    /** 5.4/5.5: instance-wide preflight, then the minimally authorized canary. */
    async #healthCheck(record: PluginAcquisitionOperation): Promise<StepResult> {
        if (!record.candidateDigest) {
            return await this.#fail(record, 'internal-error', 'No candidate is recorded.', false);
        }
        const manifest = await this.#readStoredManifest(record.pluginId, record.candidateDigest);
        if (!manifest) {
            return await this.#fail(
                record,
                'package-verification-failed',
                'The stored candidate package is unreadable.',
                false
            );
        }
        const readiness = await this.#setupReadiness(record, record.candidateDigest);
        if (readiness.status === 'blocked') {
            return await this.#fail(record, 'package-policy-mismatch', readiness.message, false);
        }
        if (readiness.status === 'needs-setup') {
            return await this.#fail(
                record,
                'setup-required',
                readiness.message,
                true,
                'paused'
            );
        }
        const preflight = await this.preflightWorkspaces(record.pluginId, manifest.requestedGrants);
        if (preflight.blocking.length > 0) {
            const detail = preflight.blocking
                .map((entry) => `${entry.workspaceId} (${entry.code})`)
                .join(', ');
            return await this.#fail(
                record,
                'workspace-preflight-blocked',
                `An owner must disable these workspaces before the update can continue: ${detail}`,
                true,
                'blocked'
            );
        }

        const canary = await this.#deps.services.canary.run({
            pluginId: record.pluginId,
            workspaceId: record.workspaceId,
            packageDigest: record.candidateDigest,
            clientId: `acquisition-server:${record.operationId}`,
            snapshotState: () =>
                readPluginStateSnapshot(
                    this.#deps.services,
                    record.workspaceId,
                    record.pluginId
                ),
            readGrantReview: (candidate) =>
                readPackageGrantReview({
                    packages: this.#deps.services.packages,
                    settings: this.#deps.services.settings,
                    workspaceId: record.workspaceId,
                    pluginId: candidate.pluginId,
                    packageDigest: candidate.packageDigest,
                }),
            serverDryRun: (dryRun) =>
                this.#serverDryRun(record, dryRun),
            // A profile that requires a client runtime needs a real client pass.
            // When no runner is configured this blocks: a portable candidate is
            // never promoted on the strength of a skipped browser check.
            clientHiddenPrepare: (context) => this.#clientCanary(record, context),
        });
        if (canary.status !== 'passed') {
            // A pending browser check is its own code: the marketplace UI runs
            // the hidden activation and retries the same operation.
            const code =
                canary.stage === 'client-canary' && canary.code === 'client-canary-pending'
                    ? 'client-canary-pending'
                    : 'health-check-failed';
            return await this.#fail(
                record,
                code,
                `The candidate health check was blocked at ${canary.stage}: ${canary.code}`,
                true
            );
        }
        return {
            kind: 'continue',
            operation: await this.#advanceTo(record, 'health-checked', {}),
        };
    }

    /** Conditional promotion bound to the recorded candidate and pointer revision. */
    async #promote(record: PluginAcquisitionOperation): Promise<StepResult> {
        if (!record.candidateDigest) {
            return await this.#fail(record, 'internal-error', 'No candidate is recorded.', false);
        }
        const pointer = await this.#deps.services.pointers.readPointer(record.pluginId);
        // A crash between the pointer write and the recorded `promoted` stage is
        // not a conflict: the committed pointer still names this operation's
        // candidate, so the promotion already happened and only the receipt is
        // outstanding.
        if (pointer?.current?.packageDigest === record.candidateDigest) {
            const enabled = await this.#enableFirstInstall(record, pointer);
            if (!enabled.ok) return await this.#fail(record, enabled.code, enabled.message, true);
            return {
                kind: 'continue',
                operation: await this.#advanceTo(record, 'promoted', {}),
            };
        }
        if (!pointer?.candidate || pointer.candidate.packageDigest !== record.candidateDigest) {
            return await this.#fail(
                record,
                'pointer-conflict',
                'The recorded candidate is no longer the pending candidate.',
                false,
                'blocked'
            );
        }
        if (
            record.expectedPointerRevision !== null &&
            pointer.revision !== record.expectedPointerRevision
        ) {
            return await this.#fail(
                record,
                'pointer-conflict',
                `The package pointer moved from revision ${record.expectedPointerRevision} to ${pointer.revision}.`,
                false,
                'blocked'
            );
        }
        // The instance-wide preflight is re-run at the commit boundary: another
        // workspace can have been enabled or made incompatible since the canary,
        // and promotion must not ignore that.
        const manifest = await this.#readStoredManifest(record.pluginId, record.candidateDigest);
        if (!manifest) {
            return await this.#fail(
                record,
                'package-verification-failed',
                'The stored candidate package is unreadable.',
                false
            );
        }
        const readiness = await this.#setupReadiness(record, record.candidateDigest);
        if (readiness.status === 'blocked') {
            return await this.#fail(record, 'package-policy-mismatch', readiness.message, false);
        }
        if (readiness.status === 'needs-setup') {
            return await this.#fail(
                record,
                'setup-required',
                readiness.message,
                true,
                'paused'
            );
        }
        const preflight = await this.preflightWorkspaces(record.pluginId, manifest.requestedGrants);
        if (preflight.blocking.length > 0) {
            const detail = preflight.blocking
                .map((entry) => `${entry.workspaceId} (${entry.code})`)
                .join(', ');
            // The candidate was health-checked against a different workspace set,
            // so its evidence no longer covers this one: the operation restages so
            // a retry re-runs the preflight and the canary instead of reusing it.
            return await this.#fail(
                record,
                'workspace-preflight-blocked',
                `An owner must disable these workspaces before the update can continue: ${detail}`,
                true,
                'blocked',
                {},
                'candidate-recorded'
            );
        }

        const result = await this.#deps.services.promotion.promote({
            pluginId: record.pluginId,
            workspaceId: record.workspaceId,
            expectedCandidateDigest: record.candidateDigest,
            storedStateVersion: await this.#deps.services.migration.getStateVersion(
                record.workspaceId,
                record.pluginId
            ),
            snapshotState: () =>
                readPluginStateSnapshot(
                    this.#deps.services,
                    record.workspaceId,
                    record.pluginId
                ),
            readGrantReview: (candidate) =>
                readPackageGrantReview({
                    packages: this.#deps.services.packages,
                    settings: this.#deps.services.settings,
                    workspaceId: record.workspaceId,
                    pluginId: candidate.pluginId,
                    packageDigest: candidate.packageDigest,
                }),
            restoreState: (snapshot) =>
                restorePluginStateSnapshot(
                    this.#deps.services,
                    record.workspaceId,
                    record.pluginId,
                    snapshot
                ),
            requireCanaryEvidence: true,
        });
        if (result.status !== 'promoted') {
            const mapped = promotionBlockFailure(result.stage, result.code);
            // Stale canary or state evidence must not be retried against itself:
            // restaging re-runs the preflight and canary that produced it.
            const restage =
                result.stage === 'canary-evidence' || result.stage === 'state'
                    ? ('candidate-recorded' as const)
                    : undefined;
            return await this.#fail(
                record,
                mapped.code,
                mapped.message,
                mapped.retryable,
                'blocked',
                {},
                restage
            );
        }
        const enabled = await this.#enableFirstInstall(record, result.pointer);
        if (!enabled.ok) return await this.#fail(record, enabled.code, enabled.message, true);
        return {
            kind: 'continue',
            operation: await this.#advanceTo(record, 'promoted', {}),
        };
    }

    /**
     * A first install (no previous selection) enables the plugin for the
     * installing workspace. Reporting an install as ready while the runtime gate
     * refused the still-disabled package was a promise the operator could not
     * use; an update never changes enablement, so a deliberate disable survives.
     * Idempotent, so a retry after the pointer write cannot double-apply.
     */
    async #enableFirstInstall(
        record: PluginAcquisitionOperation,
        pointer: PluginPackagePointer
    ): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: 'internal-error'; readonly message: string }> {
        if (pointer.previous !== null) return { ok: true };
        try {
            await setPluginEnabled(
                this.#deps.services.settings,
                record.workspaceId,
                record.pluginId,
                true
            );
            return { ok: true };
        } catch {
            return {
                ok: false,
                code: 'internal-error',
                message:
                    'The plugin was selected but could not be enabled for this workspace; retry the operation.',
            };
        }
    }

    async #receipt(record: PluginAcquisitionOperation): Promise<StepResult> {
        const next = await this.#advanceTo(record, 'receipt-recorded', {
            status: 'completed',
            failure: null,
            completedAt: this.#now(),
        });
        await fs.rm(this.#operationStagingDir(record.operationId), { recursive: true, force: true }).catch(
            () => undefined
        );
        await this.#deps.store.gc().catch(() => undefined);
        return { kind: 'rest', operation: next };
    }

    async #advanceTo(
        record: PluginAcquisitionOperation,
        stage: PluginAcquisitionStage,
        patch: Parameters<PluginAcquisitionOperationStore['update']>[2]
    ): Promise<PluginAcquisitionOperation> {
        return await this.#deps.store.update(record.operationId, record.revision, {
            ...patch,
            stage,
            status: patch.status ?? 'running',
            failure: patch.failure ?? null,
        });
    }

    async #fail(
        record: PluginAcquisitionOperation,
        code: PluginAcquisitionFailureCode,
        message: string,
        retryable: boolean,
        status: 'failed' | 'blocked' | 'paused' = 'failed',
        patch: AcquisitionOperationPatch = {},
        restage?: PluginAcquisitionStage
    ): Promise<StepResult> {
        const operation = await this.#deps.store.update(record.operationId, record.revision, {
            ...patch,
            ...(restage === undefined ? {} : { restage }),
            status,
            failure: restFailure(record.stage, code, message, retryable),
            completedAt: this.#now(),
        });
        return { kind: 'rest', operation };
    }

    async #pause(
        record: PluginAcquisitionOperation,
        code: PluginAcquisitionFailureCode,
        message: string
    ): Promise<PluginAcquisitionOperation> {
        return await this.#deps.store.update(record.operationId, record.revision, {
            status: 'paused',
            failure: restFailure(record.stage, code, message, true),
        });
    }

    async #finalize(
        record: PluginAcquisitionOperation,
        status: 'canceled',
        failureValue: PluginAcquisitionFailure
    ): Promise<PluginAcquisitionOperation> {
        return await this.#deps.store.update(record.operationId, record.revision, {
            status,
            failure: failureValue,
            cancelRequested: true,
            completedAt: this.#now(),
        });
    }

    async #identityPreflight(pluginId: string): Promise<{ status: 'eligible' | 'blocked'; codes: string[] }> {
        const installed = this.#deps.listInstalledExtensionIds;
        if (!installed) return { status: 'eligible', codes: [] };
        const ids = await installed();
        return ids.includes(pluginId)
            ? { status: 'blocked', codes: ['plugin-id-conflicts-with-legacy-extension'] }
            : { status: 'eligible', codes: [] };
    }

    /**
     * The signed profile, the package's real shape and the signed authority
     * digest are checked together. The portable profile is validated with the
     * same shared validator the marketplace reviewer used, so a document that
     * merely claims the profile cannot smuggle server code (or an unknown
     * destination/scope) into a loader that would import it.
     */
    async #profileRefusal(
        record: PluginAcquisitionOperation,
        packageRoot: string,
        manifest: Or3ExtensionManifestV2
    ): Promise<{ code: PluginAcquisitionFailureCode; message: string } | null> {
        const profile = record.release?.profile ?? '';
        const requirement = acquisitionProfileRequirement(profile);
        if (!requirement) {
            return {
                code: 'package-profile-mismatch',
                message: `The signed release names profile ${profile}, which this host has no rules for.`,
            };
        }
        if (
            !this.#hostCapabilities.supportedTrustModes.includes(
                requirement.trust as PluginV2HostCapabilities['supportedTrustModes'][number]
            )
        ) {
            return {
                code: 'package-profile-mismatch',
                message: `Profile ${profile} requires trust mode ${requirement.trust}, which this host does not support.`,
            };
        }
        const descriptors = await loadPackageDescriptors({
            extensionsBaseDir: this.#deps.extensionsRoot ?? EXTENSIONS_BASE_DIR,
            packagePath: packageRoot,
        });
        if (descriptors.problems.length > 0) {
            return {
                code: 'package-profile-mismatch',
                message: `The package does not carry a usable ${profile} profile: ${descriptors.problems.join('; ')}`,
            };
        }
        const findings = validatePortableProfile({
            manifest: manifest as unknown as PluginManifestV2,
            policy: descriptors.policy,
            setup: descriptors.setup,
        });
        if (findings.length > 0) {
            return {
                code: 'package-profile-mismatch',
                message: `The package does not conform to ${profile}: ${findings
                    .map((finding) => `${finding.code}(${finding.subject})`)
                    .join(', ')}`,
            };
        }
        const authority = await this.#signedAuthorityDigest(descriptors.policy, descriptors.setup);
        if (authority !== null && authority !== record.release?.authoritySha256) {
            return {
                code: 'authority-mismatch',
                message: `The package's reviewed authority ${authority} does not match the signed authority ${record.release?.authoritySha256}.`,
            };
        }
        return null;
    }

    /**
     * The canonical policy revision the marketplace signs as the release's
     * authority digest, recomputed with the SDK's own profile rules from the
     * descriptors inside the verified package tree.
     */
    async #signedAuthorityDigest(
        policy: Or3PackagePolicyV1 | null,
        setup: Or3SetupDescriptorV1 | null
    ): Promise<`sha256-${string}` | null> {
        if (!policy || !setup) return null;
        try {
            const profile = defineOr3PortableProfile({
                profile: policy.profile as 'or3-portable-client-v1',
                destinations: policy.destinations,
                connections: policy.connections,
                dataScopes: policy.dataScopes,
                writes: policy.writes,
                features: policy.requiredFeatures,
                settingsSchemaPath: setup.settingsSchemaPath,
                fields: setup.fields,
                ...(setup.testAction === undefined ? {} : { testAction: setup.testAction }),
                firstAction: setup.firstAction,
            });
            return profile.revisions.policy;
        } catch {
            return null;
        }
    }

    /**
     * Setup readiness, evaluated with the host's own plan rules (settings and
     * stored connections), and re-evaluated before every activation step so a
     * retry cannot promote a package whose setup was never completed.
     */
    async #setupReadiness(
        record: PluginAcquisitionOperation,
        packageDigest: string
    ): Promise<
        | { readonly status: 'ready' | 'needs-setup' | 'blocked'; readonly message: string }
    > {
        let packageRoot: string;
        try {
            packageRoot = this.#deps.services.packages.packagePath(
                record.pluginId,
                packageDigest as `sha256-${string}`
            );
        } catch {
            return { status: 'blocked', message: 'The candidate package path is invalid.' };
        }
        const descriptors = await loadPackageDescriptors({
            extensionsBaseDir: this.#deps.extensionsRoot ?? EXTENSIONS_BASE_DIR,
            packagePath: packageRoot,
        });
        if (!descriptors.setup) return { status: 'ready', message: '' };
        if (!this.#deps.setupPlan) {
            return {
                status: 'blocked',
                message:
                    'This package declares setup, and this host cannot evaluate setup readiness here.',
            };
        }
        const plan = await this.#deps.setupPlan(record.pluginId, record.workspaceId, packageRoot);
        if (!plan || plan.status === 'ready') return { status: 'ready', message: '' };
        const message =
            plan.blockers[0] ??
            (plan.status === 'blocked'
                ? 'This host cannot satisfy the package setup requirements.'
                : 'This package needs setup before it can be used.');
        return { status: plan.status === 'blocked' ? 'blocked' : 'needs-setup', message };
    }

    /**
     * The server half of the canary. A profile that forbids server code verifies
     * the stored package and that there really are no server routes, instead of
     * sending an empty route list through the server-handler verifier.
     */
    async #serverDryRun(
        record: PluginAcquisitionOperation,
        dryRun: { readonly packagePath: string; readonly state: unknown }
    ): Promise<CandidateCanaryStepResult> {
        const requirement = acquisitionProfileRequirement(record.release?.profile ?? '');
        if (requirement?.serverRuntime === 'forbidden') {
            try {
                await this.#deps.services.packages.verifyStoredPackage(
                    record.pluginId,
                    record.candidateDigest as `sha256-${string}`
                );
                const manifest = await this.#readTreeManifest(dryRun.packagePath);
                if (!manifest || manifest.runtime.server) {
                    return { status: 'blocked', code: 'package-profile-server-runtime-forbidden' };
                }
                return { status: 'passed', code: 'no-server-runtime' };
            } catch {
                return { status: 'blocked', code: 'server-handler-invalid' };
            }
        }
        return await serverCandidateDryRun(this.#deps.services.packages, dryRun as never);
    }

    /**
     * The client half of the canary. A profile that requires a client runtime
     * cannot be promoted on a skipped check. The runner is satisfied only by
     * evidence a real browser recorded for this exact candidate; until then the
     * operation stays pending and a browser-driven retry can complete it.
     */
    async #clientCanary(
        record: PluginAcquisitionOperation,
        context: { readonly packagePath: string; readonly clientId: string }
    ): Promise<CandidateCanaryStepResult> {
        const requirement = acquisitionProfileRequirement(record.release?.profile ?? '');
        if (!requirement || requirement.clientRuntime !== 'required') {
            return { status: 'skipped', code: 'server-only-profile' };
        }
        if (!this.#deps.clientCanary) {
            return { status: 'blocked', code: 'client-canary-pending' };
        }
        return await this.#deps.clientCanary({
            pluginId: record.pluginId,
            workspaceId: record.workspaceId,
            operationId: record.operationId,
            packageDigest: record.candidateDigest as `sha256-${string}`,
            packagePath: context.packagePath,
        });
    }

    async #readStoredManifest(pluginId: string, digest: `sha256-${string}`) {
        try {
            const packagePath = this.#deps.services.packages.packagePath(pluginId, digest);
            return await this.#readTreeManifest(packagePath);
        } catch {
            return null;
        }
    }

    async #readTreeManifest(packageRoot: string) {
        try {
            return Or3ExtensionManifestV2Schema.parse(
                JSON.parse(
                    await fs.readFile(resolve(packageRoot, 'or3.manifest.json'), 'utf8')
                ) as unknown
            );
        } catch {
            return null;
        }
    }

    #operationStagingDir(operationId: string): string {
        return resolve(this.#stagingRoot, operationId);
    }

    #treeDir(operationId: string): string {
        return resolve(this.#operationStagingDir(operationId), 'tree');
    }
}

function releaseIdentity(document: ReleaseMetadataDocument): PluginAcquisitionReleaseIdentity {
    return {
        releaseId: document.releaseId,
        pluginId: document.pluginId,
        version: document.version,
        archiveSha256: document.archiveSha256,
        packageTreeSha256: document.packageTreeSha256,
        manifestSha256: document.manifestSha256,
        authoritySha256: document.authoritySha256,
        profile: document.profile,
        sourceSha256: document.sourceSha256,
        license: document.license,
        publishedAt: document.publishedAt,
    };
}

function candidateBlockFailure(stage: string, codes: readonly string[]): {
    code: PluginAcquisitionFailureCode;
    message: string;
    retryable: boolean;
} {
    const detail = codes.join(', ') || stage;
    switch (stage) {
        case 'verification':
        case 'loader':
            return {
                code: 'package-verification-failed',
                message: `The candidate failed ${stage} verification: ${detail}`,
                retryable: false,
            };
        case 'manifest':
            return {
                code: 'release-identity-mismatch',
                message: `The candidate manifest does not match the release: ${detail}`,
                retryable: false,
            };
        case 'pointer':
            return {
                code: 'pointer-conflict',
                message: `The recorded package pointer refused the candidate: ${detail}`,
                retryable: true,
            };
        case 'state':
            return {
                code: 'promotion-blocked',
                message: `The candidate is incompatible with the stored state: ${detail}`,
                retryable: false,
            };
        default:
            return {
                code: 'package-policy-mismatch',
                message: `The candidate is not approved for this host (${stage}): ${detail}`,
                retryable: false,
            };
    }
}

function promotionBlockFailure(stage: string, code: string): {
    code: PluginAcquisitionFailureCode;
    message: string;
    retryable: boolean;
} {
    const message = `Promotion was blocked at ${stage}: ${code}`;
    if (stage === 'pointer' || stage === 'pointer-write') {
        return { code: 'pointer-conflict', message, retryable: false };
    }
    if (stage === 'canary-evidence') {
        return { code: 'health-check-failed', message, retryable: true };
    }
    return { code: 'promotion-blocked', message, retryable: false };
}

async function safeFileSize(path: string): Promise<number> {
    try {
        const info = await fs.stat(path);
        return info.isFile() ? info.size : 0;
    } catch {
        return 0;
    }
}

async function safeDigest(path: string): Promise<string | null> {
    try {
        return await sha256FileIdentity(path);
    } catch {
        return null;
    }
}
