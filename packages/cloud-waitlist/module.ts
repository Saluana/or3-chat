import { addPlugin, addServerHandler, addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit';

/** Trusted, server-installed Cloud extension; never loaded by default. */
export default defineNuxtModule({
    meta: { name: 'or3-cloud-waitlist' },
    setup(_options, nuxt) {
        const config = nuxt.options.runtimeConfig.public;
        if (!config.ssrAuthEnabled) return;
        if (config.authProvider !== 'basic-auth') {
            throw new Error('[cloud-waitlist] This extension requires the Basic Auth provider.');
        }
        const lockPage = config.lockPage as { enabled: boolean; adapter: string } | undefined;
        if (!lockPage?.enabled || lockPage.adapter !== 'default') {
            throw new Error('[cloud-waitlist] Enable the lock page with its default adapter.');
        }
        lockPage.adapter = 'cloud-waitlist';
        const { resolve } = createResolver(import.meta.url);
        addPlugin(resolve('runtime/admin.plugin'));
        addPlugin({ src: resolve('runtime/plugin.client'), mode: 'client' }, { append: true });
        addServerPlugin(resolve('runtime/server/lifecycle'));
        for (const [route, method, file] of [
            ['/api/cloud/waitlist', 'get', 'public.get'],
            ['/api/cloud/waitlist', 'post', 'join.post'],
            ['/api/admin/cloud-waitlist', 'get', 'admin.get'],
            ['/api/admin/cloud-waitlist', 'patch', 'admin.patch'],
        ] as const) {
            addServerHandler({ route, method, handler: resolve(`runtime/server/${file}`) });
        }
    },
});
