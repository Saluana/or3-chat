import { resolve } from 'node:path';
import {
    checkV2PackageConformance,
    type V2ConformanceResult,
} from '../check-v2-package-conformance';
import { assertPackageRoot, repoRootFromCli } from './shared';

export interface ValidateCommandResult {
    readonly root: string;
    readonly result: V2ConformanceResult;
    readonly exitCode: number;
}

export function validateV2Package(
    packageRoot: string,
    options: { readonly repoRoot?: string } = {}
): ValidateCommandResult {
    const root = assertPackageRoot(packageRoot);
    const result = checkV2PackageConformance(root, {
        repoRoot: options.repoRoot ?? repoRootFromCli(),
    });
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
