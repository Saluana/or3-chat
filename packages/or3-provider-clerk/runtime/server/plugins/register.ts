import { registerAuthProvider } from '~~/server/auth/registry';
import { registerProviderTokenBroker } from '~~/server/auth/token-broker/registry';
import { registerProviderAdminAdapter } from '~~/server/admin/providers/registry';
import { clerkAuthProvider } from '../auth/clerk-auth-provider';
import { clerkTokenBroker } from '../auth/clerk-token-broker';
import { clerkAdminAdapter } from '../admin/auth-clerk';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

export default defineNitroPlugin(() => {
    registerAuthProvider({ id: CLERK_PROVIDER_ID, order: 100, create: () => clerkAuthProvider });
    registerProviderTokenBroker(CLERK_PROVIDER_ID, () => clerkTokenBroker);
    registerProviderAdminAdapter(clerkAdminAdapter);
});
