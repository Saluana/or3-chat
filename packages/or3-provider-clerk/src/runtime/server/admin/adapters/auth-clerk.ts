/**
 * @module server/admin/providers/adapters/auth-clerk.ts
 *
 * Purpose:
 * Admin adapter for the Clerk auth provider. Validates the required server-side
 * environment configuration for Clerk integration.
 *
 * Responsibilities:
 * - Verify the presence of Publishable and Secret keys.
 * - Report configuration errors as alerts in the dashboard.
 */
import type { H3Event } from 'h3';
import type {
    ProviderAdminAdapter,
    ProviderAdminStatusResult,
    ProviderStatusContext,
} from '~~/server/admin/providers/types';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { useRuntimeConfig } from '#imports';

/**
 * Singleton implementation of the Clerk admin adapter.
 */
export const clerkAdminAdapter: ProviderAdminAdapter = {
    id: CLERK_PROVIDER_ID,
    kind: 'auth',

    /**
     * Purpose:
     * Checks if Clerk keys are present in the runtime config when Clerk is enabled.
     */
    async getStatus(_event: H3Event, ctx: ProviderStatusContext): Promise<ProviderAdminStatusResult> {
        const config = useRuntimeConfig();
        const warnings: ProviderAdminStatusResult['warnings'] = [];

        if (ctx.enabled) {
            const publishable = config.public.clerkPublishableKey;
            const secret = config.clerkSecretKey;
            if (!publishable) {
                warnings.push({
                    level: 'error',
                    message: 'Clerk publishable key is missing. Users will not be able to log in.',
                });
            }
            if (!secret) {
                warnings.push({
                    level: 'error',
                    message: 'Clerk secret key is missing. SSR token validation will fail.',
                });
            }
        }

        return {
            details: {
                publishableConfigured: Boolean(config.public.clerkPublishableKey),
                secretConfigured: Boolean(config.clerkSecretKey),
            },
            warnings,
            actions: [],
        };
    },
};
