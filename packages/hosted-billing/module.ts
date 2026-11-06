import { addComponent, addPlugin, addServerHandler, addServerPlugin, createResolver, defineNuxtModule, extendPages } from '@nuxt/kit';

/** Operator-installed source module. Never a workspace-disableable marketplace plugin. */
export default defineNuxtModule({
    meta: { name: '@or3/hosted-billing' },
    setup(_options, nuxt) {
        const config = nuxt.options.runtimeConfig;
        if (config.public.ssrAuthEnabled !== true || config.public.sync.provider !== 'sqlite') {
            throw new Error('Hosted billing requires SSR authentication and the SQLite sync provider.');
        }
        if (config.public.guestAccessEnabled === true) {
            throw new Error('Disable guest access before enabling hosted billing.');
        }
        const resolver = createResolver(import.meta.url);
        // Private values are resolved on server startup, never embedded in public config.
        config.public.hostedBillingEnabled = true;
        config.public.cloudAccessPolicyEnabled = true;
        config.openrouterRequireUserKey = true;
        config.openrouterAllowUserOverride = true;
        config.public.openRouter.requireUserKey = true;
        config.public.openRouter.allowUserOverride = true;
        config.public.openRouter.hasInstanceKey = false;
        config.public.openai.hasInstanceKey = false;
        addServerPlugin(resolver.resolve('runtime/server/plugin'));
        for (const [name, method] of [['status', 'get'], ['checkout', 'post'], ['portal', 'post'], ['refresh', 'post'], ['webhook', 'post']] as const) {
            addServerHandler({ route: `/api/billing/${name}`, method, handler: resolver.resolve(`runtime/server/routes/${name}`) });
        }
        addServerHandler({ middleware: true, handler: resolver.resolve('runtime/server/middleware') });
        addServerHandler({ route: '/api/admin/hosted-billing', handler: resolver.resolve('runtime/server/routes/admin') });
        addServerHandler({ route: '/api/admin/hosted-billing/offers', handler: resolver.resolve('runtime/server/routes/admin-offers') });
        addServerHandler({ route: '/api/admin/hosted-billing/health', handler: resolver.resolve('runtime/server/routes/admin-health') });
        addServerHandler({ route: '/api/admin/hosted-billing/activity', method: 'get', handler: resolver.resolve('runtime/server/routes/admin-activity') });
        addServerHandler({ route: '/api/admin/hosted-billing/storage', method: 'get', handler: resolver.resolve('runtime/server/routes/admin-storage') });
        addServerHandler({ route: '/api/admin/hosted-billing/accounts/:id/storage', method: 'get', handler: resolver.resolve('runtime/server/routes/admin-storage') });
        addServerHandler({ route: '/api/admin/hosted-billing/quota-impact', method: 'get', handler: resolver.resolve('runtime/server/routes/admin-quota-impact') });
        addServerHandler({ route: '/api/admin/hosted-billing/accounts', method: 'get', handler: resolver.resolve('runtime/server/routes/admin-accounts') });
        addServerHandler({ route: '/api/admin/hosted-billing/accounts/:id', method: 'get', handler: resolver.resolve('runtime/server/routes/admin-account') });
        addServerHandler({ route: '/api/admin/hosted-billing/accounts/:id/:command', method: 'post', handler: resolver.resolve('runtime/server/routes/admin-account-command') });
        addPlugin({ src: resolver.resolve('runtime/admin.client'), mode: 'client' });
        addComponent({ name: 'HostedBillingBanner', filePath: resolver.resolve('runtime/components/HostedBillingBanner.vue'), global: true });
        extendPages(pages => { pages.push({ name: 'hosted-billing', path: '/billing', file: resolver.resolve('runtime/pages/billing.vue') }); });
    },
});
