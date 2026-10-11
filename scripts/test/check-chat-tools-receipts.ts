import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { strict as assert } from 'node:assert';

const root = resolve(import.meta.dir, '../..');
const directory = await mkdtemp('/tmp/or3-chat-tools-receipts-');
try {
    const config = join(directory, 'playwright.config.mjs');
    const receipt = join(directory, 'receipt.json');
    await writeFile(config, `import { defineConfig } from ${JSON.stringify(import.meta.resolve('@playwright/test'))};
export default defineConfig({
    testDir: ${JSON.stringify(join(root, 'tests/e2e/fixtures'))}, testMatch: '**/chat-tools-receipt-canary.ts',
    workers: 1, retries: 1, outputDir: ${JSON.stringify(join(directory, 'browser'))},
    reporter: [['line'], [${JSON.stringify(join(root, 'scripts/test/chat-tools-reporter.ts'))},
        { receiptPath: ${JSON.stringify(receipt)}, command: 'bun run test:chat-tools:receipts', commit: 'receipt-canary', dirty: false }]],
});`);
    const child = Bun.spawnSync(['bunx', 'playwright', 'test', '--config', config], { cwd: root,
        stdout: 'pipe', stderr: 'pipe' });
    if (child.exitCode !== 0) throw new Error(`Receipt canary failed (exit ${child.exitCode}).\n${child.stdout.toString()}${child.stderr.toString()}`);
    const saved = await Bun.file(receipt).json();
    assert.equal(saved.status, 'passed');
    assert.equal(saved.commit, 'receipt-canary');
    assert.equal(saved.dirty, false);
    assert.equal(saved.tests.length, 3);
    assert.equal(saved.cases.length, 4);
    assert.deepEqual(saved.cases.map((attempt: { status: string }) => attempt.status), ['passed', 'failed', 'passed', 'passed']);
    assert.deepEqual(saved.cases.filter((attempt: { case: string }) => attempt.case === 'case retried in a replacement worker')
        .map((attempt: { retry: number }) => attempt.retry), [0, 1]);
    assert.equal(new Set(saved.cases.map((attempt: { workerIndex: number }) => attempt.workerIndex)).size, 2);
    assert.ok(saved.cases.every((attempt: { snapshot: { marker: string }; case: string }) => attempt.snapshot.marker === attempt.case));
    console.log('Chat tool receipts preserve all 3 cases and 4 attempts across worker restart.');
} finally { await rm(directory, { recursive: true, force: true }); }
