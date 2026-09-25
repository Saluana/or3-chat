import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

type Runtime = 'client' | 'server' | 'shared';

interface ModuleConfig {
    source: string;
    runtime: Runtime;
    publicPaths: string[];
    docs: string[];
    behaviorProfileIds?: string[];
}

interface LedgerConfig {
    version: 1;
    nuxtImportsDeclaration: string;
    behaviorProfiles: string;
    modules: ModuleConfig[];
}

interface BehaviorProfile {
    id: string;
    family: string;
    sources: string[];
    globalKeys: string[];
    implementation: 'shared-createRegistry' | 'legacy-equivalent';
    behavior: Record<string, unknown>;
}

interface BehaviorProfileCatalog {
    schemaVersion: 1;
    profiles: BehaviorProfile[];
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = resolve(repoRoot, 'planning/complete/plugin-runtime-v2/compatibility-ledger.modules.json');
const outputPath = resolve(repoRoot, 'planning/complete/plugin-runtime-v2/compatibility-ledger.json');
const tsconfigPath = resolve(repoRoot, '.nuxt/tsconfig.app.json');
const checkOnly = process.argv.includes('--check');

function fail(message: string): never {
    throw new Error(`[compatibility-ledger] ${message}`);
}

function posixPath(path: string): string {
    return path.split(sep).join('/');
}

function repoPath(path: string): string {
    return posixPath(relative(repoRoot, path));
}

function sha256(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

function withoutExtension(path: string): string {
    const extension = extname(path);
    return extension ? path.slice(0, -extension.length) : path;
}

function readConfig(): LedgerConfig {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as LedgerConfig;
    if (config.version !== 1 || !Array.isArray(config.modules) || !config.modules.length) {
        fail('module manifest must be version 1 and contain at least one module');
    }
    const seenSources = new Set<string>();
    for (const module of config.modules) {
        if (seenSources.has(module.source)) fail(`duplicate module source: ${module.source}`);
        seenSources.add(module.source);
        if (!['client', 'server', 'shared'].includes(module.runtime)) fail(`invalid runtime for ${module.source}: ${module.runtime}`);
        if (!module.publicPaths.length) fail(`no public paths for ${module.source}`);
        if (!existsSync(resolve(repoRoot, module.source))) fail(`missing source: ${module.source}`);
        for (const doc of module.docs) {
            if (!existsSync(resolve(repoRoot, doc))) fail(`missing documentation reference: ${doc}`);
        }
    }
    return config;
}

function readBehaviorProfiles(config: LedgerConfig): BehaviorProfileCatalog {
    const profilePath = resolve(repoRoot, config.behaviorProfiles);
    if (!existsSync(profilePath)) fail(`missing behavior profile catalog: ${config.behaviorProfiles}`);
    const catalog = JSON.parse(readFileSync(profilePath, 'utf8')) as BehaviorProfileCatalog;
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.profiles) || !catalog.profiles.length) {
        fail('behavior profile catalog must be schema version 1 and contain profiles');
    }
    const profileIds = new Set<string>();
    for (const profile of catalog.profiles) {
        if (profileIds.has(profile.id)) fail(`duplicate behavior profile: ${profile.id}`);
        profileIds.add(profile.id);
        for (const source of profile.sources) {
            if (!existsSync(resolve(repoRoot, source))) fail(`missing behavior profile source: ${source}`);
        }
    }
    for (const module of config.modules) {
        for (const profileId of module.behaviorProfileIds ?? []) {
            if (!profileIds.has(profileId)) fail(`unknown behavior profile ${profileId} on ${module.source}`);
        }
    }
    return catalog;
}

function parseNuxtAutoImports(declarationPath: string): Map<string, Set<string>> {
    if (!existsSync(declarationPath)) fail(`missing Nuxt imports declaration; run \`bunx nuxt prepare\`: ${repoPath(declarationPath)}`);
    const result = new Map<string, Set<string>>();
    const declaration = readFileSync(declarationPath, 'utf8');
    const exportPattern = /^export \{(.+)\} from ['"](.+)['"];$/gm;
    for (const match of declaration.matchAll(exportPattern)) {
        const specifiers = match[1];
        const moduleSpecifier = match[2];
        if (!specifiers || !moduleSpecifier || !moduleSpecifier.startsWith('.')) continue;
        const resolvedModule = withoutExtension(resolve(dirname(declarationPath), moduleSpecifier));
        const names = result.get(resolvedModule) ?? new Set<string>();
        for (const rawSpecifier of specifiers.split(',')) {
            const specifier = rawSpecifier.trim().replace(/^type\s+/, '');
            if (!specifier) continue;
            names.add(specifier.split(/\s+as\s+/).at(-1)!);
        }
        result.set(resolvedModule, names);
    }
    return result;
}

function loadProgram(modulePaths: string[]): { checker: ts.TypeChecker; program: ts.Program } {
    if (!existsSync(tsconfigPath)) fail('missing .nuxt/tsconfig.app.json; run `bunx nuxt prepare`');
    const readResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (readResult.error) fail(ts.flattenDiagnosticMessageText(readResult.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, dirname(tsconfigPath));
    const rootNames = [...new Set([...parsed.fileNames, ...modulePaths])];
    const program = ts.createProgram({ rootNames, options: parsed.options });
    return { checker: program.getTypeChecker(), program };
}

function symbolKind(symbol: ts.Symbol): 'type' | 'value' | 'type-and-value' {
    const isType = (symbol.flags & ts.SymbolFlags.Type) !== 0;
    const isValue = (symbol.flags & ts.SymbolFlags.Value) !== 0;
    if (isType && isValue) return 'type-and-value';
    return isValue ? 'value' : 'type';
}

function declarationRecord(declaration: ts.Declaration) {
    const sourceFile = declaration.getSourceFile();
    const line = sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile)).line + 1;
    const text = ts.isFunctionDeclaration(declaration) && declaration.body
        ? `${sourceFile.text.slice(declaration.getStart(sourceFile), declaration.body.getStart(sourceFile)).trimEnd()};`
        : declaration.getText(sourceFile);
    return { source: repoPath(sourceFile.fileName), line, syntaxKind: ts.SyntaxKind[declaration.kind], text };
}

function signatureRecord(checker: ts.TypeChecker, signature: ts.Signature) {
    const declaration = signature.getDeclaration();
    const declarationSnapshot = declaration ? declarationRecord(declaration) : null;
    const declaredReturnType = declaration && ts.isFunctionLike(declaration) && declaration.type
        ? declaration.type.getText(declaration.getSourceFile())
        : null;
    const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
    // TypeScript expands inferred return types through ambient platform
    // libraries. That made the ledger differ between macOS and Linux for
    // signatures containing Buffer/typed arrays even though the emitted
    // public declaration was identical. The declaration snapshot is the
    // authoritative inferred-type gate, so keep this ledger source-stable for
    // unannotated returns and retain resolved types for explicit contracts.
    const hasInferredReturn = declaredReturnType === null && declarationSnapshot !== null;
    return {
        signature: hasInferredReturn
            ? declarationSnapshot.text
            : checker.signatureToString(signature, declaration, flags, ts.SignatureKind.Call),
        declaredReturnType,
        resolvedReturnType: hasInferredReturn
            ? null
            : checker.typeToString(checker.getReturnTypeOfSignature(signature), declaration, flags),
        declaration: declarationSnapshot,
    };
}

function main() {
    const config = readConfig();
    const behaviorProfileCatalog = readBehaviorProfiles(config);
    const absoluteModules = config.modules.map((module) => resolve(repoRoot, module.source));
    const autoImports = parseNuxtAutoImports(resolve(repoRoot, config.nuxtImportsDeclaration));
    const { checker, program } = loadProgram(absoluteModules);
    const modules = config.modules.slice().sort((a, b) => a.source.localeCompare(b.source)).map((module) => {
        const absoluteSource = resolve(repoRoot, module.source);
        const sourceFile = program.getSourceFile(absoluteSource);
        if (!sourceFile) fail(`TypeScript program did not load ${module.source}`);
        const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
        if (!moduleSymbol) fail(`could not resolve module symbol for ${module.source}`);
        const autoImportNames = autoImports.get(withoutExtension(absoluteSource)) ?? new Set<string>();
        const exports = checker.getExportsOfModule(moduleSymbol).map((exportSymbol) => {
            const target = (exportSymbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exportSymbol) : exportSymbol;
            const declarations = target.getDeclarations() ?? exportSymbol.getDeclarations() ?? [];
            const location = declarations[0] ?? sourceFile;
            const type = checker.getTypeOfSymbolAtLocation(target, location);
            return {
                name: exportSymbol.getName(),
                kind: symbolKind(target),
                nuxtAutoImport: autoImportNames.has(exportSymbol.getName()),
                signatures: checker.getSignaturesOfType(type, ts.SignatureKind.Call).map((signature) => signatureRecord(checker, signature)),
                declarations: declarations.map(declarationRecord),
            };
        }).sort((a, b) => a.name.localeCompare(b.name));
        if (!exports.length) fail(`no exports found for ${module.source}`);
        return {
            source: module.source,
            apiSha256: sha256(JSON.stringify(exports)),
            runtime: module.runtime,
            publicPaths: module.publicPaths.slice().sort(),
            nuxtAutoImportModule: exports.some((entry) => entry.nuxtAutoImport) ? '#imports' : null,
            docs: module.docs.slice().sort(),
            behaviorProfileIds: (module.behaviorProfileIds ?? []).slice().sort(),
            exports,
        };
    });
    const exportCount = modules.reduce((count, module) => count + module.exports.length, 0);
    const callableCount = modules.reduce((count, module) => count + module.exports.filter((entry) => entry.signatures.length > 0).length, 0);
    const autoImportCount = modules.reduce((count, module) => count + module.exports.filter((entry) => entry.nuxtAutoImport).length, 0);
    const ledger = {
        schemaVersion: 1,
        purpose: 'Frozen V1 plugin and hook API compatibility surface for Plugin Runtime V2.',
        generator: 'scripts/plugin-runtime/generate-compatibility-ledger.ts',
        inputs: {
            moduleManifest: repoPath(configPath),
            moduleManifestSha256: sha256(readFileSync(configPath, 'utf8')),
            nuxtImportsDeclaration: config.nuxtImportsDeclaration,
            nuxtImportsDeclarationSha256: sha256(readFileSync(resolve(repoRoot, config.nuxtImportsDeclaration), 'utf8')),
            behaviorProfiles: config.behaviorProfiles,
            behaviorProfilesSha256: sha256(readFileSync(resolve(repoRoot, config.behaviorProfiles), 'utf8')),
        },
        coverage: { moduleCount: modules.length, exportCount, callableExportCount: callableCount, nuxtAutoImportCount: autoImportCount },
        behaviorProfiles: behaviorProfileCatalog.profiles.slice().sort((a, b) => a.id.localeCompare(b.id)),
        modules,
    };
    const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
    if (checkOnly) {
        if (!existsSync(outputPath)) fail(`missing generated ledger: ${repoPath(outputPath)}`);
        if (readFileSync(outputPath, 'utf8') !== serialized) fail('ledger is stale; run `bun run plugin-runtime:ledger`');
        console.log(`[compatibility-ledger] verified ${modules.length} modules, ${exportCount} exports, ${callableCount} callables, ${autoImportCount} Nuxt auto-imports`);
        return;
    }
    writeFileSync(outputPath, serialized);
    console.log(`[compatibility-ledger] wrote ${repoPath(outputPath)} (${modules.length} modules, ${exportCount} exports, ${callableCount} callables, ${autoImportCount} Nuxt auto-imports)`);
}

main();
