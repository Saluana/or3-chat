#!/usr/bin/env bun

import { readFile, rm, symlink } from 'node:fs/promises';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertNoMaterialMaxRegression } from './comparison';
import type { PerformanceBudget } from './report';

type PerformanceReport = {
    budgets: Record<string, PerformanceBudget>;
};

const root = resolve(import.meta.dir, '../..');
const reportPath = resolve(root, 'output/performance/populated-workspace.json');
const benchmarkArgs = ['run', 'performance:workspace:check'];

async function command(command: string, args: string[], cwd: string, env: Record<string, string> = {}) {
    const child = Bun.spawn([command, ...args], {
        cwd,
        env: { ...process.env, ...env },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    return { stdout, stderr, exitCode };
}

async function readReport(path: string): Promise<PerformanceReport> {
    const report = JSON.parse(await readFile(path, 'utf8')) as PerformanceReport;
    if (!report.budgets || typeof report.budgets !== 'object') {
        throw new Error(`Performance report ${path} has no budgets.`);
    }
    return report;
}

await rm(reportPath, { force: true });
const candidate = await command('bun', benchmarkArgs, root);
process.stdout.write(candidate.stdout);
process.stderr.write(candidate.stderr);
if (candidate.exitCode === 0) process.exit(0);

let candidateReport: PerformanceReport;
try {
    candidateReport = await readReport(reportPath);
} catch {
    throw new Error(`Populated workspace benchmark failed before producing comparative evidence.`);
}

const temp = await mkdtemp(join(tmpdir(), 'or3-performance-base-'));
const baseDirectory = join(temp, 'source');
try {
    const requestedBase = process.env.OR3_PERF_BASE_REVISION?.trim() || 'HEAD^';
    const resolvedBase = await command('git', ['rev-parse', '--verify', `${requestedBase}^{commit}`], root);
    if (resolvedBase.exitCode !== 0 || !/^[0-9a-f]{40}\n?$/.test(resolvedBase.stdout)) {
        throw new Error(`Could not resolve performance base ${requestedBase}.`);
    }
    const baseSha = resolvedBase.stdout.trim();
    const worktree = await command('git', ['worktree', 'add', '--detach', baseDirectory, baseSha], root);
    if (worktree.exitCode !== 0) throw new Error(worktree.stderr || 'Could not create performance comparison worktree.');
    await symlink(await realpath(join(root, 'node_modules')), join(baseDirectory, 'node_modules'), 'dir');
    await symlink(await realpath(join(root, '.nuxt')), join(baseDirectory, '.nuxt'), 'dir');

    const baseOutput = join(temp, 'report');
    const baseline = await command('bun', benchmarkArgs, baseDirectory, {
        GITHUB_SHA: baseSha,
        OR3_PERF_OUTPUT_DIR: baseOutput,
    });
    process.stdout.write(baseline.stdout);
    process.stderr.write(baseline.stderr);
    const baseReport = await readReport(join(baseOutput, 'populated-workspace.json'));
    const accepted = assertNoMaterialMaxRegression(candidateReport.budgets, baseReport.budgets);
    console.log(`[populated-workspace] absolute budget was runner-limited; same-host comparison against ${baseSha} passed:`);
    for (const detail of accepted) console.log(`  ${detail}`);
} finally {
    if (await Bun.file(join(baseDirectory, '.git')).exists()) {
        await command('git', ['worktree', 'remove', '--force', baseDirectory], root);
    }
    await rm(temp, { recursive: true, force: true });
}
