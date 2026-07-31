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
    const or3Config = useOr3Config();
    const documentsEnabled = or3Config.features.documents.enabled;

    // Register the home page
    const unregisterHome = registerSidebarPage({
        id: 'sidebar-home',
        label: 'Home',
        icon: icon.value,
        order: 0,
        keepAlive: true,
        usesDefaultHeader: true,
        component: () => import('~/components/sidebar/SidebarHomePage.vue'),
    });

    // Register Chats-only page
    const unregisterChats = registerSidebarPage({
        id: 'sidebar-chats',
        label: 'Chats',
        icon: useIcon('sidebar.page.messages').value,
        order: 10,
        keepAlive: true,
        usesDefaultHeader: true,
        component: () => import('~/components/sidebar/SidebarChatsPage.vue'),
    });

    // Register Docs-only page
    const unregisterDocs = documentsEnabled
        ? registerSidebarPage({
              id: 'sidebar-docs',
              label: 'Docs',
              icon: useIcon('sidebar.note').value,
              order: 20,
              keepAlive: true,
              usesDefaultHeader: true,
              component: () =>
                  import('~/components/sidebar/SidebarDocsPage.vue'),
          })
        : () => {};

    // Handle HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unregisterHome();
            unregisterChats();
            unregisterDocs();
        });
    }
});
