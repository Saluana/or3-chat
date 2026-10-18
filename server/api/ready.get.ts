import { defineEventHandler, setResponseHeader, setResponseStatus } from 'h3';
import { useRuntimeConfig } from '#imports';
import health from './health.get';
import { getShutdownRuntime } from '../utils/shutdown/runtime';
import { callRestartController, hasRestartController } from '../admin/system/server-control';
import { resolveRegistrationMode } from '../auth/registration';

export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const { controller, bootId } = getShutdownRuntime();
    if (controller.isShuttingDown() || (await health(event)).status !== 'ok') {
        setResponseStatus(event, 503); return { status: 'unavailable' };
    }
    if (hasRestartController()) {
        const config = useRuntimeConfig(event);
        await callRestartController('boot', { bootId, ready: true, settings: {
            registrationMode: resolveRegistrationMode(config), allowRestart: Boolean(config.admin.allowRestart),
        } }).catch(() => {});
    }
    return { status: 'ready' };
});
