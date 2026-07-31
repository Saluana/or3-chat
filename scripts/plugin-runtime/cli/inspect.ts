import { readFileSync, rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import {
    preflightPluginStateCompatibility,
    type PluginStateCompatibilityPolicy,
} from '../../../shared/plugins/state-compatibility';
import { verifyPackageTree } from '../../../server/admin/plugins/package-tree';
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
    readonly statePreflight: ReturnType<typeof preflightPluginStateCompatibility> | null;
    readonly conformanceStatus: string;
    /** True when this inspection did not import/execute plugin modules. */
    readonly importedPluginCode: false;
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
    const imports: string[] = [];
    const visit = (node: ts.Node) => {
        if (
            ts.isImportDeclaration(node) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            imports.push(node.moduleSpecifier.text);
        } else if (
            ts.isExportDeclaration(node) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            imports.push(node.moduleSpecifier.text);
        } else if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments[0] &&
            ts.isStringLiteralLike(node.arguments[0])
        ) {
            imports.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return imports;
}

function parseStateCompatibility(
    raw: unknown
): PluginStateCompatibilityPolicy | null {
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

/**
 * Inspect a V2 package without importing plugin code.
 * Digest matches server `verifyPackageTree` over the shippable pack tree.
 */
export async function inspectV2Package(
    packageRoot: string,
    options: { readonly repoRoot?: string } = {}
): Promise<InspectCommandResult> {
    const root = assertPackageRoot(packageRoot);
    const manifest = readJsonObject(resolve(root, 'or3.manifest.json'));
    const moduleGraph = listPackageFiles(root)
        .filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !/\.(test|spec)\./i.test(file))
        .map((file) => {
            const source = readFileSync(file, 'utf8');
            const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
            const sourceFile = ts.createSourceFile(
                file,
                source,
                ts.ScriptTarget.Latest,
                true,
                kind
            );
            return {
                file: posix(relative(root, file)),
                imports: Object.freeze(moduleSpecifiers(sourceFile)),
            };
        });

    const packRoot = resolve(root, '.or3-pack-inspect');
    try {
        materializePackTree(root, packRoot);
        const verification = await verifyPackageTree(packRoot);
        const conformance = checkV2PackageConformance(root, {
            repoRoot: options.repoRoot ?? repoRootFromCli(),
        });
        const stateCompatibility = parseStateCompatibility(manifest.stateCompatibility);
        const grants = Array.isArray(manifest.requestedGrants)
            ? manifest.requestedGrants.filter((entry): entry is string => typeof entry === 'string')
            : [];
        const trust = typeof manifest.trust === 'string' ? manifest.trust : null;

        return {
            root,
            manifest,
            moduleGraph: Object.freeze(moduleGraph),
            digest: verification.digest,
            manifestDigest: verification.manifestDigest,
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
            conformanceStatus: conformance.status,
            importedPluginCode: false,
        };
    } finally {
        rmSync(packRoot, { recursive: true, force: true });
    }
}
