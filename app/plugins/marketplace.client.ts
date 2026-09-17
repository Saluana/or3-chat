/**
 * Dashboard > Marketplace registration.
 *
 * The marketplace is a dashboard app like the workspace manager: one registered
 * entry with Discover, Installed and Updates pages that reuse the existing
 * navigation, theme and components. No iframe and no central-site embedding: it
 * reads the local server's own marketplace endpoints.
 */
import { defineAsyncComponent, type Component } from 'vue';
import { registerDashboardPlugin } from '~/composables/dashboard/useDashboardPlugins';

/**
 * `import.meta.glob` keeps these paths out of TypeScript's module resolution
 * (the app tsconfig does not include the `.vue` shim) while still letting Vite
 * bundle each page lazily.
 */
const MARKETPLACE_PAGES = import.meta.glob('../components/marketplace/*.vue', {
    import: 'default',
}) as Record<string, () => Promise<Component>>;

function lazyPage(path: string): Component {
    const loader = MARKETPLACE_PAGES[path];
    if (!loader) throw new Error(`Missing marketplace page component: ${path}`);
    return defineAsyncComponent(async () => await loader());
}

export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public?.ssrAuthEnabled) return;

    registerDashboardPlugin({
        id: 'marketplace',
        icon: 'i-lucide-store',
        label: 'Marketplace',
        description: 'Discover and manage plugins from the configured marketplace',
        order: 150,
        access: { authRequired: true },
        pages: [
            {
                id: 'discover',
                title: 'Discover',
                icon: 'i-lucide-search',
                description: 'Browse published plugins and check what an install needs.',
                component: lazyPage('../components/marketplace/MarketplaceDiscover.vue'),
            },
            {
                id: 'installed',
                title: 'Installed',
                icon: 'i-lucide-package',
                description: 'Open, configure, disable or remove installed plugins.',
                component: lazyPage('../components/marketplace/MarketplaceInstalled.vue'),
            },
            {
                id: 'updates',
                title: 'Updates',
                icon: 'i-lucide-refresh-cw',
                description: 'Review and activate waiting updates.',
                component: lazyPage('../components/marketplace/MarketplaceUpdates.vue'),
            },
        ],
    });
});
