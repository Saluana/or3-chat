import { defineNuxtModule, addServerHandler, addServerPlugin } from '@nuxt/kit';
import { resolve } from 'pathe';

export default defineNuxtModule({
    meta: { name: 'or3-provider-localfs' },
    setup() {
        const runtimeDir = resolve(__dirname, '../runtime');
        addServerPlugin(resolve(runtimeDir, 'server/plugins/register'));
        addServerHandler({
            route: '/api/storage/localfs/upload',
            handler: resolve(runtimeDir, 'server/api/storage/localfs/upload'),
        });
        addServerHandler({
            route: '/api/storage/localfs/download',
            handler: resolve(runtimeDir, 'server/api/storage/localfs/download'),
        });
    },
});
