import type { Component } from 'vue';
import type { SidebarPageDef } from './useSidebarPages';
import type { Post } from '~/db';
import { useSidebarPages } from './useSidebarPages';

/**
 * Enhanced registerSidebarPage helper with guardrails and HMR cleanup
 */
export interface RegisterSidebarPageOptions {
    /** Client-side guard - registration is ignored on server */
    clientOnly?: boolean;
    /** Auto-unregister on HMR dispose */
    hmrCleanup?: boolean;
}

/**
 * Register a sidebar page with enhanced guardrails
 */
export function registerSidebarPage(
    def: SidebarPageDef,
    options: RegisterSidebarPageOptions = {}
) {
    const { clientOnly = true, hmrCleanup = true } = options;

    // Client-side guard
    if (clientOnly && !process.client) {
        return () => {}; // Return no-op unregister function
    }

    // Get the register function from the composable
    const { registerSidebarPage: baseRegisterSidebarPage } = useSidebarPages();

    // Register the page
    const unregister = baseRegisterSidebarPage(def);

    // HMR cleanup
    if (hmrCleanup && import.meta.hot) {
        import.meta.hot.dispose(() => {
            unregister();
        });
    }

    return unregister;
}

/**
 * Shorthand helper for registering pages with posts list integration
 */
export interface RegisterSidebarPageWithPostsOptions
    extends RegisterSidebarPageOptions {
    /** Post type to associate with this page */
    postType: string;
    /** Optional handler for when posts are selected */
    onPostSelect?: (post: Post) => void | Promise<void>;
}

export function registerSidebarPageWithPosts(
    def: Omit<SidebarPageDef, 'component'> & {
        component: Component | (() => Promise<Component>);
    },
    options: RegisterSidebarPageWithPostsOptions
) {
    const { postType, onPostSelect, ...registerOptions } = options;

    return registerSidebarPage(
        {
            ...def,
            provideContext(ctx) {
                // Expose posts-related helpers
                ctx.expose({
                    postType,
                    async selectPost(post: Post) {
                        await onPostSelect?.(post);
                    },
                });

                // Call original provideContext if present
                def.provideContext?.(ctx);
            },
        },
        registerOptions
    );
}

// Attach the withPosts method to the main function
registerSidebarPage.withPosts = registerSidebarPageWithPosts;

/**
 * Default export for easier importing
 */
export default registerSidebarPage;
