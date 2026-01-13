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

const SESSION_CONTEXT_KEY = '__or3_session_context';

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
    // Check cache first
    if (event.context[SESSION_CONTEXT_KEY]) {
        return event.context[SESSION_CONTEXT_KEY] as SessionContext;
    }

    // If SSR auth disabled, return unauthenticated
    if (!isSsrAuthEnabled(event)) {
        const nullSession: SessionContext = { authenticated: false };
        event.context[SESSION_CONTEXT_KEY] = nullSession;
        return nullSession;
    }

    // Get provider from config
    const config = useRuntimeConfig();
    const providerId = config.auth?.provider || 'clerk';
    const provider = getAuthProvider(providerId);

    if (!provider) {
        const nullSession: SessionContext = { authenticated: false };
        event.context[SESSION_CONTEXT_KEY] = nullSession;
        return nullSession;
    }

    // Resolve provider session
    let providerSession: ProviderSession | null = null;
    try {
        providerSession = await provider.getSession(event);
    } catch (error) {
        const nullSession: SessionContext = { authenticated: false };
        event.context[SESSION_CONTEXT_KEY] = nullSession;
        return nullSession;
    }

    if (!providerSession) {
        const nullSession: SessionContext = { authenticated: false };
        event.context[SESSION_CONTEXT_KEY] = nullSession;
        return nullSession;
    }

    // Map provider session to internal user/workspace via Convex
    const convex = getConvexClient();
    const workspaceInfo = await convex.mutation(api.workspaces.ensure, {
        provider: providerSession.provider,
        provider_user_id: providerSession.user.id,
        email: providerSession.user.email,
        name: providerSession.user.displayName,
    });

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
        expiresAt: providerSession.expiresAt.toISOString(),
    };

    // Cache result
    event.context[SESSION_CONTEXT_KEY] = sessionContext;
    return sessionContext;
}
