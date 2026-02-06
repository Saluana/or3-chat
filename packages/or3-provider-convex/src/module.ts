import { defineNuxtModule, installModule, addPlugin, addServerPlugin } from '@nuxt/kit';
import { resolve } from 'pathe';

export default defineNuxtModule({
    meta: { name: 'or3-provider-convex' },
    async setup() {
        await installModule('convex-nuxt');

        const runtimeDir = resolve(__dirname, 'runtime');
        // Append so convex-nuxt client context is initialized before provider plugins run.
        addPlugin(resolve(runtimeDir, 'plugins/convex-auth.client'), { append: true });
        addPlugin(resolve(runtimeDir, 'plugins/convex-sync.client'), { append: true });
        addPlugin(resolve(runtimeDir, 'plugins/convex-storage.client'), { append: true });
        addServerPlugin(resolve(runtimeDir, 'server/plugins/register'));
    },
});
