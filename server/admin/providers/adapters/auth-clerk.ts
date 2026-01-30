import type { H3Event } from 'h3';
import type { ProviderAdminAdapter, ProviderAdminStatusResult, ProviderStatusContext } from '../types';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { useRuntimeConfig } from '#imports';

export const clerkAdminAdapter: ProviderAdminAdapter = {
    id: CLERK_PROVIDER_ID,
    kind: 'auth',
    async getStatus(_event: H3Event, ctx: ProviderStatusContext): Promise<ProviderAdminStatusResult> {
        const config = useRuntimeConfig();
        const warnings: ProviderAdminStatusResult['warnings'] = [];

        if (ctx.enabled) {
            const publishable = config.public.clerkPublishableKey;
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
                publishableConfigured: Boolean(config.public.clerkPublishableKey),
                secretConfigured: Boolean(config.clerkSecretKey),
            },
            warnings,
            actions: [],
        };
    },
};
