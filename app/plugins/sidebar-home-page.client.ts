/**
 * Sidebar Home Page Registration
 *
 * Registers the default sidebar page (sidebar-home) that contains
 * the existing SideNavContent body with projects, threads, and documents.
 */

export default defineNuxtPlugin(() => {
    if (!process.client) return;

    // Use the composable to get the register function
    const { registerSidebarPage } = useSidebarPages();
    const icon = useIcon('sidebar.page.messages');

    // Register the home page with the sidebar pages registry
    const unregister = registerSidebarPage({
        id: 'sidebar-home',
        label: 'Home',
        icon: icon.value,
        order: 0,
        keepAlive: true, // Keep home page alive for better UX
        usesDefaultHeader: true,
        component: () => import('~/components/sidebar/SidebarHomePage.vue'),
    });

    // Handle HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unregister();
        });
    }
});
