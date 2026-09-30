/**
 * Shared setup for sidebar component tests.
 */

import { registerSidebarPage } from '../../app/composables/sidebar/registerSidebarPage';

export function setupSidebarTestEnvironment() {
    const g = globalThis as Record<string, unknown>;
    g.__or3SidebarPagesRegistry = new Map();

    (global as Record<string, unknown>).process = { client: true };

    registerSidebarPage({
        id: 'sidebar-home',
        label: 'Home',
        icon: 'pixelarticons:home',
        component: {
            name: 'HomePage',
            template:
                '<div data-testid="sidebar-home-page">Home Page Content</div>',
        },
    });
}
