import { defineNuxtModule, addPlugin, addServerPlugin, addModule } from '@nuxt/kit';
import { resolve } from 'pathe';

export default defineNuxtModule({
    meta: { name: 'or3-provider-convex' },
    async setup() {
        await addModule('convex-nuxt');

        const runtimeDir = resolve(__dirname, '../runtime');
        addPlugin(resolve(runtimeDir, 'plugins/convex-sync.client'));
        addPlugin(resolve(runtimeDir, 'plugins/convex-auth-bridge.client'));
        addServerPlugin(resolve(runtimeDir, 'server/plugins/register'));
    },
});
