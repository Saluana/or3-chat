#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
    assertCleanStatus,
    assertReleaseVersionContract,
    isRegistryNotFound,
} from './release-preflight-core';

type CommandResult = { exitCode: number; stdout: string; stderr: string };

const root = resolve(import.meta.dir, '../..');
const args = process.argv.slice(2);
const requestedIndex = args.indexOf('--version');
const requested = requestedIndex >= 0 ? args[requestedIndex + 1] : undefined;
if (requestedIndex >= 0 && (!requested || requested.startsWith('--'))) {
    throw new Error('--version requires an exact stable version.');
}
const registry = args.includes('--registry');
const full = args.includes('--full');
const repository = args.includes('--repository');
const known = new Set(['--version', '--registry', '--full', '--repository']);
for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (!known.has(value) && args[index - 1] !== '--version') throw new Error(`Unknown release preparation option ${value}.`);
}

async function command(command: string, commandArgs: string[], options: { quiet?: boolean; env?: Record<string, string> } = {}): Promise<CommandResult> {
    const child = Bun.spawn([command, ...commandArgs], {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, ...options.env },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    if (!options.quiet) {
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
    }
    return { exitCode, stdout, stderr };
}

async function requireCommand(label: string, executable: string, commandArgs: string[], env?: Record<string, string>) {
    console.log(`\n[release:prepare] ${label}`);
    const startedAt = Date.now();
    const result = await command(executable, commandArgs, { env });
    const elapsedMs = Date.now() - startedAt;
    timings[label] = elapsedMs;
    console.log(`[release:prepare] ${label} completed in ${(elapsedMs / 1000).toFixed(1)}s`);
    if (result.exitCode !== 0) throw new Error(`${label} failed with exit ${result.exitCode}.`);
}

const timings: Record<string, number> = {};

const rootPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { version: string };
const cloudPackage = JSON.parse(await readFile(resolve(root, 'packages/or3-cloud/package.json'), 'utf8')) as { version: string };
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8')) as {
    version?: string;
    packages?: Record<string, { version?: string }>;
};
const cli = await readFile(resolve(root, 'packages/or3-cloud/src/cli.ts'), 'utf8');
const cliVersion = cli.match(/PACKAGE_VERSION\s*=\s*'([^']+)'/)?.[1];
const version = requested ?? cloudPackage.version;
assertReleaseVersionContract({
    requested: version,
    root: rootPackage.version,
    lock: lock.version,
    lockRoot: lock.packages?.['']?.version,
    cloud: cloudPackage.version,
    cli: cliVersion,
});

const status = await command('git', ['status', '--porcelain=v1', '--untracked-files=all'], { quiet: true });
if (status.exitCode !== 0) throw new Error(status.stderr || 'Could not inspect Git status.');
assertCleanStatus(status.stdout);
const source = await command('git', ['rev-parse', 'HEAD'], { quiet: true });
if (source.exitCode !== 0 || !/^[0-9a-f]{40}\n?$/.test(source.stdout)) throw new Error('Could not resolve the release source commit.');
const sourceSha = source.stdout.trim();

const localTag = await command('git', ['show-ref', '--verify', '--quiet', `refs/tags/v${version}`], { quiet: true });
if (localTag.exitCode === 0) throw new Error(`Git tag v${version} already exists locally.`);
if (localTag.exitCode !== 1) throw new Error('Could not inspect local release tags.');
if (registry) {
    const remoteTag = await command('git', ['ls-remote', '--tags', 'origin', `refs/tags/v${version}`], { quiet: true });
    if (remoteTag.exitCode !== 0) throw new Error(remoteTag.stderr || 'Could not inspect remote release tags.');
    if (remoteTag.stdout.trim()) throw new Error(`Git tag v${version} already exists on origin.`);

    const npm = await command('npm', ['view', `@or3/cloud@${version}`, 'version'], { quiet: true });
    if (npm.exitCode === 0) throw new Error(`@or3/cloud@${version} already exists on npm.`);
    if (!isRegistryNotFound(`${npm.stdout}\n${npm.stderr}`)) throw new Error(`Could not prove npm version ${version} is unused: ${npm.stderr.trim()}`);

    const image = await command('docker', ['manifest', 'inspect', `ghcr.io/saluana/or3-chat:${version}`], { quiet: true });
    if (image.exitCode === 0) throw new Error(`ghcr.io/saluana/or3-chat:${version} already exists.`);
    if (!isRegistryNotFound(`${image.stdout}\n${image.stderr}`)) throw new Error(`Could not prove GHCR version ${version} is unused: ${image.stderr.trim()}`);
}

type RepositoryFinding = {
    code: string;
    severity: 'blocker' | 'warning' | 'info';
    message: string;
    remedy?: string;
};

type RepositoryReadiness = {
    repository: string | null;
    defaultBranch: string | null;
    actionsEnabled: boolean | null;
    pushPermission: boolean | null;
    adminPermission: boolean | null;
    requiredWorkflowState: string | null;
    candidateWorkflowState: string | null;
    requiredWorkflowOnDefault: boolean | null;
    candidateWorkflowOnDefault: boolean | null;
    runnerCount: number | null;
    latestCandidateRun: { status: string | null; conclusion: string | null; url: string | null } | null;
    findings: RepositoryFinding[];
    unknown: string[];
};

/** Reads a workflow file from the default branch and returns its text, or null when unavailable. */
async function defaultBranchWorkflowText(slug: string, branch: string, path: string): Promise<string | null> {
    const result = await ghApi([`repos/${slug}/contents/${path}?ref=${encodeURIComponent(branch)}`]);
    if (!result.ok) return null;
    const data = result.data as { content?: unknown; encoding?: unknown };
    if (typeof data.content !== 'string') return null;
    try {
        return Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
    } catch {
        return null;
    }
}

async function ghApi(pathArgs: string[]): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
    const result = await command('gh', ['api', ...pathArgs], { quiet: true });
    if (result.exitCode !== 0) return { ok: false, detail: (result.stderr || result.stdout).trim() };
    try {
        return { ok: true, data: JSON.parse(result.stdout) };
    } catch {
        return { ok: false, detail: 'GitHub returned unreadable JSON.' };
    }
}

/**
 * Read-only repository readiness (R10.AC1). Never changes settings, billing,
 * dispatch, or workflows; unavailable capacity/billing data is reported as
 * unknown rather than assumed available.
 */
async function inspectRepositoryReadiness(): Promise<RepositoryReadiness> {
    const readiness: RepositoryReadiness = {
        repository: null,
        defaultBranch: null,
        actionsEnabled: null,
        pushPermission: null,
        adminPermission: null,
        requiredWorkflowState: null,
        candidateWorkflowState: null,
        requiredWorkflowOnDefault: null,
        candidateWorkflowOnDefault: null,
        runnerCount: null,
        latestCandidateRun: null,
        findings: [],
        unknown: [],
    };
    const remote = await command('git', ['remote', 'get-url', 'origin'], { quiet: true });
    const slug = remote.exitCode === 0
        ? remote.stdout.trim().match(/github\.com[:/](.+?)(?:\.git)?$/)?.[1] ?? null
        : null;
    readiness.repository = slug;
    if (!slug) {
        readiness.findings.push({
            code: 'repository-remote-unknown',
            severity: 'blocker',
            message: 'Could not resolve a GitHub repository from the origin remote.',
            remedy: 'Set the origin remote to the intended GitHub repository, then re-run with --repository.',
        });
        return readiness;
    }

    const auth = await command('gh', ['auth', 'status'], { quiet: true });
    if (auth.exitCode !== 0) {
        readiness.findings.push({
            code: 'repository-auth-missing',
            severity: 'blocker',
            message: 'The GitHub CLI is not authenticated, so workflow registration and permissions cannot be verified.',
            remedy: 'Run `gh auth login` with a token that can read repository actions and then re-check. Do not tag or publish until readiness is verified.',
        });
        readiness.unknown.push('workflow registration, required permissions, and CI capacity');
        return readiness;
    }

    const repo = await ghApi([`repos/${slug}`]);
    if (!repo.ok) {
        readiness.findings.push({
            code: 'repository-unreadable',
            severity: 'blocker',
            message: `Could not read repository ${slug}: ${repo.detail}`,
            remedy: 'Confirm the repository exists and the authenticated account can read it.',
        });
        return readiness;
    }
    const repoData = repo.data as {
        default_branch?: string;
        archived?: boolean;
        disabled?: boolean;
        permissions?: { push?: boolean; admin?: boolean };
    };
    readiness.defaultBranch = repoData.default_branch ?? null;
    readiness.pushPermission = repoData.permissions?.push ?? null;
    readiness.adminPermission = repoData.permissions?.admin ?? null;
    if (repoData.archived || repoData.disabled) {
        readiness.findings.push({
            code: 'repository-inactive',
            severity: 'blocker',
            message: `Repository ${slug} is archived or disabled; release workflows cannot run.`,
            remedy: 'Use the active release repository or restore it before qualifying this version.',
        });
    }
    if (readiness.pushPermission === false) {
        readiness.findings.push({
            code: 'repository-push-permission-missing',
            severity: 'blocker',
            message: 'The authenticated account cannot push to this repository, so the release tag cannot be published.',
            remedy: 'Authenticate a token with write access to the release repository.',
        });
    }

    const permissions = await ghApi([`repos/${slug}/actions/permissions`]);
    if (permissions.ok) {
        readiness.actionsEnabled = (permissions.data as { enabled?: boolean }).enabled ?? null;
        if (readiness.actionsEnabled === false) {
            readiness.findings.push({
                code: 'repository-actions-disabled',
                severity: 'blocker',
                message: 'GitHub Actions is disabled for this repository, so candidate and tag workflows cannot run.',
                remedy: 'Enable Actions in repository settings, then re-run readiness. Do not publish manually.',
            });
        }
    } else {
        readiness.unknown.push('repository Actions enablement');
    }

    const workflows = await ghApi([`repos/${slug}/actions/workflows?per_page=100`]);
    if (workflows.ok) {
        const list = (workflows.data as { workflows?: Array<{ name?: string; path?: string; state?: string }> }).workflows ?? [];
        readiness.requiredWorkflowState = list.find((workflow) => workflow.path === '.github/workflows/release-cloud.yml')?.state ?? null;
        readiness.candidateWorkflowState = list.find((workflow) => workflow.path === '.github/workflows/release-cloud-candidate.yml')?.state ?? null;
        if (readiness.requiredWorkflowState === null) {
            readiness.findings.push({
                code: 'repository-required-workflow-missing',
                severity: 'blocker',
                message: 'The tag release workflow (.github/workflows/release-cloud.yml) is not registered on the default branch.',
                remedy: 'Merge the release workflow to the default branch before tagging.',
            });
        } else if (readiness.requiredWorkflowState !== 'active') {
            readiness.findings.push({
                code: 'repository-required-workflow-inactive',
                severity: 'blocker',
                message: `The tag release workflow is registered but not active (state: ${readiness.requiredWorkflowState}).`,
                remedy: 'Re-enable the workflow in repository Actions settings.',
            });
        }
        if (readiness.candidateWorkflowState === null) {
            readiness.findings.push({
                code: 'repository-candidate-workflow-missing',
                severity: 'blocker',
                message: 'The qualification workflow (.github/workflows/release-cloud-candidate.yml) is not registered on the default branch.',
                remedy: 'Merge the candidate workflow to the default branch before qualifying a version.',
            });
        } else if (readiness.candidateWorkflowState !== 'active') {
            readiness.findings.push({
                code: 'repository-candidate-workflow-inactive',
                severity: 'blocker',
                message: `The candidate workflow is registered but not active (state: ${readiness.candidateWorkflowState}).`,
                remedy: 'Re-enable the candidate workflow before qualifying a version.',
            });
        }
    } else {
        readiness.unknown.push('default-branch workflow registration');
    }

    // Registration alone is not enough: the required workflows must exist on the
    // default branch with their expected triggers, or a tag/dispatch will not run.
    if (readiness.defaultBranch) {
        const requiredFile = await defaultBranchWorkflowText(slug, readiness.defaultBranch, '.github/workflows/release-cloud.yml');
        const candidateFile = await defaultBranchWorkflowText(slug, readiness.defaultBranch, '.github/workflows/release-cloud-candidate.yml');
        readiness.requiredWorkflowOnDefault = requiredFile !== null;
        readiness.candidateWorkflowOnDefault = candidateFile !== null;
        if (requiredFile === null) {
            readiness.findings.push({
                code: 'repository-required-workflow-content-missing',
                severity: 'blocker',
                message: `The tag release workflow is not present on the default branch (${readiness.defaultBranch}) or could not be read.`,
                remedy: 'Merge .github/workflows/release-cloud.yml to the default branch before tagging.',
            });
        } else if (!/tags:/.test(requiredFile)) {
            readiness.findings.push({
                code: 'repository-required-workflow-trigger-missing',
                severity: 'blocker',
                message: 'The tag release workflow on the default branch does not declare a tag push trigger.',
                remedy: 'Restore the tag trigger in .github/workflows/release-cloud.yml before tagging.',
            });
        }
        if (candidateFile === null) {
            readiness.findings.push({
                code: 'repository-candidate-workflow-content-missing',
                severity: 'blocker',
                message: `The qualification workflow is not present on the default branch (${readiness.defaultBranch}) or could not be read.`,
                remedy: 'Merge .github/workflows/release-cloud-candidate.yml to the default branch before qualifying a version.',
            });
        } else if (!/workflow_dispatch:/.test(candidateFile)) {
            readiness.findings.push({
                code: 'repository-candidate-workflow-dispatch-missing',
                severity: 'blocker',
                message: 'The qualification workflow on the default branch is not dispatchable (no workflow_dispatch trigger).',
                remedy: 'Restore the workflow_dispatch trigger in .github/workflows/release-cloud-candidate.yml before qualifying a version.',
            });
        }
    } else {
        readiness.unknown.push('default-branch workflow contents');
    }

    const runners = await ghApi([`repos/${slug}/actions/runners`]);
    if (runners.ok) {
        readiness.runnerCount = (runners.data as { total_count?: number }).total_count ?? null;
    } else {
        readiness.unknown.push('runner availability');
    }

    const runs = await command('gh', [
        'run', 'list', '--repo', slug, '--workflow', 'release-cloud-candidate.yml',
        '--limit', '1', '--json', 'status,conclusion,url',
    ], { quiet: true });
    if (runs.exitCode === 0) {
        try {
            const list = JSON.parse(runs.stdout) as Array<{ status?: string; conclusion?: string; url?: string }>;
            const latest = list[0];
            readiness.latestCandidateRun = latest
                ? { status: latest.status ?? null, conclusion: latest.conclusion ?? null, url: latest.url ?? null }
                : null;
        } catch {
            readiness.unknown.push('latest candidate run evidence');
        }
    } else {
        readiness.unknown.push('latest candidate run evidence');
    }
    readiness.unknown.push('GitHub Actions billing/capacity');
    return readiness;
}

const reportDirectory = resolve(root, 'output/release');
const repositoryReadiness = repository ? await inspectRepositoryReadiness() : undefined;
if (repositoryReadiness) {
    console.log('\n[release:prepare] Repository readiness (read-only)');
    console.log(`  repository: ${repositoryReadiness.repository ?? 'unknown'}`);
    console.log(`  default branch: ${repositoryReadiness.defaultBranch ?? 'unknown'}`);
    console.log(`  Actions enabled: ${repositoryReadiness.actionsEnabled ?? 'unknown'}`);
    console.log(`  push permission: ${repositoryReadiness.pushPermission ?? 'unknown'}`);
    console.log(`  tag workflow state: ${repositoryReadiness.requiredWorkflowState ?? 'unknown'}`);
    console.log(`  candidate workflow state: ${repositoryReadiness.candidateWorkflowState ?? 'unknown'}`);
    console.log(`  tag workflow on default branch: ${repositoryReadiness.requiredWorkflowOnDefault ?? 'unknown'}`);
    console.log(`  candidate workflow on default branch: ${repositoryReadiness.candidateWorkflowOnDefault ?? 'unknown'}`);
    console.log(`  registered runners: ${repositoryReadiness.runnerCount ?? 'unknown'}`);
    console.log(`  latest candidate run: ${repositoryReadiness.latestCandidateRun
        ? `${repositoryReadiness.latestCandidateRun.status ?? 'unknown'}/${repositoryReadiness.latestCandidateRun.conclusion ?? 'unknown'} ${repositoryReadiness.latestCandidateRun.url ?? ''}`.trim()
        : 'unknown'}`);
    for (const finding of repositoryReadiness.findings) {
        console.log(`  [${finding.severity}] ${finding.code}: ${finding.message}${finding.remedy ? ` — ${finding.remedy}` : ''}`);
    }
    for (const unknown of repositoryReadiness.unknown) console.log(`  [unknown] ${unknown} could not be verified`);

    // Persist the readiness report before any expensive work so a blocking exit
    // still leaves a durable record of what was observed.
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(resolve(reportDirectory, 'repository-readiness.json'), `${JSON.stringify(repositoryReadiness, null, 2)}\n`, 'utf8');
    const repositoryBlockers = repositoryReadiness.findings.filter((finding) => finding.severity === 'blocker');
    if (repositoryBlockers.length > 0) {
        for (const finding of repositoryBlockers) {
            console.error(`  [blocker] ${finding.code}: ${finding.message}${finding.remedy ? ` — ${finding.remedy}` : ''}`);
        }
        console.error(`Repository readiness reported ${repositoryBlockers.length} blocker(s); refusing to run expensive release checks.`);
        process.exit(1);
    }
}

const fixedProfile = {
    CI: '1',
    AUTH_PROVIDER: 'basic-auth',
    OR3_AUTH_PROVIDER: 'basic-auth',
    OR3_GUEST_ACCESS_ENABLED: 'false',
    OR3_AUTH_REGISTRATION_MODE: 'invite_only',
    OR3_AUTH_AUTO_PROVISION: 'false',
    OR3_SYNC_ENABLED: 'true',
    OR3_CLOUD_SYNC_ENABLED: 'true',
    OR3_SYNC_PROVIDER: 'sqlite',
    OR3_STORAGE_ENABLED: 'true',
    OR3_CLOUD_STORAGE_ENABLED: 'true',
    NUXT_PUBLIC_STORAGE_PROVIDER: 'fs',
};

if (full) {
    await requireCommand('Populated workspace performance gate', 'bun', ['run', 'scripts/performance/compare-populated-workspace.ts'], fixedProfile);
}
await requireCommand('Registry-clean lock contract', 'bun', ['run', 'scripts/release/check-lock-drift.mjs']);
await requireCommand(
    'Cloud version and provider contract',
    'bun',
    ['run', 'scripts/release/check-cloud-package.mjs', ...(registry ? ['--registry'] : [])],
);
await requireCommand('Cloud CLI package checks', 'bun', ['run', 'cloud:package:check']);
await requireCommand(
    'Release guardrail tests',
    'bunx',
    ['vitest', 'run', 'scripts/__tests__/release-preflight.test.ts', '--reporter=dot'],
);
await requireCommand('Documentation and packed CLI checks', 'bun', ['run', 'check:docs']);
await requireCommand('Cloud tarball dry run', 'bun', ['run', '--cwd', 'packages/or3-cloud', 'pack:check']);
await requireCommand('Clean fixed-profile production typecheck', 'bun', ['run', 'type-check'], fixedProfile);
if (full) {
    await requireCommand('Complete host test suite', 'bun', ['run', 'test:full'], fixedProfile);
    await requireCommand('OR3 skills package tests', 'bun', ['run', '--cwd', 'packages/or3-skills', 'test:all'], fixedProfile);
    await requireCommand('Cloud browser harnesses', 'bun', ['run', 'test:e2e:cloud'], fixedProfile);
    await requireCommand('Fixed-profile SSR production build', 'bun', ['run', 'build'], fixedProfile);
    await requireCommand('SSR production artifact budgets', 'bun', ['run', 'performance:production-build:check'], fixedProfile);
}

await mkdir(reportDirectory, { recursive: true });
const report = {
    schemaVersion: 1,
    kind: 'or3-release-preflight',
    version,
    sourceSha,
    fixedProfile: 'basic-auth+sqlite+fs',
    registryChecked: registry,
    repositoryChecked: repository,
    repositoryReadiness,
    fullChecks: full,
    timingsMs: timings,
    completedAt: new Date().toISOString(),
};
await writeFile(resolve(reportDirectory, 'preflight.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`\nOR3 release preparation passed for ${version} at ${sourceSha}.`);
