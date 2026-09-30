import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { moduleSpecifiers } from '../../../packages/plugin-sdk/src/conformance-engine';
import {
    preflightPluginStateCompatibility,
    type PluginStateCompatibilityPolicy,
    type PluginStatePreflightResult,
} from '../../../shared/plugins/state-compatibility';
import {
    verifyPackageTree,
    type VerifiedPackageTree,
} from '../../../server/admin/plugins/package-tree';
import { readPackageZip } from '../../../shared/plugins/package-archive';
import { checkV2PackageConformance } from '../check-v2-package-conformance';
import {
    assertPackageRoot,
    listPackageFiles,
    materializePackTree,
    posix,
    readJsonObject,
    repoRootFromCli,
} from './shared';

export interface InspectCommandResult {
    readonly root: string;
    readonly manifest: Record<string, unknown>;
    readonly moduleGraph: readonly {
        readonly file: string;
        readonly imports: readonly string[];
    }[];
    readonly digest: string;
    readonly manifestDigest: string;
    readonly grants: readonly string[];
    readonly trust: string | null;
    readonly stateCompatibility: PluginStateCompatibilityPolicy | null;
    readonly statePreflight: PluginStatePreflightResult | null;
    readonly conformanceStatus: string;
    /** True when this inspection did not import/execute plugin modules. */
    readonly importedPluginCode: false;
}

const CODE_FILE = /\.[cm]?[jt]sx?$/;

function parseStateCompatibility(raw: unknown): PluginStateCompatibilityPolicy | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const reads = value.reads;
    if (
        typeof value.version !== 'number' ||
        !reads ||
        typeof reads !== 'object' ||
        Array.isArray(reads) ||
        typeof (reads as { minimum?: unknown }).minimum !== 'number' ||
        typeof (reads as { maximum?: unknown }).maximum !== 'number' ||
        (value.rollback !== 'safe' &&
            value.rollback !== 'migration-required' &&
            value.rollback !== 'unsupported')
    ) {
        return null;
    }
    return {
        version: value.version,
        reads: {
            minimum: (reads as { minimum: number }).minimum,
            maximum: (reads as { maximum: number }).maximum,
        },
        rollback: value.rollback,
    };
}

function readManifestAndGraph(root: string): Pick<InspectCommandResult, 'manifest' | 'moduleGraph'> {
    const manifest = readJsonObject(resolve(root, 'or3.manifest.json'));
    const moduleGraph = listPackageFiles(root, { shippableOnly: true })
        .filter((file) => CODE_FILE.test(file))
        .map((file) => ({
            file: posix(relative(root, file)),
            imports: Object.freeze(moduleSpecifiers(readFileSync(file, 'utf8'))),
        }));
    return { manifest, moduleGraph: Object.freeze(moduleGraph) };
}

function assembleResult(args: {
    readonly root: string;
    readonly reportedRoot: string;
    readonly manifest: Record<string, unknown>;
    readonly moduleGraph: InspectCommandResult['moduleGraph'];
    readonly verification: VerifiedPackageTree;
    readonly conformanceStatus: string;
}): InspectCommandResult {
    const { manifest } = args;
    const grants = Array.isArray(manifest.requestedGrants)
        ? manifest.requestedGrants.filter((entry): entry is string => typeof entry === 'string')
        : [];
    const trust = typeof manifest.trust === 'string' ? manifest.trust : null;
    const stateCompatibility = parseStateCompatibility(manifest.stateCompatibility);
    return {
        root: args.reportedRoot,
        manifest,
        moduleGraph: args.moduleGraph,
        digest: args.verification.digest,
        manifestDigest: args.verification.manifestDigest,
        grants: Object.freeze(grants),
        trust,
        stateCompatibility,
        statePreflight: stateCompatibility
            ? preflightPluginStateCompatibility({
                  operation: 'install',
                  storedStateVersion: null,
                  target: stateCompatibility,
              })
            : null,
        conformanceStatus: args.conformanceStatus,
        importedPluginCode: false,
    };
}

/**
 * Inspect a source package root: the shippable tree is materialised first, so
 * both the reported digest and the conformance decision describe exactly what
 * the packer would ship.
 */
async function inspectPackageDirectory(
    packageRoot: string,
    options: { readonly repoRoot?: string; readonly reportedRoot?: string } = {}
): Promise<InspectCommandResult> {
    const root = assertPackageRoot(packageRoot);
    const { manifest, moduleGraph } = readManifestAndGraph(root);
    const packRoot = mkdtempSync(resolve(tmpdir(), 'or3-inspect-pack-'));
    try {
        materializePackTree(root, packRoot);
        const verification = await verifyPackageTree(packRoot);
        const conformance = await checkV2PackageConformance(packRoot, {
            repoRoot: options.repoRoot ?? repoRootFromCli(),
            mode: 'artifact',
        });
        return assembleResult({
            root,
            reportedRoot: options.reportedRoot ?? root,
            manifest,
            moduleGraph,
            verification,
            conformanceStatus: conformance.status,
        });
    } finally {
        rmSync(packRoot, { recursive: true, force: true });
    }
}

/**
 * Inspect an extracted archive artifact directly: no re-materialisation, so the
 * digest, manifest digest and conformance decision all describe the exact
 * bytes the archive verified.
 */
async function inspectExtractedArtifact(
    extractedRoot: string,
    reportedRoot: string,
    options: { readonly repoRoot?: string } = {}
): Promise<InspectCommandResult> {
    const root = assertPackageRoot(extractedRoot);
    const { manifest, moduleGraph } = readManifestAndGraph(root);
    const verification = await verifyPackageTree(root);
    const conformance = await checkV2PackageConformance(root, {
        repoRoot: options.repoRoot ?? repoRootFromCli(),
        mode: 'artifact',
    });
    return assembleResult({
        root,
        reportedRoot,
        manifest,
        moduleGraph,
        verification,
        conformanceStatus: conformance.status,
    });
}

/**
 * Inspect a V2 package from either a package root directory or a deterministic
 * transport archive (`.or3pkg`/`.zip`). A directory is a source tree that is
 * legitimately materialised before hashing; an archive is an already-built
 * artifact and is verified exactly as extracted.
 */
export async function inspectV2Package(
    input: string,
    options: { readonly repoRoot?: string } = {}
): Promise<InspectCommandResult> {
    const resolved = resolve(input);
    const stats = statSync(resolved);
    if (stats.isDirectory()) return inspectPackageDirectory(resolved, options);
    if (!stats.isFile()) {
        throw new Error(`Package input is neither a directory nor an archive: ${input}`);
    }
    const extractedRoot = mkdtempSync(resolve(tmpdir(), 'or3-inspect-archive-'));
    try {
        await readPackageZip(readFileSync(resolved), { extractDirectory: extractedRoot });
        return await inspectExtractedArtifact(extractedRoot, resolved, options);
    } finally {
        rmSync(extractedRoot, { recursive: true, force: true });
    }
}
