import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const worker = resolve(repoRoot, 'tests/plugin-runtime/helpers/package-lock-worker.ts');

function events(tracePath: string): Array<{ operation: string; event: string }> {
    if (!existsSync(tracePath)) return [];
    return readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function waitFor(
    tracePath: string,
    predicate: (entries: ReturnType<typeof events>) => boolean
): Promise<ReturnType<typeof events>> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const entries = events(tracePath);
        if (predicate(entries)) return entries;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
    }
    throw new Error(`Timed out waiting for process trace: ${JSON.stringify(events(tracePath))}`);
}

function start(root: string, pluginId: string, operation: string, tracePath: string, gatePath = ''): ChildProcess {
    return spawn('bun', [worker, root, pluginId, operation, tracePath, gatePath], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function completed(child: ChildProcess): Promise<void> {
    return new Promise((resolvePromise, reject) => {
        let stderr = '';
        child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(stderr || `worker exited ${code}`)));
    });
}

describe('multi-process plugin package operations', () => {
    it.each([
        ['install', 'update'],
        ['update', 'uninstall'],
    ])('serializes %s and %s for one plugin ID', async (firstOperation, secondOperation) => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-package-lock-process-'));
        const tracePath = resolve(root, 'trace.ndjson');
        const gatePath = resolve(root, 'release-first');
        const first = start(root, 'alpha', firstOperation, tracePath, gatePath);
        await waitFor(tracePath, (entries) => entries.some((entry) => entry.operation === firstOperation && entry.event === 'acquired'));
        const second = start(root, 'alpha', secondOperation, tracePath);
        await waitFor(tracePath, (entries) => entries.some((entry) => entry.operation === secondOperation && entry.event === 'starting'));
        writeFileSync(gatePath, 'release');
        await Promise.all([completed(first), completed(second)]);

        const trace = events(tracePath);
        const firstReleasing = trace.findIndex((entry) => entry.operation === firstOperation && entry.event === 'releasing');
        const secondAcquired = trace.findIndex((entry) => entry.operation === secondOperation && entry.event === 'acquired');
        expect(firstReleasing).toBeGreaterThanOrEqual(0);
        expect(secondAcquired).toBeGreaterThan(firstReleasing);
    });
});
