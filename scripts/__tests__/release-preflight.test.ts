import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    assertCleanStatus,
    assertReleaseVersionContract,
    isRegistryNotFound,
} from '../release/release-preflight-core';
import { assertCandidateReceipt } from '../release/candidate-receipt-core.mjs';

describe('fixed-profile lock qualification', () => {
    const root = resolve(import.meta.dirname, '../..');

    async function checkLock(extraPath?: string) {
        const directory = await mkdtemp(join(tmpdir(), 'or3-lock-preflight-'));
        try {
            const manifest = await readFile(join(root, 'package.json'), 'utf8');
            const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
            if (extraPath) lock.packages[extraPath] = { version: '1.0.0' };
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
        'or3-provider-sqlite-tests',
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
});

describe('release preflight invariants', () => {
    it('requires every version surface including lock metadata to match', () => {
        const aligned = {
            requested: '1.2.3',
            root: '1.2.3',
            lock: '1.2.3',
            lockRoot: '1.2.3',
            cloud: '1.2.3',
            cli: '1.2.3',
        };
        expect(() => assertReleaseVersionContract(aligned)).not.toThrow();
        expect(() => assertReleaseVersionContract({ ...aligned, lock: '1.2.2' })).toThrow('lock=1.2.2');
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
});
