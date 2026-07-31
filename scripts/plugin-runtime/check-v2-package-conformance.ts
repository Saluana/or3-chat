import { readFileSync, readdirSync } from 'node:fs';
import { basename, extname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { satisfies, validRange } from 'semver';

export type V2ConformanceIssueCode =
    | 'manifest-invalid'
    | 'sdk-dependency-missing'
    | 'sdk-range-invalid'
    | 'sdk-range-mismatch'
    | 'plugin-api-range-invalid'
    | 'plugin-api-range-mismatch'
    | 'private-host-import'
    | 'unresolved-bare-import'
    | 'nuxt-auto-import';

export interface V2ConformanceIssue {
    readonly code: V2ConformanceIssueCode;
    readonly file: string;
    readonly subject?: string;
    readonly message: string;
}

export type V2ConformanceResult =
    | { readonly status: 'legacy-v1'; readonly issues: readonly [] }
    | { readonly status: 'conformant'; readonly issues: readonly [] }
    | { readonly status: 'nonconformant'; readonly issues: readonly V2ConformanceIssue[] };

const PRIVATE_IMPORT_PREFIXES = [
    '~/',
    '~~/',
    '@/',
    '@@/',
    '#imports',
    '#app',
    '#build',
    '#internal',
];
const ALLOWED_BARE_IMPORTS = new Set([
    '@or3/plugin-sdk',
    '@or3/plugin-sdk/manifest',
    'vue',
]);
const CORE_NUXT_AUTO_IMPORTS = new Set([
    '$fetch',
    'computed',
    'defineNuxtComponent',
    'defineNuxtPlugin',
    'navigateTo',
    'onMounted',
    'onUnmounted',
    'reactive',
    'ref',
    'useAsyncData',
    'useCookie',
    'useFetch',
    'useNuxtApp',
    'useRoute',
    'useRouter',
    'useRuntimeConfig',
    'useState',
    'watch',
    'watchEffect',
]);

function posix(path: string): string {
    return path.split(sep).join('/');
}

function codeFiles(root: string): string[] {
    const result: string[] = [];
    const visit = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) visit(path);
            else if (
                entry.isFile() &&
                ['.js', '.mjs', '.cjs', '.ts', '.tsx'].includes(extname(path))
            ) {
                result.push(path);
            }
        }
    };
    visit(root);
    return result.sort();
}

function isBareImport(specifier: string): boolean {
    return !specifier.startsWith('.') && !specifier.startsWith('/') && !/^[a-z]+:/i.test(specifier);
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
    const visit = (node: ts.Node) => {
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
        } else if (
            (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
            node.name
        ) {
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

function autoImportNames(repoRoot: string): Set<string> {
    const names = new Set(CORE_NUXT_AUTO_IMPORTS);
    const ledgerPath = resolve(repoRoot, 'planning/plugin-runtime-v2/compatibility-ledger.json');
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

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
    const result: string[] = [];
    const visit = (node: ts.Node) => {
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

export function checkV2PackageConformance(
    packageRoot: string,
    options: { repoRoot?: string } = {}
): V2ConformanceResult {
    const root = resolve(packageRoot);
    const repoRoot = options.repoRoot ?? resolve(import.meta.dirname, '../..');
    const manifestPath = resolve(root, 'or3.manifest.json');
    const packageJsonPath = resolve(root, 'package.json');
    const issues: V2ConformanceIssue[] = [];
    const issue = (entry: V2ConformanceIssue) => issues.push(Object.freeze(entry));
    let manifest: {
        manifestVersion?: unknown;
        engines?: { pluginApi?: unknown };
    };
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest;
    } catch {
        return {
            status: 'nonconformant',
            issues: [
                {
                    code: 'manifest-invalid',
                    file: 'or3.manifest.json',
                    message: 'Package manifest is missing or invalid JSON',
                },
            ],
        };
    }
    if ((manifest.manifestVersion ?? 1) !== 2) {
        return { status: 'legacy-v1', issues: [] };
    }
    let packageJson: {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
    } = {};
    let packageJsonLoaded = true;
    try {
        packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as typeof packageJson;
    } catch {
        packageJsonLoaded = false;
        issue({
            code: 'sdk-dependency-missing',
            file: 'package.json',
            subject: '@or3/plugin-sdk',
            message: 'V2 package must declare an @or3/plugin-sdk dependency',
        });
    }
    const sdkPackage = JSON.parse(
        readFileSync(resolve(repoRoot, 'packages/plugin-sdk/package.json'), 'utf8')
    ) as { version: string };
    const sdkRange =
        packageJson.dependencies?.['@or3/plugin-sdk'] ??
        packageJson.peerDependencies?.['@or3/plugin-sdk'];
    if (packageJsonLoaded && !sdkRange) {
        issue({
            code: 'sdk-dependency-missing',
            file: 'package.json',
            subject: '@or3/plugin-sdk',
            message: 'V2 package must declare an @or3/plugin-sdk dependency',
        });
    } else if (!validRange(sdkRange)) {
        issue({
            code: 'sdk-range-invalid',
            file: 'package.json',
            subject: sdkRange,
            message: 'The @or3/plugin-sdk dependency range is invalid',
        });
    } else if (!satisfies(sdkPackage.version, sdkRange)) {
        issue({
            code: 'sdk-range-mismatch',
            file: 'package.json',
            subject: sdkRange,
            message: `SDK ${sdkPackage.version} is outside the package dependency range`,
        });
    }
    const pluginApiRange = manifest.engines?.pluginApi;
    if (typeof pluginApiRange !== 'string' || !validRange(pluginApiRange)) {
        issue({
            code: 'plugin-api-range-invalid',
            file: 'or3.manifest.json',
            subject: String(pluginApiRange),
            message: 'Manifest plugin API engine range is invalid',
        });
    } else if (!satisfies(sdkPackage.version, pluginApiRange)) {
        issue({
            code: 'plugin-api-range-mismatch',
            file: 'or3.manifest.json',
            subject: pluginApiRange,
            message: `SDK API ${sdkPackage.version} is outside the manifest range`,
        });
    }

    const bannedAutoImports = autoImportNames(repoRoot);
    for (const file of codeFiles(root)) {
        const source = readFileSync(file, 'utf8');
        const fileName = posix(relative(root, file));
        const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
        const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
        const imports = moduleSpecifiers(sourceFile);
        for (const specifier of imports) {
            if (
                PRIVATE_IMPORT_PREFIXES.some(
                    (prefix) => specifier === prefix || specifier.startsWith(prefix)
                )
            ) {
                issue({
                    code: 'private-host-import',
                    file: fileName,
                    subject: specifier,
                    message: `V2 packages cannot import OR3 private path ${specifier}`,
                });
            } else if (isBareImport(specifier) && !ALLOWED_BARE_IMPORTS.has(specifier)) {
                issue({
                    code: 'unresolved-bare-import',
                    file: fileName,
                    subject: specifier,
                    message: `Bare import ${specifier} is not an allowed host external`,
                });
            }
        }
        const declared = declaredNames(sourceFile);
        const reported = new Set<string>();
        const visit = (node: ts.Node) => {
            if (
                ts.isIdentifier(node) &&
                isIdentifierUse(node) &&
                bannedAutoImports.has(node.text) &&
                !declared.has(node.text) &&
                !reported.has(node.text)
            ) {
                reported.add(node.text);
                issue({
                    code: 'nuxt-auto-import',
                    file: fileName,
                    subject: node.text,
                    message: `V2 package uses Nuxt auto-import ${node.text}`,
                });
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    if (issues.length > 0) {
        issues.sort((left, right) =>
            `${left.file}:${left.code}:${left.subject ?? ''}`.localeCompare(
                `${right.file}:${right.code}:${right.subject ?? ''}`
            )
        );
        return { status: 'nonconformant', issues: Object.freeze(issues) };
    }
    return { status: 'conformant', issues: [] };
}

if (import.meta.main) {
    const packageArg = process.argv[2];
    if (!packageArg) throw new Error('Usage: check-v2-package-conformance.ts <package-root>');
    const result = checkV2PackageConformance(packageArg);
    if (result.status === 'nonconformant') {
        for (const entry of result.issues) {
            console.error(`[${entry.code}] ${entry.file}: ${entry.message}`);
        }
        process.exitCode = 1;
    } else {
        console.log(`[plugin-v2-conformance] ${basename(resolve(packageArg))}: ${result.status}`);
    }
}
