import { createError, setResponseHeader, type H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireAdminApiContext } from './api';
import { enforceGenericAdminRateLimit } from './auth/rate-limit';
import { getAuthWorkspaceStore } from '../auth/store/registry';
import { supportsSignupInvites } from '../auth/registration';

export async function requireSignupInviteStore(event: H3Event, mutation = false) {
    const context = await requireAdminApiContext(event, { superAdminOnly: true, mutation });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    enforceGenericAdminRateLimit(event, mutation ? 'signup-invites-write' : 'signup-invites-read');
    const config = useRuntimeConfig(event);
    const store = getAuthWorkspaceStore(config.public.sync.provider);
    if (!store || !supportsSignupInvites(store)) {
        throw createError({ statusCode: 503, statusMessage: 'Selected auth store does not support atomic signup invitations.' });
    }
    return { store, context, config };
}
