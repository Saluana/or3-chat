import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type PerformanceBudget = {
    actual: number;
    limit: number;
    direction: 'max' | 'min';
    passed: boolean;
};

export function positiveNumber(
    value: string | undefined,
    fallback: number
): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function maxBudget(actual: number, limit: number): PerformanceBudget {
    return { actual, limit, direction: 'max', passed: actual <= limit };
}

export function minBudget(actual: number, limit: number): PerformanceBudget {
    return { actual, limit, direction: 'min', passed: actual >= limit };
}

export function writePerformanceReport(
    name: string,
    report: Record<string, unknown>
): string {
    const outputDir = resolve(
        process.cwd(),
        process.env.OR3_PERF_OUTPUT_DIR?.trim() || 'output/performance'
    );
    mkdirSync(outputDir, { recursive: true });
    const outputPath = resolve(outputDir, `${name}.json`);
    writeFileSync(
        outputPath,
        `${JSON.stringify(
            {
                schemaVersion: 1,
                generatedAt: new Date().toISOString(),
                commit: process.env.GITHUB_SHA || null,
                runner: {
                    platform: process.platform,
                    arch: process.arch,
                    runtime: process.versions.bun
                        ? `bun-${process.versions.bun}`
                        : `node-${process.versions.node}`,
                },
                ...report,
            },
            null,
            2
        )}\n`,
        'utf8'
    );
    return outputPath;
}

export function assertBudgets(
    benchmark: string,
    budgets: Record<string, PerformanceBudget>
): void {
    const failures = Object.entries(budgets).filter(([, budget]) => !budget.passed);
    if (failures.length === 0) return;

    const details = failures
        .map(
            ([name, budget]) =>
                `${name}: ${budget.actual} must be ${budget.direction === 'max' ? '<=' : '>='} ${budget.limit}`
        )
        .join('\n');
    throw new Error(`${benchmark} performance budget failed:\n${details}`);
}
