/**
 * @module app/composables/sidebar/registerSidebarPage
 *
 * Purpose:
 * Provides guard-railed helpers for registering sidebar pages, including optional
 * client-only registration and HMR cleanup.
 *
 * Responsibilities:
 * - Wraps the core sidebar page registry with opt-in safety checks
 * - Supports automatic cleanup during hot module replacement
 *
 * Non-responsibilities:
 * - Does not validate page definitions beyond the core registry
 * - Does not manage page activation or routing
 */
import type { Component } from 'vue';
import type { SidebarPageDef } from './useSidebarPages';
import type { Post } from '~/db';
import { useSidebarPages } from './useSidebarPages';

/**
 * `RegisterSidebarPageOptions`
 *
 * Purpose:
 * Configures guardrails for page registration.
 *
 * Behavior:
 * Controls client-only registration and whether HMR disposal should unregister.
 *
 * Constraints:
 * - Client-only registration is ignored on the server
 * - HMR cleanup only runs when HMR is available
 *
 * Non-Goals:
 * - Does not affect the page registry validation rules
 */
export interface RegisterSidebarPageOptions {
    /** Client-side guard - registration is ignored on server. Defaults to true. */
    clientOnly?: boolean;
    /** Auto-unregister on HMR dispose to prevent duplicate registrations. Defaults to true. */
    hmrCleanup?: boolean;
}

/**
 * `registerSidebarPage`
 *
 * Purpose:
 * Registers a sidebar page with optional client-only guards and HMR cleanup.
 *
 * Behavior:
 * Delegates to the core sidebar page registry and returns its unregister
 * callback. When HMR is enabled, the callback is invoked on dispose.
 *
 * Constraints:
 * - No-op on the server when `clientOnly` is true
 * - HMR cleanup only runs in dev HMR environments
 *
 * Non-Goals:
 * - Does not alter the registration schema or ordering rules
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
 * `RegisterSidebarPageWithPostsOptions`
 *
 * Purpose:
 * Adds post-list integration settings for sidebar page registration.
 *
 * Behavior:
 * Extends the base registration options with post type and selection callback.
 *
 * Constraints:
 * - `postType` is required to scope post selection
 *
 * Non-Goals:
 * - Does not alter how posts are queried or rendered
 */
export interface RegisterSidebarPageWithPostsOptions
    extends RegisterSidebarPageOptions {
    /** Post type to associate with this page for filtering and organization */
    postType: string;
    /** Optional handler called when a post is selected from the posts list */
    onPostSelect?: (post: Post) => void | Promise<void>;
}

/**
 * `registerSidebarPageWithPosts`
 *
 * Purpose:
 * Registers a sidebar page and exposes post-selection helpers to its context.
 *
 * Behavior:
 * Adds `postType` and a `selectPost` helper to the page context, then forwards the
 * registration to `registerSidebarPage`.
 *
 * Constraints:
 * - Requires a `postType` to determine which posts are relevant
 * - The original `provideContext` is still invoked if provided
 *
 * Non-Goals:
 * - Does not implement post list rendering or data fetching
 */
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

// Attach the withPosts method to the main function for fluent API
registerSidebarPage.withPosts = registerSidebarPageWithPosts;

/**
 * Default export.
 *
 * Purpose:
 * Offers a default export for the primary registration helper.
 *
 * Behavior:
 * Mirrors the named `registerSidebarPage` export.
 *
 * Constraints:
 * - None beyond the underlying function behavior
 *
 * Non-Goals:
 * - Does not provide additional runtime behavior
 */
export default registerSidebarPage;
