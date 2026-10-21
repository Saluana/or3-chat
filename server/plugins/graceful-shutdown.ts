import { defineNitroPlugin } from 'nitropack/runtime';
import { getShutdownRuntime } from '../utils/shutdown/runtime';

/** Nitro owns final process exit; OR3 owns work admission and persistence drain. */
export default defineNitroPlugin(nitro => {
    const { controller } = getShutdownRuntime();
    // Nitro can propagate request context into internal fetches. Admission
    // belongs to the event itself, never an inherited context boolean.
    const admitted = new WeakMap<object, string>();
    nitro.hooks.hook('request', event => {
        const path = event.path || event.node.req.url || '/';
        const method = event.method;
        if (!controller.beginRequest(path, method)) {
            event.node.res.statusCode = 503;
            event.node.res.setHeader('Content-Type', 'application/json');
            event.node.res.setHeader('Retry-After', '5');
            event.node.res.end(JSON.stringify({ statusCode: 503, data: { code: 'server_maintenance', retryAfterMs: 5000 } }));
            return;
        }
        if (controller.countsRequest(path, method)) admitted.set(event, path);
        if (method === 'GET' && /^\/api\/(?:jobs\/[^/?]+\/stream|sync\/events)(?:\?|$)/.test(path)) {
            const dispose = controller.observe(() => event.node.res.end());
            event.node.res.once('close', dispose);
        }
    });
    // H3 skips afterResponse when an error renderer has already handled the
    // response. Wrap the actual handler so both success and throw release the
    // admission, while a disconnected socket cannot release unfinished writes.
    const handle = nitro.h3App.handler;
    nitro.h3App.handler = async event => {
        try { return await handle(event); }
        finally {
            const path = admitted.get(event);
            if (path !== undefined) {
                admitted.delete(event);
                controller.endRequest(path);
            }
        }
    };
    const begin = () => { void controller.startShutdown('signal'); };
    process.on('SIGTERM', begin);
    process.on('SIGINT', begin);
    nitro.hooks.hook('close', async () => {
        process.off('SIGTERM', begin);
        process.off('SIGINT', begin);
        const result = await controller.startShutdown('nitro-close');
        if (!result.drained) console.warn('[shutdown] Work exceeded the bounded drain window');
    });
});
