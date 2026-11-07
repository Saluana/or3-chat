import { defineNitroPlugin } from 'nitropack/runtime';
import { runAutomaticStorageCleanupBatch } from '../utils/storage/reclamation';

/** Opt-in, bounded maintenance. Canonical claims survive process restart; the
 * scan restarts at its beginning without reopening a deleted generation. */
export default defineNitroPlugin(nitro => {
    const workspaces = [...new Set((process.env.OR3_STORAGE_RETENTION_WORKSPACES ?? '').split(',').map(value => value.trim()).filter(Boolean))];
    if (!workspaces.length) return;
    if (workspaces.length > 100 || workspaces.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error('Invalid OR3_STORAGE_RETENTION_WORKSPACES (maximum 100 workspace IDs)');
    const cursors = new Map<string, string>();
    let index = 0;
    let stopped = false;
    let running: Promise<void> | undefined;
    const timer = setInterval(() => {
        if (running || stopped) return;
        const workspaceId = workspaces[index++ % workspaces.length]!;
        running = (async () => {
            try {
                const result = await runAutomaticStorageCleanupBatch(workspaceId, cursors.get(workspaceId));
                if (!result.pending) {
                    if (result.nextCursor) cursors.set(workspaceId, result.nextCursor);
                    else cursors.delete(workspaceId);
                }
            } catch (error) {
                console.warn('[storage-retention] Batch incomplete; canonical claims remain recoverable', { workspaceId, statusCode: (error as { statusCode?: number }).statusCode ?? 500 });
            } finally { running = undefined; }
        })();
    }, 3_600_000);
    timer.unref();
    nitro.hooks.hook('close', async () => { stopped = true; clearInterval(timer); await running; });
});
