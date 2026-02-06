import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { registerAuthProvider } from '~~/server/auth/registry';
import { registerProviderTokenBroker } from '~~/server/auth/token-broker/registry';
import { registerProviderAdminAdapter } from '~~/server/admin/providers/registry';
import { clerkAuthProvider } from '../auth/clerk-auth-provider';
import { createClerkTokenBroker } from '../token-broker/clerk-token-broker';
import { clerkAdminAdapter } from '../admin/adapters/auth-clerk';
import { useRuntimeConfig } from '#imports';

export default defineNitroPlugin(() => {
    const config = useRuntimeConfig();
    if (!config.auth.enabled) return;

    registerAuthProvider({
        id: CLERK_PROVIDER_ID,
        order: 100,
        create: () => clerkAuthProvider,
    });

    registerProviderTokenBroker(CLERK_PROVIDER_ID, createClerkTokenBroker);
    registerProviderAdminAdapter(clerkAdminAdapter);
});
