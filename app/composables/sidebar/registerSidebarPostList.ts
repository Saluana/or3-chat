import { defineComponent, h, computed } from 'vue';
import { registerSidebarSection } from './useSidebarSections';
import type { SidebarSectionPlacement } from './useSidebarSections';
import { usePostsList } from '../posts/usePostsList';
import type { PostData } from '../posts/usePostsList';

export interface RegisterSidebarPostListOptions {
    /** Unique identifier for this sidebar section */
    id: string;
    /** Display label for the section header */
    label: string;
    /** App ID to pass to newPaneForApp when items are clicked */
    appId: string;
    /** Post type to filter by */
    postType: string;
    /** Icon name for the section header (optional) */
    icon?: string;
    /** Placement in sidebar (default: 'main') */
    placement?: SidebarSectionPlacement;
    /** Sort order (default: 200) */
    order?: number;
    /** Maximum number of items to show (optional) */
    limit?: number;
    /** Empty state message (default: 'No items') */
    emptyMessage?: string;
    /** Custom renderer for list items (optional) */
    renderItem?: (post: PostData) => {
        title: string;
        subtitle?: string;
        icon?: string;
    };
    /** Whether to reuse existing pane if same record already open (default: true) */
    reusePane?: boolean;
}

/**
 * Register a sidebar section that displays a live-updating list of posts.
 * Clicking an item opens a pane via newPaneForApp or reuses existing pane.
 */
export function registerSidebarPostList(
    options: RegisterSidebarPostListOptions
) {
    if (!process.client) {
        console.warn(
            '[registerSidebarPostList] Client-only helper called during SSR'
        );
        return;
    }

    const {
        id,
        label,
        appId,
        postType,
        icon = 'pixelarticons:list',
        placement = 'main',
        order = 200,
        limit,
        emptyMessage = 'No items',
        renderItem,
        reusePane = true,
    } = options;

    // Create an inline Vue component that wraps usePostsList
    const PostListComponent = defineComponent({
        name: `PostList_${id}`,
        setup() {
            const { items, loading, error } = usePostsList(postType, { limit });

            const handleItemClick = async (post: PostData) => {
                const multiPaneApi = (globalThis as any).__or3MultiPaneApi;
                if (!multiPaneApi?.newPaneForApp) {
                    console.error(
                        '[registerSidebarPostList] Multi-pane API not available'
                    );
                    return;
                }

                try {
                    // Check if we should reuse existing pane
                    if (reusePane && multiPaneApi.panes?.value) {
                        const existingPane = multiPaneApi.panes.value.find(
                            (p: any) =>
                                p.mode === appId && p.documentId === post.id
                        );
                        if (existingPane) {
                            const idx =
                                multiPaneApi.panes.value.indexOf(existingPane);
                            if (idx >= 0) {
                                if (
                                    typeof multiPaneApi.setActive === 'function'
                                ) {
                                    multiPaneApi.setActive(idx);
                                } else if (multiPaneApi.activePaneIndex) {
                                    multiPaneApi.activePaneIndex.value = idx;
                                }
                                return;
                            }
                        }
                    }

                    // Create new pane or activate existing
                    await multiPaneApi.newPaneForApp(appId, {
                        initialRecordId: post.id,
                    });
                } catch (err) {
                    console.error(
                        '[registerSidebarPostList] Failed to open pane:',
                        err
                    );
                }
            };

            const formattedItems = computed(() => {
                return items.value.map((post) => {
                    if (renderItem) {
                        return { post, ...renderItem(post) };
                    }
                    return {
                        post,
                        title: post.title,
                        subtitle: undefined,
                        icon: undefined,
                    };
                });
            });

            return {
                items: formattedItems,
                loading,
                error,
                handleItemClick,
            };
        },
        render() {
            // Import UI components dynamically to avoid circular deps
            const UIcon = resolveComponent('UIcon');
            const RetroGlassBtn = resolveComponent('RetroGlassBtn');

            return h('div', { class: 'flex flex-col gap-2' }, [
                // Section header
                h(
                    'div',
                    {
                        class: 'flex items-center gap-2 px-3 py-2 text-sm font-medium opacity-70',
                    },
                    [
                        h(UIcon, { name: icon, class: 'w-4 h-4' }),
                        h('span', label),
                    ]
                ),
                // Loading state
                this.loading
                    ? h(
                          'div',
                          { class: 'px-3 py-2 text-sm opacity-50' },
                          'Loading...'
                      )
                    : null,
                // Error state
                this.error
                    ? h(
                          'div',
                          { class: 'px-3 py-2 text-sm text-red-500' },
                          `Error: ${this.error.message}`
                      )
                    : null,
                // Empty state
                !this.loading && !this.error && this.items.length === 0
                    ? h(
                          'div',
                          { class: 'px-3 py-2 text-sm opacity-50' },
                          emptyMessage
                      )
                    : null,
                // Items list
                !this.loading && !this.error && this.items.length > 0
                    ? h(
                          'div',
                          { class: 'flex flex-col gap-1' },
                          this.items.map((item: any) =>
                              h(
                                  RetroGlassBtn,
                                  {
                                      key: item.post.id,
                                      class: 'w-full text-left px-3 py-2',
                                      onClick: () =>
                                          this.handleItemClick(item.post),
                                  },
                                  () => [
                                      h(
                                          'div',
                                          { class: 'flex items-start gap-2' },
                                          [
                                              item.icon
                                                  ? h(UIcon, {
                                                        name: item.icon,
                                                        class: 'w-4 h-4 shrink-0 mt-0.5',
                                                    })
                                                  : null,
                                              h(
                                                  'div',
                                                  { class: 'flex-1 min-w-0' },
                                                  [
                                                      h(
                                                          'div',
                                                          {
                                                              class: 'truncate text-[15px]',
                                                              title: item.title,
                                                          },
                                                          item.title
                                                      ),
                                                      item.subtitle
                                                          ? h(
                                                                'div',
                                                                {
                                                                    class: 'truncate text-xs opacity-60 mt-0.5',
                                                                },
                                                                item.subtitle
                                                            )
                                                          : null,
                                                  ]
                                              ),
                                          ]
                                      ),
                                  ]
                              )
                          )
                      )
                    : null,
            ]);
        },
    });

    // Register the component with the sidebar
    registerSidebarSection({
        id,
        component: PostListComponent,
        placement,
        order,
    });
}
