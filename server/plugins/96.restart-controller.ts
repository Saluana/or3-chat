import { defineNitroPlugin } from 'nitropack/runtime';
import { useRuntimeConfig } from '#imports';
import { registerRestartAdapter, readRestartStatus, callRestartController, hasRestartController } from '../admin/system/server-control';
import { getShutdownRuntime } from '../utils/shutdown/runtime';

export default defineNitroPlugin(nitro => {
    if (!useRuntimeConfig().auth.enabled) return;
    // Installed Nitro terminates dev workers without awaiting close in CI/test
    // execution mode. Do not advertise an unqualified development lifecycle.
    if (process.env.OR3_DEV_RESTART_SOCKET && (process.env.CI || process.env.TEST)) return;
    const dispose = process.env.OR3_DEV_RESTART_SOCKET
        ? registerRestartAdapter({ id: 'development', socketPath: process.env.OR3_DEV_RESTART_SOCKET, token: process.env.OR3_DEV_RESTART_TOKEN })
        : process.env.OR3_DASHBOARD_UPDATES_ENABLED === 'true' || process.env.OR3_DASHBOARD_OPERATOR_SOCKET
          ? registerRestartAdapter({ id: 'managed', socketPath: process.env.OR3_DASHBOARD_OPERATOR_SOCKET || '/run/or3-operator/operator.sock' })
          : undefined;
    if (!hasRestartController()) return;
    const { controller, bootId } = getShutdownRuntime();
    let running = false;
    const poll = setInterval(() => {
        if (running) return;
        running = true;
        void (async () => {
            const { operation } = await readRestartStatus();
            if (operation?.phase === 'cancelled' && operation.originalBootId === bootId) controller.cancel(operation.requestId);
            if (!operation || operation.phase !== 'preparing' || operation.originalBootId !== bootId) return;
            const { requestId } = operation;
            const record = () => {
                const { requests, work } = controller.workload();
                console.info(JSON.stringify({ event: 'server.restart.workload', requestId, bootId, phase: controller.phase(),
                    elapsedMs: Math.max(0, Date.now() - Date.parse(operation.createdAt)), requests, work }));
            };
            try {
                record();
                const prepared = await controller.prepare(requestId);
                record();
                if (!prepared.drained) { await callRestartController('cancel', { requestId }); return; }
                const drained = await controller.drainForRestart(requestId);
                record();
                if (!drained.drained) {
                    console.error('[restart] Final drain cancelled', { requestId, phase: controller.phase(), ...controller.workload() });
                    await callRestartController('cancel', { requestId, reasonCode: 'drain_timeout' }); controller.cancel(requestId); return;
                }
                await callRestartController('prepared', { requestId, originalBootId: bootId, targetRevision: operation.targetRevision });
            } catch {
                console.error('[restart] Preparation could not be acknowledged', { requestId, phase: controller.phase(), ...controller.workload() });
                // A dropped prepared acknowledgement may already have authorized stop.
                const observed = await readRestartStatus(requestId).catch(() => null);
                if (observed?.operation?.phase === 'preparing') {
                    await callRestartController('cancel', { requestId, reasonCode: 'preparation_failed' }); controller.cancel(requestId);
                } else if (observed?.operation?.phase === 'cancelled') controller.cancel(requestId);
            }
        })().catch(() => {}).finally(() => { running = false; });
    }, 1_000);
    poll.unref();
    nitro.hooks.hook('close', () => { clearInterval(poll); dispose?.(); });
});
