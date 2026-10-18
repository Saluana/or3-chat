import { open, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getShutdownRuntime } from '../../../server/utils/shutdown/runtime';
import { getActiveSyncGatewayAdapter } from '../../../server/sync/gateway/registry';

/** Disposable resource proving the installed Nitro close hook finishes on replacement. */
export default defineNitroPlugin(async nitro => {
    const path = process.env.OR3_RESTART_CLOSE_EVIDENCE;
    if (!path || process.env.OR3_RESTART_E2E !== 'true') return;
    await mkdir(dirname(path), { recursive: true });
    const resource = await open(path, 'a', 0o600);
    const { bootId } = getShutdownRuntime();
    // Inject one transient failure at the real canonical history boundary.
    // The recovery scan must deliver the saved snapshot while restart waits;
    // neither a model replay nor a synthetic completion can satisfy this proof.
    const historyPath = process.env.OR3_RESTART_HISTORY_EVIDENCE;
    let wrapped = false;
    let failed = false;
    nitro.hooks.hook('request', () => {
        if (wrapped || !historyPath) return;
        const adapter = getActiveSyncGatewayAdapter();
        if (!adapter?.finalizeChatGeneration) return;
        wrapped = true;
        const finalize = adapter.finalizeChatGeneration.bind(adapter);
        adapter.finalizeChatGeneration = async (...args) => {
            const phase = getShutdownRuntime().controller.phase();
            if (!failed && phase === 'preparing') {
                failed = true;
                await appendFile(historyPath, JSON.stringify({ event: 'delivery_failed', bootId, phase }) + '\n', { mode: 0o600 });
                throw new Error('Temporary canonical history delivery outage');
            }
            const result = await finalize(...args);
            if (failed) await appendFile(historyPath, JSON.stringify({ event: 'delivery_recovered', bootId, phase, status: result.status }) + '\n', { mode: 0o600 });
            return result;
        };
    });
    nitro.hooks.hook('close', async () => {
        // An asynchronous persistence cleanup must complete before final exit.
        await new Promise(resolve => setTimeout(resolve, 50));
        await resource.writeFile(JSON.stringify({ bootId, pid: process.pid, closedAt: new Date().toISOString() }) + '\n');
        await resource.sync();
        await resource.close();
    });
});
