import { rmSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    checkV2PackageConformance,
    type V2ConformanceResult,
} from './conformance';
import { assertPackageRoot, findMissingDeclaredSample, materializePackTree } from './shared';

export interface ValidateCommandResult {
    readonly root: string;
    readonly result: V2ConformanceResult;
    readonly exitCode: number;
    readonly warnings?: readonly {file:string;message:string}[];
}

/**
 * Validates a source directory by reviewing the package it would produce.
 *
 * Hashing the raw directory would include development-only files (tests, build
 * outputs, `.authoring`, and an installed `node_modules` whose `.bin` entries are
 * symlinks), which are never shipped and would make validation reject an
 * otherwise valid project. Materialising first separates source validation from
 * exact-artifact review.
 */
export async function validateV2Package(packageRoot: string): Promise<ValidateCommandResult> {
    const root = assertPackageRoot(packageRoot);
    const packRoot = resolve(root, '.or3-pack-validate');
    let result: V2ConformanceResult;
    try {
        const files = materializePackTree(root, packRoot);
        const missingSample = findMissingDeclaredSample({ packRoot, files });
        result = missingSample
            ? {
                  status: 'nonconformant',
                  issues: [
                      {
                          code: 'portable-sample-missing',
                          file: 'or3.setup.json',
                          subject: missingSample,
                          severity: 'error',
                          message: `firstAction.samplePath "${missingSample}" is not part of the package; the host cannot run the declared sample.`,
                      },
                  ],
                  digest: null,
                  manifestDigest: null,
              }
            : await checkV2PackageConformance(packRoot, { mode: 'source' });
    } finally {
        rmSync(packRoot, { recursive: true, force: true });
    }
    const warnings: {file:string;message:string}[] = [];
    if (result.status === 'conformant') {
        const manifest = JSON.parse(readFileSync(resolve(root, 'or3.manifest.json'), 'utf8')) as {toolCards?: {entry:string}[]};
        for (const card of manifest.toolCards ?? []) {
            const path = resolve(root, card.entry);
            if (existsSync(path) && /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection)\b/.test(readFileSync(path, 'utf8'))) warnings.push({file:card.entry,message:'Network APIs in cards are denied by containment; perform requests in the tool through network.http.'});
        }
    }
    return {
        root,
        ...(warnings.length ? {warnings} : {}),
        result,
        exitCode: result.status === 'nonconformant' ? 1 : 0,
    };
}

export function formatValidationReport(report: ValidateCommandResult): string {
    const lines = [
        `package: ${resolve(report.root)}`,
        `status: ${report.result.status}`,
    ];
    if (report.result.status === 'nonconformant') {
        for (const issue of report.result.issues) {
            lines.push(
                `[${issue.code}] ${issue.file}${issue.subject ? ` (${issue.subject})` : ''}: ${issue.message}`
            );
        }
    }
    for (const warning of report.warnings ?? []) lines.push(`[warning:card-network-api] ${warning.file}: ${warning.message}`);
    return `${lines.join('\n')}\n`;
}
