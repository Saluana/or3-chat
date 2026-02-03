/**
 * @module server/auth/session.ts
 *
 * Purpose:
 * High-level session resolution for Nitro requests. This module orchestrates
 * the transition from raw request data (cookies/headers) to a fully hydrated
 * internal session context, including workspace and role resolution.
 *
 * Architecture:
 * - **Per-Request Caching**: Results are stored in `event.context` to ensure
 *   consistent session data throughout a single request's lifecycle and avoid
 *   redundant network calls to auth providers or databases.
 * - **Isolation**: Uses a generated `requestId` for cache isolation.
 * - **Provider-Agnostic**: Delegates to registered `AuthProvider` implementations.
 *
 * Flow:
 * 1. Check if SSR auth is enabled for the request.
 * 2. Attempt to resolve identity from the configured `AuthProvider` (e.g., Clerk).
 * 3. Resolve or provision the workspace/user mapping via the sync backend (Convex).
 * 4. Check for deployment-level administrative privileges.
 * 5. Return and cache the unified `SessionContext`.
 */
import type { H3Event } from 'h3';
import { createError } from 'h3';
import type { SessionContext } from '~/core/hooks/hook-types';
import type { ProviderSession } from './types';
import { getAuthProvider } from './registry';
import { useRuntimeConfig } from '#imports';
import { isSsrAuthEnabled } from '../utils/auth/is-ssr-auth-enabled';
import { recordSessionResolution, recordProviderError } from './metrics';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { getDeploymentAdminChecker } from './deployment-admin';

const SESSION_CONTEXT_KEY_PREFIX = '__or3_session_context_';
const REQUEST_ID_KEY = '__or3_request_id';

/**
 * Purpose:
 * Resolves the full session context for an H3 event.
 *
 * Behavior:
 * - Automatically caches the result in the event context.
 * - Handles workspace auto-provisioning via the sync backend.
 * - Falls back to unauthenticated state on failures unless configured otherwise.
 *
 * @param event - The Nitro request event.
 * @returns A promise resolving to the final `SessionContext`.
 *
 * @example
 * ```ts
 * export default defineEventHandler(async (event) => {
 *   const session = await resolveSessionContext(event);
 *   if (!session.authenticated) {
 *     throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
 *   }
 *   return { user: session.user };
 * });
 * ```
 */
export async function resolveSessionContext(
    event: H3Event
): Promise<SessionContext> {
    // Generate or retrieve request ID for cache isolation
    let requestId = event.context[REQUEST_ID_KEY] as string | undefined;
    if (!requestId) {
        requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        event.context[REQUEST_ID_KEY] = requestId;
    }

    // Get provider from config for cache key
    const config = useRuntimeConfig();
    const providerId = config.auth.provider || CLERK_PROVIDER_ID;
    const cacheKey = `${SESSION_CONTEXT_KEY_PREFIX}${requestId}_${providerId}`;

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
        // Log structured error for diagnostics
        console.error('[auth:session] Provider session fetch failed:', {
            provider: providerId,
            error: error instanceof Error ? error.message : String(error),
            stage: 'provider.getSession',
        });
        // Fail fast in dev for immediate feedback
        if (import.meta.dev) {
            throw error;
        }
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

    // Map provider session to internal user/workspace via the configured sync provider
    // TODO: Abstract this into a provider-agnostic SessionStore interface
    try {
        // For now, we use Convex directly as it's the only supported sync provider
        // When adding new providers, this should be abstracted similar to AuthProvider
        const { getConvexClient } = await import('../utils/convex-client');
        const { api } = await import('~~/convex/_generated/api');
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

        // Check if user has deployment admin access using the provider-agnostic checker
        const adminChecker = getDeploymentAdminChecker(event);
        const deploymentAdmin = await adminChecker.checkDeploymentAdmin(
            providerSession.user.id,
            providerSession.provider
        );

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
            deploymentAdmin,
        };

        recordSessionResolution(true);
        // Cache result
        event.context[cacheKey] = sessionContext;
        return sessionContext;
    } catch (error) {
        recordSessionResolution(false);
        // Log structured error for workspace provisioning failures
        console.error('[auth:session] Workspace provisioning failed:', {
            provider: providerSession.provider,
            userId: providerSession.user.id,
            error: error instanceof Error ? error.message : String(error),
            stage: 'workspace.provision',
        });
        const provisioningFailure =
            config.auth.sessionProvisioningFailure;

        if (provisioningFailure === 'unauthenticated') {
            console.error('[auth:session] Provisioning failure mode: unauthenticated', {
                provider: providerSession.provider,
                userId: providerSession.user.id,
            });
            const nullSession: SessionContext = { authenticated: false };
            event.context[cacheKey] = nullSession;
            return nullSession;
        }

        if (provisioningFailure === 'service-unavailable') {
            throw createError({
                statusCode: 503,
                statusMessage: 'Service Unavailable',
            });
        }

        throw error;
    }
}
