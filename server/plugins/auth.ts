/**
 * Server plugin to register the default auth provider.
 * Only runs when SSR auth is enabled.
 */
import { registerAuthProvider } from '../auth/registry';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

export default defineNitroPlugin(async () => {
    const config = useRuntimeConfig();

    // Only register provider when SSR auth is enabled
    if (config.auth.enabled !== true) {
        return;
    }

    // Dynamic import to avoid loading Clerk when disabled
    const { clerkAuthProvider } = await import('../auth/providers/clerk');

    // Register Clerk as the default provider
    registerAuthProvider({
        id: CLERK_PROVIDER_ID,
        order: 100,
        create: () => clerkAuthProvider,
    });
});
