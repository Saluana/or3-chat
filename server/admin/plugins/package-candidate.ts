import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import {
    preflightPluginStateCompatibility,
    type PluginStatePreflightResult,
} from '../../../shared/plugins/state-compatibility';
import type { PluginGrantReviewSnapshot } from '../../../shared/plugins/grant-review';
import {
    resolvePluginV2DependencyGraph,
    type PluginV2DependencyGraphResult,
    type PluginV2GraphNode,
} from '../../../shared/plugins/v2-dependency-graph';
import {
    verifyPluginV2Compatibility,
    type AvailablePluginV2Dependency,
    type PluginV2CompatibilityResult,
    type PluginV2HostCapabilities,
} from '../../../shared/plugins/v2-compatibility';
import {
    Or3ExtensionManifestV2Schema,
    type Or3ExtensionManifestV2,
} from '../extensions/types';
import {
    type PackagePointerStartupSelection,
    PluginPackagePointerStore,
    type PluginPackagePointer,
    type PluginPackagePointerTarget,
} from './package-pointer-store';
import { ImmutablePluginPackageStore, type StoredPluginPackage } from './package-store';
import { verifyPackageTree, type VerifiedPackageTree } from './package-tree';

export interface CandidateLoaderPreflightResult {
    readonly status: 'eligible' | 'blocked';
    readonly codes: readonly string[];
}

export interface PreparePluginPackageCandidateInput {
    readonly pluginId: string;
    readonly sourceRoot: string;
    readonly expectedDigest?: Sha256;
    readonly host: PluginV2HostCapabilities;
    readonly availableDependencies: readonly AvailablePluginV2Dependency[];
    readonly dependencyNodes: readonly PluginV2GraphNode[];
    readonly grantReview: PluginGrantReviewSnapshot;
    readonly storedStateVersion: number | null;
    readonly loaderPreflight: (input: {
        readonly manifest: Or3ExtensionManifestV2;
        readonly sourceRoot: string;
        readonly verification: VerifiedPackageTree;
    }) => CandidateLoaderPreflightResult | Promise<CandidateLoaderPreflightResult>;
    readonly now?: () => number;
}

export interface PluginCandidateGateEvidence {
    readonly compatibility: PluginV2CompatibilityResult;
    readonly dependencies: PluginV2DependencyGraphResult;
    readonly state: PluginStatePreflightResult;
    readonly loader: CandidateLoaderPreflightResult;
}

export type PreparePluginPackageCandidateResult =
    | {
          readonly status: 'candidate-stored';
          readonly pointerUnchanged: boolean;
          readonly manifest: Or3ExtensionManifestV2;
          readonly stored: StoredPluginPackage;
          readonly pointer: PluginPackagePointer;
          readonly evidence: PluginCandidateGateEvidence;
      }
    | {
          readonly status: 'blocked';
          readonly pointerUnchanged: true;
          readonly stage:
              | 'verification'
              | 'manifest'
              | 'pointer'
              | 'compatibility'
              | 'grants'
              | 'dependencies'
              | 'loader'
              | 'state';
          readonly codes: readonly string[];
      };

function blocked(
    stage: Extract<PreparePluginPackageCandidateResult, { status: 'blocked' }>['stage'],
    codes: readonly string[]
): PreparePluginPackageCandidateResult {
    return Object.freeze({
        status: 'blocked',
        pointerUnchanged: true,
        stage,
        codes: Object.freeze([...codes]),
    });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
    return [...left].sort().join('\0') === [...right].sort().join('\0');
}

function grantReviewCodes(
    manifest: Or3ExtensionManifestV2,
    review: PluginGrantReviewSnapshot
): string[] {
    const codes: string[] = [];
    if (review.status !== 'current') codes.push(`grant-review-${review.status}`);
    if (!sameStrings(review.requestedGrants, manifest.requestedGrants)) {
        codes.push('grant-review-request-mismatch');
    }
    if (!review.approvedGrants.every((grant) => manifest.requestedGrants.includes(grant))) {
        codes.push('grant-review-approval-invalid');
    }
    return codes;
}

function candidateGraphNode(manifest: Or3ExtensionManifestV2): PluginV2GraphNode {
    return {
        id: manifest.id,
        version: manifest.version,
        dependencies: {
            required: manifest.dependencies.required,
            optional: manifest.dependencies.optional,
        },
    };
}

function pointerCanAcceptCandidate(selection: PackagePointerStartupSelection): boolean {
    return selection.status === 'ready' || selection.status === 'inactive';
}

export class PluginPackageCandidateService {
    constructor(
        readonly packages: ImmutablePluginPackageStore,
        readonly pointers: PluginPackagePointerStore
    ) {}

    prepare(
        input: PreparePluginPackageCandidateInput
    ): Promise<PreparePluginPackageCandidateResult> {
        return this.packages.runPluginOperation(input.pluginId, async () => {
            let verification: VerifiedPackageTree;
            try {
                verification = await verifyPackageTree(input.sourceRoot, {
                    expectedDigest: input.expectedDigest,
                });
            } catch (error) {
                const code = error && typeof error === 'object' && 'code' in error
                    ? String((error as { code?: unknown }).code)
                    : 'package-verification-failed';
                return blocked('verification', [code]);
            }

            let manifest: Or3ExtensionManifestV2;
            try {
                const raw = JSON.parse(
                    await fs.readFile(resolve(input.sourceRoot, 'or3.manifest.json'), 'utf8')
                ) as unknown;
                manifest = Or3ExtensionManifestV2Schema.parse(raw);
            } catch {
                return blocked('manifest', ['manifest-v2-invalid']);
            }
            if (
                manifest.id !== input.pluginId ||
                verification.manifestId !== manifest.id ||
                verification.manifestVersion !== 2
            ) {
                return blocked('manifest', ['package-identity-mismatch']);
            }

            const selection = await this.pointers.readStartupSelection(input.pluginId);
            if (!pointerCanAcceptCandidate(selection)) {
                return blocked('pointer', selection.issues.map((entry) => entry.code));
            }

            const compatibility = verifyPluginV2Compatibility({
                manifest,
                host: input.host,
                dependencies: input.availableDependencies,
            });
            if (compatibility.status === 'blocked') {
                return blocked('compatibility', compatibility.reasons.map((reason) => reason.code));
            }

            const grants = grantReviewCodes(manifest, input.grantReview);
            if (grants.length > 0) return blocked('grants', grants);

            const dependencies = resolvePluginV2DependencyGraph([
                ...input.dependencyNodes.filter((node) => node.id !== manifest.id),
                candidateGraphNode(manifest),
            ]);
            const dependencyBlocks = dependencies.blocked[manifest.id] ?? [];
            if (dependencyBlocks.length > 0) {
                return blocked('dependencies', dependencyBlocks.map((entry) => entry.code));
            }

            const loader = await input.loaderPreflight({
                manifest,
                sourceRoot: input.sourceRoot,
                verification,
            });
            if (loader.status === 'blocked') return blocked('loader', loader.codes);

            const state = preflightPluginStateCompatibility({
                operation: selection.pointer?.current ? 'upgrade' : 'install',
                storedStateVersion: input.storedStateVersion,
                target: manifest.stateCompatibility,
                current: selection.pointer?.current?.stateCompatibility,
            });
            if (state.status !== 'eligible') return blocked('state', [state.code]);

            const stored = await this.packages.installPackageWithinOperation(
                input.pluginId,
                input.sourceRoot,
                input.expectedDigest
            );
            if (
                stored.digest !== verification.digest ||
                stored.verification.manifestDigest !== verification.manifestDigest
            ) {
                return blocked('verification', ['package-changed-after-preflight']);
            }

            const currentPointer = selection.pointer;
            if (currentPointer?.candidate?.packageDigest === stored.digest) {
                return Object.freeze({
                    status: 'candidate-stored',
                    pointerUnchanged: true,
                    manifest,
                    stored,
                    pointer: currentPointer,
                    evidence: Object.freeze({ compatibility, dependencies, state, loader }),
                });
            }
            const candidate: PluginPackagePointerTarget = Object.freeze({
                packageDigest: stored.digest,
                manifestDigest: stored.verification.manifestDigest,
                recordedAt: (input.now ?? Date.now)(),
                stateCompatibility: manifest.stateCompatibility,
            });
            const nextPointer: PluginPackagePointer = {
                schemaVersion: 1,
                pluginId: input.pluginId,
                revision: (currentPointer?.revision ?? 0) + 1,
                current: currentPointer?.current ?? null,
                candidate,
                previous: currentPointer?.previous ?? null,
            };
            await this.pointers.writePointerWithinOperation(input.pluginId, nextPointer);
            return Object.freeze({
                status: 'candidate-stored',
                pointerUnchanged: false,
                manifest,
                stored,
                pointer: nextPointer,
                evidence: Object.freeze({ compatibility, dependencies, state, loader }),
            });
        });
    }
}
