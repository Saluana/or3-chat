import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stopAppServer } from '../../tests/e2e/fixtures/setup-wizard-app';

// Real disposable listeners verify that the harness never signals an unrelated
// service even if it appears on the expected port during teardown.
describe('setup wizard test cleanup', () => {
    const children: ChildProcess[] = [];
    const roots: string[] = [];
    afterEach(async () => {
        for (const child of children.splice(0)) {
            if (child.exitCode === null && child.signalCode === null) {
                child.kill('SIGTERM');
                await new Promise<void>(resolve => child.once('exit', () => resolve()));
            }
        }
        for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
    });

    async function fixture() {
        const root = await mkdtemp(join(tmpdir(), 'or3-wizard-instance-'));
        roots.push(root);
        return root;
    }

    async function listen(cwd: string) {
        const child = spawn(process.execPath, ['-e', `
            require('node:http').createServer((req, res) => res.end('fixture'))
                .listen(0, '127.0.0.1', function () { console.log(this.address().port); });
        `], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        children.push(child);
        const port = await new Promise<number>((resolve, reject) => {
            child.stdout!.once('data', data => resolve(Number(String(data).trim())));
            child.once('error', reject);
            child.once('exit', () => reject(new Error('fixture exited before listening')));
        });
        return { child, port };
    }

    it('stops a listener owned by the disposable instance', async () => {
        const instance = await fixture();
        const { child, port } = await listen(instance);
        stopAppServer(port, instance);
        await new Promise<void>(resolve => child.once('exit', () => resolve()));
        expect(child.signalCode).toBe('SIGTERM');
    });

    it('refuses to stop a listener outside the disposable instance', async () => {
        const instance = await fixture();
        const unrelated = await fixture();
        const { child, port } = await listen(unrelated);
        try { stopAppServer(port, instance); } catch { /* A refusal is also safe. */ }
        // Give an incorrectly signalled subprocess time to terminate.
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(child.exitCode === null && child.signalCode === null).toBe(true);
        expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('fixture');
    });
});
