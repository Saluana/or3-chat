/**
 * Dashboard > Library registration.
 *
 * The Library is a dashboard app like the marketplace: one registered entry
 * whose page is loaded lazily. It reads the local server's own endpoints, so the
 * browser never talks to the marketplace and only the signed-in local user's own
 * binding is ever visible.
 */
import { h, type Component } from 'vue';
import { registerDashboardPlugin } from '~/composables/dashboard/useDashboardPlugins';

/**
 * `import.meta.glob` keeps the `.vue` path out of TypeScript's module
 * resolution while still letting Vite bundle the page lazily. A missing page is
 * reported in place rather than throwing during registration, which would break
 * the whole dashboard.
 */
const HOME = import.meta.glob('../components/library/LibraryHome.vue');

function lazyPage(modules: Record<string, unknown>, label: string): Component {
    const loader = Object.values(modules)[0] as (() => Promise<unknown>) | undefined;
    if (!loader) {
        return {
            name: `LibraryPageUnavailable:${label}`,
            render: () => h('div', { class: 'p-4 text-sm' }, `${label} is unavailable in this build.`),
        };
    }
    return loader as never;
}

export default defineNuxtPlugin(() => {
    registerDashboardPlugin({
        id: 'library',
        icon: 'i-lucide-library',
        label: 'Library',
        description: 'Your marketplace account link and acquired releases',
        order: 160,
        access: { authRequired: true },
        pages: [
            {
                id: 'home',
                title: 'Library',
                icon: 'i-lucide-book-open',
                description: 'Connect this server and manage your personal library link',
                component: lazyPage(HOME, 'Library'),
            },
        ],
    });
});
