import { defineNuxtPlugin, onNuxtReady } from '#app';
import { registerOwnedAdminPage } from '~/composables/admin/useAdminPlugins';
import { registerDashboardPlugin } from '~/composables/dashboard/useDashboardPlugins';

export default defineNuxtPlugin(app => {
    let unregister: (() => void) | undefined;
    let dashboard: ReturnType<typeof registerDashboardPlugin> | undefined;
    let disposed = false;
    // Admin extension discovery is client-only; register after hydration to avoid
    // rendering a different admin page on the server and the initial client pass.
    onNuxtReady(() => {
        if (disposed) return;
        dashboard = registerDashboardPlugin({
            id: 'hosted-billing', label: 'Billing', icon: 'i-lucide-credit-card', order: 190,
            description: 'Your plan, storage allowance, and subscription.',
            access: { authRequired: true },
            pages: [{ id: 'plan', title: 'Billing', component: () => import('./components/DashboardBilling.vue') }],
        });
        unregister = registerOwnedAdminPage({
            id: 'hosted-billing', label: 'Hosted billing', path: 'hosted-billing', order: 200,
            component: () => import('./components/AdminBilling.vue'),
        });
    });
    const cleanup = () => { disposed = true; unregister?.(); dashboard?.dispose(); };
    app.vueApp.onUnmount(cleanup);
    if (import.meta.hot) import.meta.hot.dispose(cleanup);
});
