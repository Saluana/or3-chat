import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import {
    decideTrustedHostUi,
    type HostEsmFacadeEvidence,
} from '../../shared/plugins/host-esm-facade';

const FACADE_MARKER = 'or3-plugin-host-esm-facade:v1';
const VUE_PROOF_MARKER = 'or3-plugin-vue-host-singleton:v1';
const SDK_PROOF_MARKER = 'or3-plugin-sdk-host-singleton:v2';

export interface ProductionHostEsmFacadeReport {
    readonly schemaVersion: 1;
    readonly evidence: HostEsmFacadeEvidence;
    readonly decision: ReturnType<typeof decideTrustedHostUi>;
    readonly declaredExternalMarkers: {
        readonly vue: boolean;
        readonly sdk: boolean;
    };
    readonly inspectedFacadeFiles: readonly string[];
    readonly importMapDocuments: readonly string[];
    readonly cspUnsafeFacadeFiles: readonly string[];
}

function executableFiles(root: string): string[] {
    if (!existsSync(root)) return [];
    const result: string[] = [];
    const visit = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) visit(path);
            else if (['.js', '.mjs', '.html'].includes(extname(entry.name))) {
                result.push(path);
            }
        }
    };
    visit(root);
    return result.sort();
}

export function inspectProductionHostEsmFacade(
    outputRoot: string
): ProductionHostEsmFacadeReport {
    const publicRoot = resolve(outputRoot, 'public');
    if (!existsSync(publicRoot)) {
        throw new Error('[plugin-host-esm-facade] missing production .output/public');
    }
    const files = executableFiles(publicRoot);
    const sources = files.map((file) => [file, readFileSync(file, 'utf8')] as const);
    const facadeSources = sources.filter(([, source]) => source.includes(FACADE_MARKER));
    const importMapSources = sources.filter(
        ([file, source]) =>
            extname(file) === '.html' &&
            /<script\b[^>]*\btype=["']importmap["'][^>]*>/i.test(source)
    );
    const cspUnsafeFacadeFiles = facadeSources
        .filter(([, source]) => /\beval\s*\(|\bnew\s+Function\b/.test(source))
        .map(([file]) => relative(outputRoot, file));
    const hasVueProof = facadeSources.some(([, source]) =>
        source.includes(VUE_PROOF_MARKER)
    );
    const hasSdkProof = facadeSources.some(([, source]) =>
        source.includes(SDK_PROOF_MARKER)
    );
    const evidence: HostEsmFacadeEvidence = Object.freeze({
        generatedFacade: facadeSources.length > 0,
        importMap: importMapSources.length > 0,
        // Declarations are intentionally not behavior proof. These remain false
        // until a browser production-build suite supplies each identity result.
        vueSingletonIdentity: false,
        sdkSingletonIdentity: false,
        vueReactivity: false,
        vueComponentRendering: false,
        cspCompatible: cspUnsafeFacadeFiles.length === 0,
    });
    return Object.freeze({
        schemaVersion: 1,
        evidence,
        decision: decideTrustedHostUi(evidence),
        declaredExternalMarkers: Object.freeze({
            vue: hasVueProof,
            sdk: hasSdkProof,
        }),
        inspectedFacadeFiles: Object.freeze(
            facadeSources.map(([file]) => relative(outputRoot, file))
        ),
        importMapDocuments: Object.freeze(
            importMapSources.map(([file]) => relative(outputRoot, file))
        ),
        cspUnsafeFacadeFiles: Object.freeze(cspUnsafeFacadeFiles),
    });
}

export function recordProductionHostEsmFacadeReport(
    outputRoot: string,
    report: ProductionHostEsmFacadeReport
): string {
    const directory = resolve(outputRoot, 'plugin-runtime');
    const reportPath = resolve(directory, 'host-esm-facade-report.json');
    mkdirSync(directory, { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return reportPath;
}

function main(): void {
    const repoRoot = resolve(import.meta.dirname, '../..');
    const outputRoot = resolve(repoRoot, '.output');
    const report = inspectProductionHostEsmFacade(outputRoot);
    const reportPath = recordProductionHostEsmFacadeReport(outputRoot, report);
    if (report.cspUnsafeFacadeFiles.length > 0) {
        throw new Error(
            `[plugin-host-esm-facade] CSP-unsafe code in ${report.cspUnsafeFacadeFiles.join(', ')}`
        );
    }
    if (report.decision.status === 'supported') {
        console.log('[plugin-host-esm-facade] production singleton ABI proofs passed');
        return;
    }
    console.log(
        `[plugin-host-esm-facade] trusted-host ModuleV2Loader UI is rebuild-required; ` +
            `proof gaps: ${report.decision.blockCodes.join(', ')}; report: ${relative(repoRoot, reportPath)}`
    );
}

if (import.meta.main) main();
