import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    assertCleanStatus,
    assertReleaseVersionContract,
    releaseCheckEnvironment,
    isRegistryNotFound,
} from '../release/release-preflight-core';
import { buildOr3CloudConfigFromEnv } from '../../server/admin/config/resolve-config';
import { assertCandidateReceipt, assertTwoProfileCandidateReceipt } from '../release/candidate-receipt-core.mjs';
import { assertInspectionProfile, assertS3InspectionProfile } from '../docker/backup-inspect.mjs';

it('qualifies the managed profile independently of conflicting caller settings', () => {
    // Missing SSR auth disables every provider; ambient aliases, test harnesses,
    // and credentials must not silently change the production qualification.
    const env = releaseCheckEnvironment({
        PATH: '/fixture/bin', SSR_AUTH_ENABLED: 'false', OR3_CLOUD_SYNC_ENABLED: 'false',
        OR3_STORAGE_ENABLED: 'false', OR3_AUTH_PROVIDER: 'clerk',
        NUXT_PUBLIC_STORAGE_PROVIDER: 's3', OR3_PRODUCTION_JOURNEY_TEST_HARNESS: 'true',
    });
    const config = buildOr3CloudConfigFromEnv(env);
    expect(config.auth).toMatchObject({ enabled: true, provider: 'basic-auth', registrationMode: 'invite_only' });
    expect(config.sync).toMatchObject({ enabled: true, provider: 'sqlite' });
    expect(config.storage).toMatchObject({ enabled: true, provider: 'fs' });
    expect(env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS).toBeUndefined();
    expect(env.PATH).toBe('/fixture/bin');
});

describe('fixed-profile lock qualification', () => {
    const root = resolve(import.meta.dirname, '../..');

    async function checkLock(extraPath?: string, entry: Record<string, unknown> = { version: '1.0.0' }, staleVersion = false) {
        const directory = await mkdtemp(join(tmpdir(), 'or3-lock-preflight-'));
        try {
            const manifest = await readFile(join(root, 'package.json'), 'utf8');
            const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
            if (extraPath) lock.packages[extraPath] = entry;
            if (staleVersion) lock.packages[''].version = '0.0.0-stale';
            await writeFile(join(directory, 'package.json'), manifest);
            await writeFile(join(directory, 'package-lock.json'), JSON.stringify(lock));
            return spawnSync('bun', [join(root, 'scripts/release/check-lock-drift.mjs')], {
                cwd: directory,
                encoding: 'utf8',
                timeout: 10_000,
            });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }

    it('accepts the committed fixed-profile dependency graph', async () => {
        const result = await checkLock();
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
    });

    it.each([
        'or3-provider-clerk',
        'or3-provider-convex',
        'or3-provider-s3',
        'convex',
    ])('rejects inactive %s at root and nested npm package paths', async (name) => {
        for (const prefix of ['node_modules/', 'node_modules/fixture/node_modules/']) {
            const packagePath = `${prefix}${name}`;
            const result = await checkLock(packagePath);
            expect(result.error).toBeUndefined();
            expect(result.status, `${packagePath}\n${result.stdout}`).toBe(1);
            expect(result.stderr).toContain(`inactive fixed-profile dependency ${packagePath}`);
        }
    });

    it('does not reject similarly named packages', async () => {
        for (const packagePath of ['node_modules/convex-helper', 'node_modules/@fixture/convex']) {
            const result = await checkLock(packagePath);
            expect(result.error).toBeUndefined();
            expect(result.status, result.stderr).toBe(0);
        }
    });

    it.each(['file:../or3-provider-clerk', '../or3-provider-clerk'])('rejects sibling path %s hidden in a resolved lock entry', async (resolved) => {
        const result = await checkLock('node_modules/fixture', { version: '1.0.0', resolved });
        expect(result.status, result.stdout).toBe(1);
        expect(result.stderr).toContain('local link');
    });

    it('rejects a lock whose root version is stale', async () => {
        const result = await checkLock(undefined, undefined, true);
        expect(result.status, result.stdout).toBe(1);
        expect(result.stderr).toContain('version');
    });
});

describe('managed Docker profile projection', () => {
    const root = resolve(import.meta.dirname, '../..');

    async function project(profile: string) {
        const directory = await mkdtemp(join(tmpdir(), 'or3-profile-'));
        try {
            const manifestPath = join(directory, 'package.json');
            await writeFile(manifestPath, await readFile(join(root, 'package.json'), 'utf8'));
            const result = spawnSync('bun', [join(root, 'scripts/docker/prepare-manifest.mjs'), manifestPath], {
                env: { ...process.env, OR3_DOCKER_PROFILE: profile }, encoding: 'utf8', timeout: 10_000,
            });
            return { result, manifest: JSON.parse(await readFile(manifestPath, 'utf8')) };
        } finally { await rm(directory, { recursive: true, force: true }); }
    }

    it('selects the published Clerk, SQLite and S3 graph for the launch profile', async () => {
        const { result, manifest } = await project('clerk-sqlite-s3');
        expect(result.status, result.stderr).toBe(0);
        expect(manifest.dependencies).toMatchObject({
            'or3-provider-clerk': '0.0.11', 'or3-provider-sqlite': '0.0.28', 'or3-provider-s3': '0.0.15',
        });
        expect(manifest.dependencies['or3-provider-basic-auth']).toBeUndefined();
        expect(manifest.dependencies['or3-provider-fs']).toBeUndefined();
        expect(manifest.dependencies['or3-provider-convex']).toBeUndefined();
        expect(manifest.devDependencies.convex).toBeUndefined();
    });

    it('rejects an unknown profile rather than silently building the default', async () => {
        const { result } = await project('clerk-sqlite-typo');
        expect(result.status).not.toBe(0);
    });

    it('does not accept the default lock as the launch profile lock', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'or3-profile-lock-'));
        try {
            const manifest = await readFile(join(root, 'package.json'), 'utf8');
            const lock = await readFile(join(root, 'package-lock.json'), 'utf8');
            await writeFile(join(directory, 'package.json'), manifest);
            await writeFile(join(directory, 'package-lock.json'), lock);
            await writeFile(join(directory, 'package-lock.clerk-sqlite-s3.json'), lock);
            const result = spawnSync('bun', [join(root, 'scripts/release/check-lock-drift.mjs')], {
                cwd: directory, env: { ...process.env, OR3_DOCKER_PROFILE: 'clerk-sqlite-s3' },
                encoding: 'utf8', timeout: 10_000,
            });
            expect(result.status, result.stdout).not.toBe(0);
        } finally { await rm(directory, { recursive: true, force: true }); }
    });

    it('builds the exact launch inspection contract without filesystem dependencies', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'or3-inspection-profile-'));
        try {
            for (const [name, version] of [['or3-provider-sqlite', '0.0.28'], ['or3-provider-s3', '0.0.15']]) {
                const packageDir = join(directory, 'node_modules', name);
                await mkdir(packageDir, { recursive: true });
                await writeFile(join(packageDir, 'package.json'), JSON.stringify({ version }));
            }
            await mkdir(join(directory, 'scripts/docker'), { recursive: true });
            const run = (profile: string) => spawnSync('bun', [join(root, 'scripts/docker/prepare-backup-inspection.mjs')], {
                cwd: directory, env: { ...process.env, OR3_DOCKER_PROFILE: profile }, encoding: 'utf8', timeout: 10_000,
            });
            const result = run('clerk-sqlite-s3');
            expect(result.status, result.stderr).toBe(0);
            const profile = JSON.parse(await readFile(join(directory, 'scripts/docker/backup-inspection-profile.json'), 'utf8'));
            expect(() => assertInspectionProfile(profile)).toThrow('Unsupported');
            expect(() => assertS3InspectionProfile(profile)).not.toThrow();
            expect(profile).toEqual({ contract: 2, sqlite: '0.0.28', s3: '0.0.15' });
            await writeFile(join(directory, 'node_modules/or3-provider-s3/package.json'), JSON.stringify({ version: '0.0.14' }));
            expect(run('clerk-sqlite-s3').status).not.toBe(0);
            expect(run('unknown').status).not.toBe(0);
        } finally { await rm(directory, { recursive: true, force: true }); }
    });
});

describe('release preflight invariants', () => {
    it('requires every version surface including lock metadata to match', () => {
        const aligned = {
            requested: '1.2.3',
            root: '1.2.3',
            lock: '1.2.3',
            lockRoot: '1.2.3',
            launchLock: '1.2.3',
            launchLockRoot: '1.2.3',
            cloud: '1.2.3',
            cli: '1.2.3',
        };
        expect(() => assertReleaseVersionContract(aligned)).not.toThrow();
        expect(() => assertReleaseVersionContract({ ...aligned, lock: '1.2.2' })).toThrow('lock=1.2.2');
        expect(() => assertReleaseVersionContract({ ...aligned, launchLockRoot: '1.2.2' })).toThrow('launchLockRoot=1.2.2');
        const { launchLock: _missing, ...withoutLaunchLock } = aligned;
        expect(() => assertReleaseVersionContract(withoutLaunchLock as never)).toThrow('launchLock=missing');
        expect(() => assertReleaseVersionContract({ ...aligned, requested: '1.2.3-beta.1' })).toThrow('exact stable');
    });

    it('distinguishes an unused registry slot from infrastructure errors', () => {
        expect(isRegistryNotFound('npm error code E404')).toBe(true);
        expect(isRegistryNotFound('manifest unknown')).toBe(true);
        expect(isRegistryNotFound('no such manifest: ghcr.io/example/app:1.2.3')).toBe(true);
        expect(isRegistryNotFound('getaddrinfo ENOTFOUND registry.npmjs.org')).toBe(false);
        expect(isRegistryNotFound('docker executable not found')).toBe(false);
    });

    it('refuses any tracked or untracked release worktree change', () => {
        expect(() => assertCleanStatus('')).not.toThrow();
        expect(() => assertCleanStatus('?? local.env\n M package.json')).toThrow('clean isolated worktree');
    });
});

describe('qualified candidate receipts', () => {
    const receipt = {
        schemaVersion: 1 as const,
        kind: 'or3-cloud-qualified-candidate' as const,
        version: '1.2.3',
        sourceSha: 'a'.repeat(40),
        candidateImage: `ghcr.io/saluana/or3-chat:candidate-1.2.3-${'a'.repeat(40)}`,
        candidateDigest: `sha256:${'b'.repeat(64)}`,
        operatorCandidateImage: `ghcr.io/saluana/or3-chat:candidate-operator-1.2.3-${'a'.repeat(40)}`,
        operatorCandidateDigest: `sha256:${'d'.repeat(64)}`,
        tarballFile: 'or3-cloud-1.2.3.tgz',
        tarballSha256: 'c'.repeat(64),
        tarballIntegrity: `sha512-${Buffer.from('integrity').toString('base64')}`,
        workflowRunId: '42',
        qualifiedAt: new Date().toISOString(),
    };

    it('requires source, image, and tarball identities', () => {
        expect(assertCandidateReceipt(receipt)).toEqual(receipt);
        expect(() => assertCandidateReceipt({ ...receipt, sourceSha: 'main' })).toThrow('immutable release evidence');
        expect(() => assertCandidateReceipt({ ...receipt, candidateDigest: 'latest' })).toThrow('immutable release evidence');
        expect(() => assertCandidateReceipt({ ...receipt, candidateImage: 'ghcr.io/saluana/or3-chat:latest' })).toThrow('immutable release evidence');
        expect(() => assertCandidateReceipt({ ...receipt, operatorCandidateDigest: 'latest' })).toThrow('immutable release evidence');
    });

    it('refuses future and mixed-profile receipts before running tar or Docker', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'or3-receipt-boundary-'));
        const trace = join(directory, 'commands');
        const script = resolve(import.meta.dirname, '../release/candidate-receipt.mjs');
        try {
            for (const name of ['tar', 'docker']) {
                const path = join(directory, name);
                await writeFile(path, `#!/bin/sh\nprintf '%s\\n' invoked >> "$OR3_RECEIPT_TRACE"\nexit 1\n`);
                await chmod(path, 0o700);
            }
            for (const invalid of [
                { ...receipt, schemaVersion: 2 },
                { ...receipt, schemaVersion: 99 },
                { ...receipt, applications: { 'clerk-sqlite-s3': { candidateDigest: `sha256:${'e'.repeat(64)}` } } },
            ]) {
                const receiptPath = join(directory, 'receipt.json');
                await writeFile(receiptPath, JSON.stringify(invalid));
                const result = spawnSync(process.execPath, [script, 'verify', '--receipt', receiptPath,
                    '--tarball', join(directory, receipt.tarballFile), '--version', receipt.version,
                    '--image', receipt.candidateImage, '--operator-image', receipt.operatorCandidateImage], {
                    encoding: 'utf8', timeout: 10_000,
                    env: { ...process.env, PATH: directory, OR3_RECEIPT_TRACE: trace },
                });
                expect(result.error).toBeUndefined();
                expect(result.status).toBe(1);
                expect(result.stderr).toContain('immutable release evidence');
                expect(existsSync(trace)).toBe(false);
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it('binds the packed CLI identity to the schema-1 receipt before registry checks', async () => {
        // Failure inventory: a different package, version, state schema, or
        // launch-profile metadata must not be promoted under a schema-1 receipt.
        const directory = await mkdtemp(join(tmpdir(), 'or3-packed-receipt-'));
        const script = resolve(import.meta.dirname, '../release/candidate-receipt.mjs');
        const trace = join(directory, 'docker-trace');
        const tarball = join(directory, receipt.tarballFile);
        const receiptPath = join(directory, 'receipt.json');
        const metadata = {
            stateSchema: 1, dashboardUpdateProtocol: 1, dashboardUpdateMinimumSourceVersion: '1.0.0',
            imageDigest: receipt.candidateDigest, operatorImageDigest: receipt.operatorCandidateDigest, sourceRevision: receipt.sourceSha,
        };
        try {
            await mkdir(join(directory, 'package'));
            const docker = join(directory, 'docker');
            await writeFile(docker, `#!/bin/sh\nprintf '%s\\n' invoked >> "$OR3_RECEIPT_TRACE"\ncase "$1 $2 $3" in\n  'buildx imagetools inspect') case "$4" in *candidate-operator*) printf 'Digest: ${receipt.operatorCandidateDigest}\\n';; *) printf 'Digest: ${receipt.candidateDigest}\\n';; esac;;\n  'image inspect --format') printf '%s\\n' '{"org.opencontainers.image.revision":"${receipt.sourceSha}","org.opencontainers.image.version":"${receipt.version}"}';;\n  pull*) :;;\n  *) exit 1;;\nesac\n`);
            await chmod(docker, 0o700);
            const invoke = async (manifest: Record<string, unknown>, command: 'create' | 'verify') => {
                await writeFile(join(directory, 'package/package.json'), JSON.stringify(manifest));
                const packed = spawnSync('/usr/bin/tar', ['-czf', tarball, '-C', directory, 'package'], { encoding: 'utf8' });
                expect(packed.status, packed.stderr).toBe(0);
                const bytes = await readFile(tarball);
                await writeFile(receiptPath, JSON.stringify({ ...receipt, tarballSha256: createHash('sha256').update(bytes).digest('hex'), tarballIntegrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }));
                await rm(trace, { force: true });
                const common = ['--tarball', tarball, '--version', receipt.version, '--image', receipt.candidateImage, '--operator-image', receipt.operatorCandidateImage];
                const args = command === 'verify' ? ['verify', '--receipt', receiptPath, ...common] : ['create', '--source-sha', receipt.sourceSha, '--run-id', receipt.workflowRunId, '--output', join(directory, 'output.json'), ...common];
                return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, OR3_RECEIPT_TRACE: trace } });
            };
            const valid = { name: '@or3/cloud', version: receipt.version, or3Cloud: metadata };
            const result = await invoke(valid, 'verify');
            expect(result.status, result.stderr).toBe(0);
            expect(existsSync(trace)).toBe(true);
            const created = await invoke(valid, 'create');
            expect(created.status, created.stderr).toBe(0);
            const roundTrip = spawnSync(process.execPath, [script, 'verify', '--receipt', join(directory, 'output.json'),
                '--tarball', tarball, '--version', receipt.version, '--image', receipt.candidateImage,
                '--operator-image', receipt.operatorCandidateImage], {
                encoding: 'utf8', timeout: 10_000,
                env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, OR3_RECEIPT_TRACE: trace },
            });
            expect(roundTrip.status, roundTrip.stderr).toBe(0);
            const { stateSchema: _absent, ...legacyMetadata } = metadata;
            for (const compatible of [{ ...metadata, stateSchema: 2 }, legacyMetadata]) {
                const accepted = await invoke({ ...valid, or3Cloud: compatible }, 'verify');
                expect(accepted.status, accepted.stderr).toBe(0);
            }
            for (const invalid of [
                { ...valid, name: '@fixture/other' },
                { ...valid, version: '1.2.4' },
                { ...valid, or3Cloud: { ...metadata, stateSchema: 3 } },
                { ...valid, or3Cloud: { ...metadata, launchImageDigest: `sha256:${'e'.repeat(64)}` } },
            ]) {
                for (const command of ['create', 'verify'] as const) {
                    const rejected = await invoke(invalid, command);
                    expect(rejected.status, rejected.stderr).toBe(1);
                    expect(rejected.stderr).toMatch(/Packed CLI/i);
                    expect(existsSync(trace)).toBe(false);
                }
            }
            for (const key of ['imageDigest', 'operatorImageDigest', 'sourceRevision'] as const) {
                const rejected = await invoke({ ...valid, or3Cloud: { ...metadata, [key]: 'wrong' } }, 'verify');
                expect(rejected.status).toBe(1);
                expect(rejected.stderr).toMatch(/Packed CLI/i);
                expect(existsSync(trace)).toBe(false);
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it('verifies the complete Basic evidence set without accepting a mixed or incomplete run', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'or3-basic-evidence-'));
        const script = resolve(import.meta.dirname, '../release/candidate-receipt.mjs');
        const tarball = join(directory, receipt.tarballFile), evidence = join(directory, 'basic-sqlite-fs');
        try {
            await mkdir(join(directory, 'package')); await mkdir(evidence);
            await writeFile(join(directory, 'package/package.json'), JSON.stringify({ name: '@or3/cloud', version: receipt.version, or3Cloud: { stateSchema: 1, imageDigest: receipt.candidateDigest, operatorImageDigest: receipt.operatorCandidateDigest, sourceRevision: receipt.sourceSha } }));
            expect(spawnSync('/usr/bin/tar', ['-czf', tarball, '-C', directory, 'package']).status).toBe(0);
            const tarballSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex');
            for (const check of ['imageContract', 'scanAmd64', 'scanArm64', 'nativeAddonArm64', 'lifecycle', 'browser']) await writeFile(join(evidence, `${check}.json`), JSON.stringify({
                schemaVersion: 1, profile: 'basic-sqlite-fs', check, result: 'passed', sourceSha: receipt.sourceSha, workflowRunId: receipt.workflowRunId, candidateDigest: receipt.candidateDigest,
                ...(check === 'imageContract' ? { operatorCandidateDigest: receipt.operatorCandidateDigest } : {}),
                ...(['lifecycle', 'browser'].includes(check) ? { operatorCandidateDigest: receipt.operatorCandidateDigest, tarballSha256 } : {}),
            }));
            const args = ['verify-basic-evidence', '--version', receipt.version, '--source-sha', receipt.sourceSha, '--run-id', receipt.workflowRunId, '--image', receipt.candidateImage, '--operator-image', receipt.operatorCandidateImage, '--candidate-digest', receipt.candidateDigest, '--operator-digest', receipt.operatorCandidateDigest, '--tarball', tarball, '--evidence-dir', evidence];
            const invoke = (extra: string[] = []) => spawnSync(process.execPath, [script, ...args, ...extra], { encoding: 'utf8', timeout: 10_000 });
            expect(invoke().status).toBe(0);
            const actualReceipt = join(directory, 'actual-receipt.json');
            const integrity = `sha512-${createHash('sha512').update(await readFile(tarball)).digest('base64')}`;
            await writeFile(actualReceipt, JSON.stringify({ ...receipt, tarballSha256, tarballIntegrity: integrity }));
            expect(invoke(['--receipt', actualReceipt]).status).toBe(0);
            await writeFile(actualReceipt, JSON.stringify({ ...receipt, tarballSha256, tarballIntegrity: integrity, workflowRunId: '999' }));
            expect(invoke(['--receipt', actualReceipt]).status).not.toBe(0);
            const path = join(evidence, 'browser.json'); const original = await readFile(path, 'utf8');
            for (const change of [{ workflowRunId: '999' }, { candidateDigest: receipt.operatorCandidateDigest }, { tarballSha256: '0'.repeat(64) }, { unexpected: true }]) {
                await writeFile(path, JSON.stringify({ ...JSON.parse(original), ...change })); expect(invoke().status).not.toBe(0);
            }
            await writeFile(path, original); await rm(join(evidence, 'scanArm64.json'));
            expect(invoke().status).not.toBe(0);
        } finally { await rm(directory, { recursive: true, force: true }); }
    });

    it('requires explicit two-profile qualification and verifies its exact artifacts', async () => {
        // Failure inventory: wrong profile/digest/check/result, changed or extra
        // evidence, missing launch tarball binding, and implicit schema selection.
        const directory = await mkdtemp(join(tmpdir(), 'or3-two-profile-receipt-'));
        const script = resolve(import.meta.dirname, '../release/candidate-receipt.mjs');
        const trace = join(directory, 'docker-trace');
        const tarball = join(directory, receipt.tarballFile);
        const receiptPath = join(directory, 'receipt.json');
        const evidence = join(directory, 'qualification');
        const launchImage = `ghcr.io/saluana/or3-chat:candidate-clerk-s3-${receipt.version}-${receipt.sourceSha}`;
        const launchDigest = `sha256:${'e'.repeat(64)}`;
        const checks = ['imageContract', 'scanAmd64', 'scanArm64', 'nativeAddonArm64', 'lifecycle', 'browser'];
        try {
            await mkdir(join(directory, 'package'));
            await writeFile(join(directory, 'package/package.json'), JSON.stringify({ name: '@or3/cloud', version: receipt.version, or3Cloud: {
                stateSchema: 1, imageDigest: receipt.candidateDigest, launchImageDigest: launchDigest,
                operatorImageDigest: receipt.operatorCandidateDigest, sourceRevision: receipt.sourceSha,
            } }));
            const packed = spawnSync('/usr/bin/tar', ['-czf', tarball, '-C', directory, 'package'], { encoding: 'utf8' });
            expect(packed.status, packed.stderr).toBe(0);
            const tarballSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex');
            const docker = join(directory, 'docker');
            await writeFile(docker, `#!/bin/sh\nprintf '%s\\n' invoked >> "$OR3_RECEIPT_TRACE"\ncase "$1 $2 $3" in\n  'buildx imagetools inspect') case "$4" in *candidate-operator*) printf 'Digest: ${receipt.operatorCandidateDigest}\\n';; *candidate-clerk-s3*) if [ -n "$OR3_FAKE_LAUNCH_DIGEST" ]; then printf 'Digest: %s\\n' "$OR3_FAKE_LAUNCH_DIGEST"; else printf 'Digest: ${launchDigest}\\n'; fi;; *) printf 'Digest: ${receipt.candidateDigest}\\n';; esac;;\n  'image inspect --format') if [ -n "$OR3_FAKE_BAD_LABEL" ]; then printf '%s\\n' '{"org.opencontainers.image.revision":"wrong","org.opencontainers.image.version":"${receipt.version}"}'; else printf '%s\\n' '{"org.opencontainers.image.revision":"${receipt.sourceSha}","org.opencontainers.image.version":"${receipt.version}"}'; fi;;\n  pull*) :;;\n  *) exit 1;;\nesac\n`);
            await chmod(docker, 0o700);
            for (const [profile, candidateDigest] of [['basic-sqlite-fs', receipt.candidateDigest], ['clerk-sqlite-s3', launchDigest]]) {
                const profileDir = join(evidence, profile); await mkdir(profileDir, { recursive: true });
                for (const check of checks) await writeFile(join(profileDir, `${check}.json`), JSON.stringify({
                    schemaVersion: 1, profile, check, result: 'passed', sourceSha: receipt.sourceSha,
                    workflowRunId: receipt.workflowRunId, candidateDigest,
                    ...(check === 'imageContract' ? { operatorCandidateDigest: receipt.operatorCandidateDigest } : {}),
                    ...(['lifecycle', 'browser'].includes(check) ? { operatorCandidateDigest: receipt.operatorCandidateDigest, tarballSha256 } : {}),
                }));
            }
            const common = ['--version', receipt.version, '--image', receipt.candidateImage, '--launch-image', launchImage,
                '--operator-image', receipt.operatorCandidateImage, '--tarball', tarball, '--evidence-dir', evidence];
            const invoke = (args: string[], extraEnv: Record<string, string> = {}) => spawnSync(process.execPath, [script, ...args], {
                encoding: 'utf8', timeout: 10_000, env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, OR3_RECEIPT_TRACE: trace, ...extraEnv },
            });
            const created = invoke(['create', '--schema', '2', '--source-sha', receipt.sourceSha, '--run-id', receipt.workflowRunId, '--output', receiptPath, ...common]);
            expect(created.status, created.stderr).toBe(0);
            const checked = invoke(['verify', '--schema', '2', '--receipt', receiptPath, ...common]);
            expect(checked.status, checked.stderr).toBe(0);
            const imageArtifact = join(evidence, 'basic-sqlite-fs', 'imageContract.json');
            const imageOriginal = await readFile(imageArtifact, 'utf8');
            await writeFile(imageArtifact, JSON.stringify({ ...JSON.parse(imageOriginal), operatorCandidateDigest: receipt.candidateDigest }));
            await rm(trace, { force: true });
            expect(invoke(['verify', '--schema', '2', '--receipt', receiptPath, ...common]).status).toBe(1);
            expect(existsSync(trace)).toBe(false);
            await writeFile(imageArtifact, imageOriginal);
            const drift = invoke(['verify', '--schema', '2', '--receipt', receiptPath, ...common], { OR3_FAKE_LAUNCH_DIGEST: `sha256:${'f'.repeat(64)}` });
            expect(drift.stderr).toMatch(/digest mismatch/i);
            expect(drift.status).toBe(1);
            const label = invoke(['verify', '--schema', '2', '--receipt', receiptPath, ...common], { OR3_FAKE_BAD_LABEL: '1' });
            expect(label.stderr).toMatch(/label mismatch/i);
            expect(label.status).toBe(1);
            expect(invoke(['verify', '--receipt', receiptPath, ...common]).status).toBe(1);
            const originalReceipt = await readFile(receiptPath, 'utf8');
            const duplicated = JSON.parse(originalReceipt);
            duplicated.applications[1].candidateDigest = duplicated.applications[0].candidateDigest;
            duplicated.applications[1].qualification.candidateDigest = duplicated.applications[0].candidateDigest;
            expect(() => assertTwoProfileCandidateReceipt(duplicated)).toThrow();
            await writeFile(receiptPath, JSON.stringify(duplicated));
            expect(invoke(['verify', '--schema', '2', '--receipt', receiptPath, ...common]).status).toBe(1);
            duplicated.applications[1] = duplicated.applications[0];
            await writeFile(receiptPath, JSON.stringify(duplicated));
            expect(invoke(['verify', '--schema', '2', '--receipt', receiptPath, ...common]).status).toBe(1);
            await writeFile(receiptPath, originalReceipt);
            const artifact = join(evidence, 'clerk-sqlite-s3', 'lifecycle.json');
            const original = await readFile(artifact, 'utf8');
            for (const change of [
                { check: 'browser' }, { result: 'failed' }, { profile: 'basic-sqlite-fs' },
                { candidateDigest: receipt.candidateDigest }, { operatorCandidateDigest: receipt.candidateDigest },
                { tarballSha256: '0'.repeat(64) }, { sourceSha: '0'.repeat(40) }, { workflowRunId: '1' },
            ]) {
                await writeFile(artifact, JSON.stringify({ ...JSON.parse(original), ...change }));
                await rm(trace, { force: true });
                expect(invoke(['verify', '--schema', '2', '--receipt', receiptPath, ...common]).status).toBe(1);
                expect(existsSync(trace)).toBe(false);
            }
            await writeFile(artifact, original);
            await rm(artifact);
            expect(invoke(['verify', '--schema', '2', '--receipt', receiptPath, ...common]).status).toBe(1);
            await writeFile(artifact, original);
            await writeFile(artifact, `${original}\n`);
            expect(invoke(['verify', '--schema', '2', '--receipt', receiptPath, ...common]).status).toBe(1);
            await rm(artifact);
            expect(spawnSync('/usr/bin/mkfifo', [artifact]).status).toBe(0);
            await rm(trace, { force: true });
            const fifoResult = invoke(['verify', '--schema', '2', '--receipt', receiptPath, ...common]);
            expect(fifoResult.status).toBe(1);
            expect(existsSync(trace)).toBe(false);
            await rm(artifact);
            await writeFile(artifact, original);
            await writeFile(join(evidence, 'clerk-sqlite-s3', 'unexpected.json'), '{}');
            expect(invoke(['verify', '--schema', '2', '--receipt', receiptPath, ...common]).status).toBe(1);
            await rm(join(evidence, 'clerk-sqlite-s3', 'unexpected.json'));
            const missingLaunch = { name: '@or3/cloud', version: receipt.version, or3Cloud: {
                stateSchema: 1, imageDigest: receipt.candidateDigest,
                operatorImageDigest: receipt.operatorCandidateDigest, sourceRevision: receipt.sourceSha,
            } };
            await writeFile(join(directory, 'package/package.json'), JSON.stringify(missingLaunch));
            expect(spawnSync('/usr/bin/tar', ['-czf', tarball, '-C', directory, 'package']).status).toBe(0);
            await rm(trace, { force: true });
            expect(invoke(['verify', '--schema', '2', '--receipt', receiptPath, ...common]).status).toBe(1);
            expect(existsSync(trace)).toBe(false);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
