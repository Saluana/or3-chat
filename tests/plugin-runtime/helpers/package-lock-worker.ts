import { appendFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AdvisoryPluginOperationLock } from '../../../server/admin/plugins/package-operation-lock';

const [root, pluginId, operation, tracePath, gatePath = ''] = process.argv.slice(2);
if (!root || !pluginId || !operation || !tracePath) throw new Error('missing worker arguments');

async function trace(event: string): Promise<void> {
    await appendFile(tracePath, `${JSON.stringify({ operation, event })}\n`);
}

async function waitForGate(): Promise<void> {
    if (!gatePath) return;
    while (true) {
        if (await stat(gatePath).then(() => true, () => false)) return;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
    }
}

await trace('starting');
const lease = await new AdvisoryPluginOperationLock(resolve(root)).acquire(pluginId, {
    timeoutMs: 5_000,
    pollIntervalMs: 5,
    staleAfterMs: 2_000,
});
await trace('acquired');
await waitForGate();
await trace('releasing');
await lease.release();
await trace('released');
