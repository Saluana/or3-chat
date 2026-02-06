import { defineNuxtModule, installModule, addPlugin, addServerHandler, addServerPlugin } from '@nuxt/kit';
import { resolve } from 'pathe';

export default defineNuxtModule({
    meta: { name: 'or3-provider-clerk' },
    async setup() {
        await installModule('@clerk/nuxt');

        const runtimeDir = resolve(__dirname, 'runtime');
        addServerHandler({
            route: '',
            middleware: true,
            handler: resolve(runtimeDir, 'server/middleware/00.clerk'),
        });
        addServerPlugin(resolve(runtimeDir, 'server/plugins/register'));
        addPlugin(resolve(runtimeDir, 'plugins/auth-token-broker.client'), {
            append: true,
        });
        addPlugin(resolve(runtimeDir, 'plugins/session-logout-bridge.client'), {
            append: true,
        });
    },
});
