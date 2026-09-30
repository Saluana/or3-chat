import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWatchStatus, readWatchedArtifact, type WatchStatus } from '../watched-candidate';

const roots: string[] = [];
const runId = 'ae911428-39f3-463d-b59d-6b43bf654bc2';
const digest = `sha256-${'a'.repeat(64)}`;

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; status: WatchStatus; artifact: string }> {
    const root = await mkdtemp(join(tmpdir(), 'or3-watch-route-'));
    roots.push(root);
    const generation = join(root, 'candidates', runId, '1');
    await mkdir(generation, { recursive: true });
    const artifact = join(generation, 'package.zip');
    await writeFile(artifact, Buffer.from('candidate'));
    const candidate = { runId, generation: 1, pluginId: 'or3.example', packageDigest: digest, receiptDigest: digest };
    const status: WatchStatus = { runId, generation: 1, state: 'ready', candidate, lastGood: candidate };
    await writeFile(join(root, 'watch.json'), JSON.stringify(status));
    return { root, status, artifact };
}

describe('watched candidate bridge', () => {
    it('serves only the current run, generation and known artifact', async () => {
        const { root, status } = await fixture();
        expect((await readWatchedArtifact(root, status, runId, '1', 'package.zip')).toString()).toBe('candidate');
        await expect(readWatchedArtifact(root, status, runId, '2', 'package.zip')).rejects.toMatchObject({ statusCode: 409 });
        await expect(readWatchedArtifact(root, status, runId, '1', 'other.zip')).rejects.toMatchObject({ statusCode: 404 });
        await expect(readWatchedArtifact(root, status, '../secret', '1', 'package.zip')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('rejects symlinked artifacts and malformed or linked status metadata', async () => {
        const { root, status, artifact } = await fixture();
        await rm(artifact);
        const other = join(root, 'outside');
        await writeFile(other, 'secret');
        await symlink(other, artifact);
        await expect(readWatchedArtifact(root, status, runId, '1', 'package.zip')).rejects.toMatchObject({ statusCode: 404 });
        await writeFile(join(root, 'watch.json'), '{');
        await expect(readWatchStatus(root)).rejects.toMatchObject({ statusCode: 503 });
        await rm(join(root, 'watch.json'));
        await symlink(other, join(root, 'watch.json'));
        await expect(readWatchStatus(root)).rejects.toMatchObject({ statusCode: 503 });
        expect(await readFile(other, 'utf8')).toBe('secret');
    });
});
