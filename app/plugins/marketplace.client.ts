/**
 * Dashboard > Marketplace registration.
 *
 * The marketplace is a dashboard app like the workspace manager: one registered
 * entry with Discover, Installed, Updates and contextual Configure pages that
 * reuse the existing navigation, theme and components. No iframe and no
 * central-site embedding: it reads the local server's own marketplace endpoints.
 */
import { h, type Component } from 'vue';
import { registerDashboardPlugin } from '~/composables/dashboard/useDashboardPlugins';
import { useMarketplaceSetupPlugin } from '~/composables/marketplace/useMarketplaceSetup';

/**
 * `import.meta.glob` keeps these paths out of TypeScript's module resolution
 * (the app tsconfig does not include the `.vue` shim) while still letting Vite
 * bundle each page lazily. A missing page is reported in place rather than
 * throwing during plugin registration, which would break the whole dashboard.
 */
const DISCOVER = import.meta.glob('../components/marketplace/MarketplaceDiscover.vue');
const INSTALLED = import.meta.glob('../components/marketplace/MarketplaceInstalled.vue');
const UPDATES = import.meta.glob('../components/marketplace/MarketplaceUpdates.vue');
const CONFIGURE = import.meta.glob('../components/marketplace/MarketplaceConfigure.vue');

function lazyPage(modules: Record<string, unknown>, label: string): Component {
    const loader = Object.values(modules)[0] as (() => Promise<unknown>) | undefined;
    if (!loader) {
        return {
            name: `MarketplacePageUnavailable:${label}`,
            render: () =>
                h('div', { class: 'p-4 text-sm' }, `${label} is unavailable in this build.`),
        };
    }
    return loader as never;
}

export default defineNuxtPlugin(() => {
    // Registered in every profile: a static/local instance must still be able to
    // browse and must say that installation is unsupported there, rather than
    // hiding the surface and leaving the user to guess.
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
                component: lazyPage(DISCOVER, 'Discover'),
            },
            {
                id: 'installed',
                title: 'Installed',
                icon: 'i-lucide-package',
                description: 'Open, configure, disable or remove installed plugins.',
                component: lazyPage(INSTALLED, 'Installed'),
            },
            {
                id: 'updates',
                title: 'Updates',
                icon: 'i-lucide-refresh-cw',
                description: 'Review and activate waiting updates.',
                component: lazyPage(UPDATES, 'Updates'),
            },
            {
                id: 'configure',
                title: 'Configure',
                icon: 'i-lucide-settings-2',
                description: 'Configure an installed plugin from the dashboard.',
                // Configure is contextual: the plugin id is supplied by an
                // Installed/Discover action, so it should not appear as an
                // empty tile on the Marketplace landing page.
                isAvailable: () => useMarketplaceSetupPlugin().value !== null,
                component: lazyPage(CONFIGURE, 'Configure'),
            },
        ],
    });
});
