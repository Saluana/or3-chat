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
const known = new Set(['--version', '--registry', '--full']);
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
    const result = await command(executable, commandArgs, { env });
    if (result.exitCode !== 0) throw new Error(`${label} failed with exit ${result.exitCode}.`);
}

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
    await requireCommand('Host test suite', 'bun', ['run', 'test'], fixedProfile);
    await requireCommand('Cloud browser harnesses', 'bun', ['run', 'test:e2e:cloud'], fixedProfile);
    await requireCommand('Populated workspace performance gate', 'bun', ['run', 'performance:workspace:check'], fixedProfile);
    await requireCommand('Fixed-profile SSR production build', 'bun', ['run', 'build'], fixedProfile);
    await requireCommand('SSR production artifact budgets', 'bun', ['run', 'performance:production-build:check'], fixedProfile);
}

const reportDirectory = resolve(root, 'output/release');
await mkdir(reportDirectory, { recursive: true });
const report = {
    schemaVersion: 1,
    kind: 'or3-release-preflight',
    version,
    sourceSha,
    fixedProfile: 'basic-auth+sqlite+fs',
    registryChecked: registry,
    fullChecks: full,
    completedAt: new Date().toISOString(),
};
await writeFile(resolve(reportDirectory, 'preflight.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`\nOR3 release preparation passed for ${version} at ${sourceSha}.`);
