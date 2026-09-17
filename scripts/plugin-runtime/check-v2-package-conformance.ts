import { existsSync, readFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import ts from 'typescript';
import { CORE_NUXT_AUTO_IMPORTS } from '../../packages/plugin-sdk/src/conformance-rules';
import {
    composeV2Conformance,
    evaluateV2Conformance,
    readPortableJson,
    type V2ConformanceIssue,
    type V2ConformanceIssueCode,
    type V2ConformanceModule,
    type V2ConformanceResult,
} from '../../packages/plugin-sdk/src/conformance-engine';
import { PACKAGE_POLICY_FILE, PACKAGE_SETUP_FILE } from '../../packages/plugin-sdk/src/profile';
import { listArtifactFiles, listPackageFiles, posix } from './cli/shared';

/**
 * OR3 host reviewer for Plugin Runtime V2 packages.
 *
 * The decision itself is made by the shared SDK engine
 * (`packages/plugin-sdk/src/conformance-engine.ts`) against the exact artifact,
 * and the result is bound to that artifact's canonical digest.
 *
 * Only the host-specific inputs differ: the compatibility ledger expands the
 * banned Nuxt auto-import set, the SDK version comes from this checkout, and the
 * module graph is derived with the TypeScript parser (the standalone SDK falls
 * back to its lexical scanner). Source review applies the packer's exclusions;
 * artifact review scans every code file actually present, so filename-based
 * exclusions cannot hide shipped code from the gate.
 */

export type { V2ConformanceIssue, V2ConformanceIssueCode, V2ConformanceResult };

export type ConformanceReviewMode = 'source' | 'artifact';

const CODE_FILE = /\.[cm]?[jt]sx?$/;

function readJsonOrNull(path: string): unknown | null {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
        return null;
    }
}

function autoImportNames(repoRoot: string): ReadonlySet<string> {
    const names = new Set(CORE_NUXT_AUTO_IMPORTS);
    const ledgerPath = resolve(
        repoRoot,
        'planning/complete/plugin-runtime-v2/compatibility-ledger.json'
    );
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as {
        modules?: Array<{ exports?: Array<{ name?: string; nuxtAutoImport?: boolean }> }>;
    };
    for (const module of ledger.modules ?? []) {
        for (const exported of module.exports ?? []) {
            if (exported.nuxtAutoImport && exported.name) names.add(exported.name);
        }
    }
    return names;
}

function sdkVersion(repoRoot: string): string {
    const packageJson = JSON.parse(
        readFileSync(resolve(repoRoot, 'packages/plugin-sdk/package.json'), 'utf8')
    ) as { version: string };
    return packageJson.version;
}

function bindingNames(name: ts.BindingName, result: Set<string>): void {
    if (ts.isIdentifier(name)) {
        result.add(name.text);
        return;
    }
    for (const element of name.elements) {
        if (!ts.isOmittedExpression(element)) bindingNames(element.name, result);
    }
}

function declaredNames(sourceFile: ts.SourceFile): Set<string> {
    const result = new Set<string>();
    const visit = (node: ts.Node): void => {
        if (ts.isImportClause(node)) {
            if (node.name) result.add(node.name.text);
            if (node.namedBindings && ts.isNamespaceImport(node.namedBindings)) {
                result.add(node.namedBindings.name.text);
            }
        } else if (ts.isImportSpecifier(node)) {
            result.add(node.name.text);
        } else if (
            ts.isVariableDeclaration(node) ||
            ts.isParameter(node) ||
            ts.isBindingElement(node)
        ) {
            bindingNames(node.name, result);
        } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
            result.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return result;
}

function isIdentifierUse(node: ts.Identifier): boolean {
    const parent = node.parent;
    if (
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isPropertyDeclaration(parent) && parent.name === node) ||
        ts.isImportClause(parent) ||
        ts.isImportSpecifier(parent) ||
        ts.isNamespaceImport(parent) ||
        ts.isBindingElement(parent) ||
        ts.isVariableDeclaration(parent) ||
        ts.isParameter(parent) ||
        ts.isFunctionDeclaration(parent) ||
        ts.isClassDeclaration(parent)
    ) {
        return false;
    }
    return true;
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
    const result: string[] = [];
    const visit = (node: ts.Node): void => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            result.push(node.moduleSpecifier.text);
        } else if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
            node.arguments.length === 1 &&
            ts.isStringLiteral(node.arguments[0]!)
        ) {
            result.push(node.arguments[0]!.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return result;
}

function autoImportUses(
    sourceFile: ts.SourceFile,
    banned: ReadonlySet<string>
): string[] {
    const declared = declaredNames(sourceFile);
    const found = new Set<string>();
    const visit = (node: ts.Node): void => {
        if (
            ts.isIdentifier(node) &&
            banned.has(node.text) &&
            !declared.has(node.text) &&
            isIdentifierUse(node)
        ) {
            found.add(node.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return [...found];
}

/**
 * Derives per-module facts with the TypeScript parser. `source` mode applies the
 * packer's exclusions (the directory is about to be packaged); `artifact` mode
 * scans every code file present.
 */
function collectV2ModuleGraph(
    root: string,
    mode: ConformanceReviewMode,
    banned: ReadonlySet<string>
): V2ConformanceModule[] {
    let files: string[];
    try {
        files =
            mode === 'artifact'
                ? listArtifactFiles(root)
                : listPackageFiles(root, { shippableOnly: true });
    } catch {
        return [];
    }
    return files
        .filter((file) => CODE_FILE.test(file))
        .map((file) => {
            const source = readFileSync(file, 'utf8');
            const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
            return {
                path: posix(relative(root, file)),
                specifiers: moduleSpecifiers(sourceFile),
                autoImportUses: autoImportUses(sourceFile, banned),
            };
        });
}

export async function checkV2PackageConformance(
    packageRoot: string,
    options: { repoRoot?: string; mode?: ConformanceReviewMode } = {}
): Promise<V2ConformanceResult> {
    const root = resolve(packageRoot);
    const repoRoot = options.repoRoot ?? resolve(import.meta.dirname, '../..');
    const policyPath = resolve(root, PACKAGE_POLICY_FILE);
    const setupPath = resolve(root, PACKAGE_SETUP_FILE);
    const banned = autoImportNames(repoRoot);
    const decision = evaluateV2Conformance({
        manifest: readJsonOrNull(resolve(root, 'or3.manifest.json')),
        packageJson: readJsonOrNull(resolve(root, 'package.json')),
        moduleGraph: collectV2ModuleGraph(root, options.mode ?? 'source', banned),
        bannedAutoImports: banned,
        sdkVersion: sdkVersion(repoRoot),
        policy: readPortableJson(policyPath),
        setup: readPortableJson(setupPath),
        shipsPolicy: existsSync(policyPath),
        shipsSetup: existsSync(setupPath),
    });
    return composeV2Conformance(root, decision);
}

if (import.meta.main) {
    const packageArg = process.argv[2];
    if (!packageArg) throw new Error('Usage: check-v2-package-conformance.ts <package-root>');
    const result = await checkV2PackageConformance(packageArg, { mode: 'artifact' });
    if (result.status === 'nonconformant') {
        for (const entry of result.issues) {
            console.error(`[${entry.code}] ${entry.file}: ${entry.message}`);
        }
        process.exitCode = 1;
    } else {
        console.log(`[plugin-v2-conformance] ${basename(resolve(packageArg))}: ${result.status}`);
    }
}
