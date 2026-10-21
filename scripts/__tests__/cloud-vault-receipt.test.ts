import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// Failure inventory: daemon failure prevents cleanup, but the security receipt
// claims that disposable resources were removed. The fake executable never
// contacts Docker and exercises the real harness's failure/finally path.
it('records unverified resource cleanup when the Docker command fails', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'or3-vault-receipt-'));
    try {
        await mkdir(join(fixture, 'bin'));
        await mkdir(join(fixture, 'scripts/docker'), { recursive: true });
        await mkdir(join(fixture, 'node_modules/@or3/secrets/dist'), { recursive: true });
        await writeFile(join(fixture, 'bin/docker'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
        await writeFile(join(fixture, 'scripts/docker/vault-entrypoint.mjs'), '');
        await writeFile(join(fixture, 'node_modules/@or3/secrets/dist/cli.js'), '');
        await writeFile(join(fixture, 'node_modules/@or3/secrets/dist/client.js'), 'export const createClient = () => {};');
        const result = spawnSync('bun', ['--no-env-file', resolve('scripts/test/run-cloud-vault-e2e.ts')], {
            cwd: fixture, timeout: 30_000, encoding: 'utf8',
            env: { ...process.env, PATH: `${join(fixture, 'bin')}${delimiter}${process.env.PATH}`,
                GIT_DIR: execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim() },
        });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(1);
        const receipt = JSON.parse(await readFile(join(fixture, 'test-results/cloud-vault/receipt.json'), 'utf8'));
        expect(receipt.exitCode).toBe(1);
        expect(receipt.resourcesRemoved).toBe(false);
        expect(receipt.fixtureDirectoryRemoved).toBe(true);
        expect(receipt.syntheticFixturesRemoved).toBeUndefined();
    } finally { await rm(fixture, { recursive: true, force: true }); }
});
