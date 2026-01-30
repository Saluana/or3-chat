import type { H3Event } from 'h3';
import type { ProviderAdminAdapter, ProviderAdminStatusResult, ProviderStatusContext } from '../types';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { useRuntimeConfig } from '#imports';

export const clerkAdminAdapter: ProviderAdminAdapter = {
    id: CLERK_PROVIDER_ID,
    kind: 'auth',
    async getStatus(_event: H3Event, ctx: ProviderStatusContext): Promise<ProviderAdminStatusResult> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        const config = (useRuntimeConfig() || {}) as any;
        const warnings: ProviderAdminStatusResult['warnings'] = [];

        if (ctx.enabled) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            const publishable = config.public?.clerkPublishableKey;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            const secret = config.clerkSecretKey;
            if (!publishable) {
                warnings.push({
                    level: 'error',
                    message: 'Clerk publishable key is missing.',
                });
            }
            if (!secret) {
                warnings.push({
                    level: 'error',
                    message: 'Clerk secret key is missing.',
                });
            }
        }

        return {
            details: {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                publishableConfigured: Boolean(config.public?.clerkPublishableKey),
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                secretConfigured: Boolean(config.clerkSecretKey),
            },
            warnings,
            actions: [],
        };
    },
};
