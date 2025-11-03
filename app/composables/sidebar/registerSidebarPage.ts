/**
 * Utility functions for registering sidebar pages with enhanced guardrails and HMR cleanup.
 * Provides a safer and more convenient way to register pages with automatic cleanup.
 */
import type { Component } from 'vue';
import type { SidebarPageDef } from './useSidebarPages';
import type { Post } from '~/db';
import { useSidebarPages } from './useSidebarPages';

/**
 * Configuration options for enhanced sidebar page registration.
 * Provides guardrails for client-side execution and HMR cleanup.
 */
export interface RegisterSidebarPageOptions {
    /** Client-side guard - registration is ignored on server. Defaults to true. */
    clientOnly?: boolean;
    /** Auto-unregister on HMR dispose to prevent duplicate registrations. Defaults to true. */
    hmrCleanup?: boolean;
}

/**
 * Register a sidebar page with enhanced guardrails and automatic cleanup.
 * Wraps the base registration function with client-side guards and HMR disposal handling.
 * 
 * @param def - The sidebar page definition to register
 * @param options - Configuration options for registration behavior
 * @returns Unregister function for manual cleanup
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
 * Configuration options for registering sidebar pages with posts list integration.
 * Extends the base options with post-specific configuration.
 */
export interface RegisterSidebarPageWithPostsOptions
    extends RegisterSidebarPageOptions {
    /** Post type to associate with this page for filtering and organization */
    postType: string;
    /** Optional handler called when a post is selected from the posts list */
    onPostSelect?: (post: Post) => void | Promise<void>;
}

/**
 * Register a sidebar page with automatic posts list integration.
 * Enhances the page definition with posts-related context and helpers.
 * Automatically exposes postType and selectPost helper to the page component.
 * 
 * @param def - The sidebar page definition (component can be Component or async loader)
 * @param options - Options including postType and optional post selection handler
 * @returns Unregister function for manual cleanup
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
 * Default export for easier importing.
 * Allows both default and named imports: `import registerSidebarPage from './registerSidebarPage'`
 * or `import { registerSidebarPage } from './registerSidebarPage'`
 */
export default registerSidebarPage;
