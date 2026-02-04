import { defineNuxtModule, addServerMiddleware, addServerPlugin, addModule } from '@nuxt/kit';
import { resolve } from 'pathe';

export default defineNuxtModule({
    meta: { name: 'or3-provider-clerk' },
    async setup() {
        await addModule('@clerk/nuxt');

        const runtimeDir = resolve(__dirname, '../runtime');
        addServerMiddleware({
            path: '/',
            handler: resolve(runtimeDir, 'server/middleware/00.clerk'),
        });
        addServerPlugin(resolve(runtimeDir, 'server/plugins/register'));
    },
});
