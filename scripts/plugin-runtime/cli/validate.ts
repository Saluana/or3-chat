import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    checkV2PackageConformance,
    type V2ConformanceResult,
} from '../check-v2-package-conformance';
import { assertPackageRoot, materializePackTree, repoRootFromCli } from './shared';

export interface ValidateCommandResult {
    readonly root: string;
    readonly result: V2ConformanceResult;
    readonly exitCode: number;
}

export async function validateV2Package(
    packageRoot: string,
    options: { readonly repoRoot?: string } = {}
): Promise<ValidateCommandResult> {
    const root = assertPackageRoot(packageRoot);
    const packRoot = resolve(root, '.or3-pack-validate');
    let result: V2ConformanceResult;
    try {
        // Review the package this source would produce, not the raw directory
        // (which contains tests, build outputs and symlinked dev dependencies).
        materializePackTree(root, packRoot);
        result = await checkV2PackageConformance(packRoot, {
            repoRoot: options.repoRoot ?? repoRootFromCli(),
            mode: 'source',
        });
    } finally {
        rmSync(packRoot, { recursive: true, force: true });
    }
    return {
        root,
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
    return `${lines.join('\n')}\n`;
}
