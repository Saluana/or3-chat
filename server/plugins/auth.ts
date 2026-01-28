/**
 * Server plugin to register the default auth provider.
 * Only runs when SSR auth is enabled.
 */
import { registerAuthProvider } from '../auth/registry';
import { clerkAuthProvider } from '../auth/providers/clerk';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

export default defineNitroPlugin(() => {
    const config = useRuntimeConfig();

    // Only register provider when SSR auth is enabled
    if (config.auth.enabled !== true) {
        return;
    }

    // Register Clerk as the default provider
    registerAuthProvider({
        id: CLERK_PROVIDER_ID,
        order: 100,
        create: () => clerkAuthProvider,
    });
});
