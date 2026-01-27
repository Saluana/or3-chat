/**
 * Session context resolution.
 * Resolves ProviderSession to internal SessionContext.
 */
import type { H3Event } from 'h3';
import type { SessionContext } from '~/core/hooks/hook-types';
import type { ProviderSession } from './types';
import { getAuthProvider } from './registry';
import { isSsrAuthEnabled } from '../utils/auth/is-ssr-auth-enabled';
import { getConvexClient, api } from '../utils/convex-client';
import { recordSessionResolution, recordProviderError } from './metrics';

const SESSION_CONTEXT_KEY_PREFIX = '__or3_session_context_';

/**
 * Resolve the session context for an H3 event.
 * Results are cached per-request to avoid multiple provider calls.
 *
 * @param event - H3 event
 * @returns SessionContext with authenticated state
 */
export async function resolveSessionContext(
    event: H3Event
): Promise<SessionContext> {
    // Get provider from config for cache key
    const config = useRuntimeConfig();
    const providerId = config.auth.provider || 'clerk';
    const cacheKey = `${SESSION_CONTEXT_KEY_PREFIX}${providerId}`;

    // Check cache first
    if (event.context[cacheKey]) {
        return event.context[cacheKey] as SessionContext;
    }

    // If SSR auth disabled, return unauthenticated
    if (!isSsrAuthEnabled(event)) {
        const nullSession: SessionContext = { authenticated: false };
        event.context[cacheKey] = nullSession;
        return nullSession;
    }

    // Get provider from config
    const provider = getAuthProvider(providerId);

    if (!provider) {
        const nullSession: SessionContext = { authenticated: false };
        event.context[cacheKey] = nullSession;
        return nullSession;
    }

    // Resolve provider session
    let providerSession: ProviderSession | null = null;
    try {
        providerSession = await provider.getSession(event);
    } catch (error) {
        recordProviderError();
        recordSessionResolution(false);
        const nullSession: SessionContext = { authenticated: false };
        event.context[cacheKey] = nullSession;
        return nullSession;
    }

    if (!providerSession) {
        recordSessionResolution(true);
        const nullSession: SessionContext = { authenticated: false };
        event.context[cacheKey] = nullSession;
        return nullSession;
    }

    // Map provider session to internal user/workspace via Convex
    try {
        const convex = getConvexClient();
        const resolved = await convex.query(api.workspaces.resolveSession, {
            provider: providerSession.provider,
            provider_user_id: providerSession.user.id,
        });

        const workspaceInfo =
            resolved ??
            (await convex.mutation(api.workspaces.ensure, {
                provider: providerSession.provider,
                provider_user_id: providerSession.user.id,
                email: providerSession.user.email,
                name: providerSession.user.displayName,
            }));

        const sessionContext: SessionContext = {
            authenticated: true,
            provider: providerSession.provider,
            providerUserId: providerSession.user.id,
            user: {
                id: providerSession.user.id,
                email: providerSession.user.email,
                displayName: providerSession.user.displayName,
            },
            workspace: {
                id: workspaceInfo.id,
                name: workspaceInfo.name,
            },
            role: workspaceInfo.role,
            expiresAt: providerSession.expiresAt.toISOString(),
        };

        recordSessionResolution(true);
        // Cache result
        event.context[cacheKey] = sessionContext;
        return sessionContext;
    } catch (error) {
        recordSessionResolution(false);
        throw error;
    }
}
