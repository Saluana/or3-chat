import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import type { PluginGrantReviewSnapshot } from '../../../shared/plugins/grant-review';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import { EXTENSIONS_BASE_DIR } from '../extensions/paths';
import { PluginPackagePointerStore } from './package-pointer-store';
import { ImmutablePluginPackageStore } from './package-store';

export type CandidateStateValue =
    | null
    | boolean
    | number
    | string
    | readonly CandidateStateValue[]
    | { readonly [key: string]: CandidateStateValue };

export interface CandidateDryRunContext {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly packageDigest: Sha256;
    readonly packagePath: string;
    readonly dryRun: true;
    readonly state: CandidateStateValue;
}

export interface CandidateClientCanaryContext {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly packageDigest: Sha256;
    readonly packagePath: string;
    readonly clientId: string;
    readonly visibility: 'hidden';
    readonly canPublish: false;
}

export interface CandidateCanaryStepResult {
    readonly status: 'passed' | 'skipped' | 'blocked';
    readonly code?: string;
}

export interface CandidateCanaryGrantReviewInput {
    readonly pluginId: string;
    readonly packageDigest: Sha256;
    readonly manifestDigest: Sha256;
}

export type CandidateCanaryGrantReview = Pick<
    PluginGrantReviewSnapshot,
    'revision' | 'status'
>;

export interface CandidateCanaryEvidence {
    readonly schemaVersion: 2;
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly packageDigest: Sha256;
    readonly manifestDigest: Sha256;
    readonly pointerRevision: number;
    readonly clientId: string;
    readonly stateSnapshotDigest: Sha256;
    readonly grantReviewRevision: string;
    readonly server: CandidateCanaryStepResult;
    readonly client: CandidateCanaryStepResult;
    readonly completedAt: number;
}

export interface RunPluginCandidateCanaryInput {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly packageDigest: Sha256;
    readonly clientId: string;
    readonly snapshotState: () => CandidateStateValue | Promise<CandidateStateValue>;
    /** Reads the review that applies to this exact candidate manifest. */
    readonly readGrantReview: (
        input: CandidateCanaryGrantReviewInput
    ) => CandidateCanaryGrantReview | Promise<CandidateCanaryGrantReview>;
    readonly serverDryRun: (
        context: CandidateDryRunContext
    ) => CandidateCanaryStepResult | Promise<CandidateCanaryStepResult>;
    readonly clientHiddenPrepare: (
        context: CandidateClientCanaryContext
    ) => CandidateCanaryStepResult | Promise<CandidateCanaryStepResult>;
    readonly now?: () => number;
}

export type RunPluginCandidateCanaryResult =
    | { readonly status: 'passed'; readonly evidence: CandidateCanaryEvidence }
    | {
          readonly status: 'blocked';
          readonly stage: 'pointer' | 'grants' | 'state' | 'server-dry-run' | 'client-canary';
          readonly code: string;
          readonly currentPointerUnchanged: true;
      };

function canonicalJson(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('State contains a non-finite number');
        return JSON.stringify(value);
    }
    if (!value || typeof value !== 'object') throw new Error('State contains a non-JSON value');
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new Error('State contains a non-plain object');
    }
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`
    ).join(',')}}`;
}

function cloneAndFreeze(value: CandidateStateValue): CandidateStateValue {
    const cloned = structuredClone(value) as CandidateStateValue;
    const freeze = (entry: CandidateStateValue): CandidateStateValue => {
        if (entry === null || typeof entry !== 'object') return entry;
        if (Array.isArray(entry)) {
            for (const child of entry) freeze(child);
        } else {
            for (const child of Object.values(entry)) freeze(child);
        }
        return Object.freeze(entry);
    };
    return freeze(cloned);
}

export function createCandidateStateSnapshotDigest(value: CandidateStateValue): Sha256 {
    return `sha256-${createHash('sha256')
        .update('OR3_PLUGIN_CANDIDATE_STATE_SNAPSHOT_V1\0')
        .update(canonicalJson(value))
        .digest('hex')}` as Sha256;
}

function validWorkspaceId(workspaceId: string): boolean {
    return (
        workspaceId.trim().length > 0 &&
        workspaceId.length <= 256 &&
        !/[\u0000-\u001f\u007f]/.test(workspaceId)
    );
}

function validStepResult(value: unknown): value is CandidateCanaryStepResult {
    if (!value || typeof value !== 'object') return false;
    const result = value as Partial<CandidateCanaryStepResult>;
    return (
        (result.status === 'passed' || result.status === 'skipped' || result.status === 'blocked') &&
        (result.code === undefined || (typeof result.code === 'string' && result.code.length > 0))
    );
}

function validGrantReview(value: unknown): value is CandidateCanaryGrantReview {
    if (!value || typeof value !== 'object') return false;
    const review = value as Partial<CandidateCanaryGrantReview>;
    return (
        typeof review.revision === 'string' &&
        review.revision.length > 0 &&
        (review.status === 'current' ||
            review.status === 'unreviewed' ||
            review.status === 'stale')
    );
}

function blocked(
    stage: Extract<RunPluginCandidateCanaryResult, { status: 'blocked' }>['stage'],
    code: string
): RunPluginCandidateCanaryResult {
    return Object.freeze({ status: 'blocked', stage, code, currentPointerUnchanged: true });
}

async function fsyncDirectory(directory: string): Promise<void> {
    const handle = await fs.open(directory, constants.O_RDONLY);
    try {
        await handle.sync();
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error
            ? (error as { code?: string }).code
            : undefined;
        if (code !== 'EINVAL' && code !== 'ENOTSUP') throw error;
    } finally {
        await handle.close();
    }
}

export class PluginPackageCandidateCanaryService {
    readonly #evidenceRoot: string;

    constructor(
        readonly packages: ImmutablePluginPackageStore,
        readonly pointers: PluginPackagePointerStore,
        extensionsRoot = EXTENSIONS_BASE_DIR
    ) {
        this.#evidenceRoot = resolve(extensionsRoot, '.state', 'candidate-canary');
    }

    evidencePath(pluginId: string, packageDigest: Sha256, workspaceId: string): string {
        // packagePath performs the shared strict plugin/digest validation first.
        this.packages.packagePath(pluginId, packageDigest);
        if (!validWorkspaceId(workspaceId)) {
            throw new Error('Invalid workspace id for candidate canary evidence');
        }
        const workspaceKey = createHash('sha256')
            .update('OR3_PLUGIN_CANDIDATE_CANARY_WORKSPACE_V1\0')
            .update(workspaceId)
            .digest('hex');
        return resolve(this.#evidenceRoot, pluginId, `${packageDigest}.${workspaceKey}.json`);
    }

    run(input: RunPluginCandidateCanaryInput): Promise<RunPluginCandidateCanaryResult> {
        return this.packages.runPluginOperation(input.pluginId, async () => {
            if (!validWorkspaceId(input.workspaceId)) {
                return blocked('state', 'workspace-id-invalid');
            }
            if (
                input.clientId.trim().length === 0 ||
                input.clientId.length > 256 ||
                /[\u0000-\u001f\u007f]/.test(input.clientId)
            ) {
                return blocked('client-canary', 'client-id-invalid');
            }
            const selection = await this.pointers.readStartupSelection(input.pluginId);
            const pointer = selection.pointer;
            if (
                (selection.status !== 'ready' && selection.status !== 'inactive') ||
                !pointer?.candidate ||
                pointer.candidate.packageDigest !== input.packageDigest
            ) {
                return blocked('pointer', 'candidate-pointer-mismatch');
            }
            let verification;
            try {
                verification = await this.packages.verifyStoredPackage(
                    input.pluginId,
                    input.packageDigest
                );
            } catch {
                return blocked('pointer', 'candidate-package-unavailable');
            }
            if (verification.manifestDigest !== pointer.candidate.manifestDigest) {
                return blocked('pointer', 'candidate-manifest-mismatch');
            }

            let grantReview: CandidateCanaryGrantReview;
            try {
                grantReview = await input.readGrantReview(
                    Object.freeze({
                        pluginId: input.pluginId,
                        packageDigest: input.packageDigest,
                        manifestDigest: verification.manifestDigest,
                    })
                );
            } catch {
                return blocked('grants', 'grant-review-unavailable');
            }
            if (!validGrantReview(grantReview)) {
                return blocked('grants', 'grant-review-invalid');
            }
            if (grantReview.status !== 'current') {
                return blocked('grants', `grant-review-${grantReview.status}`);
            }

            let state: CandidateStateValue;
            try {
                state = cloneAndFreeze(await input.snapshotState());
                canonicalJson(state);
            } catch {
                return blocked('state', 'state-snapshot-invalid');
            }

            let server: CandidateCanaryStepResult;
            try {
                server = await input.serverDryRun(Object.freeze({
                    pluginId: input.pluginId,
                    workspaceId: input.workspaceId,
                    packageDigest: input.packageDigest,
                    packagePath: this.packages.packagePath(input.pluginId, input.packageDigest),
                    dryRun: true,
                    state,
                }));
            } catch {
                return blocked('server-dry-run', 'server-dry-run-threw');
            }
            if (!validStepResult(server)) return blocked('server-dry-run', 'server-dry-run-invalid');
            if (server.status === 'blocked') {
                return blocked('server-dry-run', server.code ?? 'server-dry-run-blocked');
            }

            let client: CandidateCanaryStepResult;
            try {
                client = await input.clientHiddenPrepare(Object.freeze({
                    pluginId: input.pluginId,
                    workspaceId: input.workspaceId,
                    packageDigest: input.packageDigest,
                    packagePath: this.packages.packagePath(input.pluginId, input.packageDigest),
                    clientId: input.clientId,
                    visibility: 'hidden',
                    canPublish: false,
                }));
            } catch {
                return blocked('client-canary', 'client-canary-threw');
            }
            if (!validStepResult(client)) return blocked('client-canary', 'client-canary-invalid');
            if (client.status === 'blocked') {
                return blocked('client-canary', client.code ?? 'client-canary-blocked');
            }

            const evidence: CandidateCanaryEvidence = Object.freeze({
                schemaVersion: 2,
                pluginId: input.pluginId,
                workspaceId: input.workspaceId,
                packageDigest: input.packageDigest,
                manifestDigest: verification.manifestDigest,
                pointerRevision: pointer.revision,
                clientId: input.clientId,
                stateSnapshotDigest: createCandidateStateSnapshotDigest(state),
                grantReviewRevision: grantReview.revision,
                server: Object.freeze({ ...server }),
                client: Object.freeze({ ...client }),
                completedAt: (input.now ?? Date.now)(),
            });
            const path = this.evidencePath(
                input.pluginId,
                input.packageDigest,
                input.workspaceId
            );
            const directory = resolve(path, '..');
            await fs.mkdir(directory, { recursive: true, mode: 0o700 });
            const temporary = resolve(directory, `.${input.packageDigest}.${randomUUID()}.tmp`);
            const handle = await fs.open(temporary, 'wx', 0o600);
            try {
                await handle.writeFile(`${JSON.stringify(evidence)}\n`, 'utf8');
                await handle.sync();
            } finally {
                await handle.close();
            }
            await fs.rename(temporary, path);
            await fsyncDirectory(directory);
            return Object.freeze({ status: 'passed', evidence });
        });
    }
}
