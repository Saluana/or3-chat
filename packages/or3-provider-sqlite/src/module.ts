import { defineNuxtModule, addServerPlugin } from '@nuxt/kit';
import { resolve } from 'pathe';

export default defineNuxtModule({
    meta: { name: 'or3-provider-sqlite' },
    setup() {
        const runtimeDir = resolve(__dirname, '../runtime');
        addServerPlugin(resolve(runtimeDir, 'server/plugins/register'));
    },
});
