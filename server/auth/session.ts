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
import { deleteCookie } from 'h3';
import { LRUCache } from 'lru-cache';
import type { SessionContext } from '~/core/hooks/hook-types';
import type { ProviderSession } from './types';
import { getAuthProvider } from './registry';
import { useRuntimeConfig } from '#imports';
import { isSsrAuthEnabled } from '../utils/auth/is-ssr-auth-enabled';
import { recordSessionResolution, recordProviderError } from './metrics';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import { getDeploymentAdminChecker } from './deployment-admin';
import {
    evaluateUnknownUserRegistration,
    resolveRegistrationMode,
} from './registration';
import { emitWebhookSystemHook } from '../utils/webhooks/runtime';
import { provisionWorkspaceDefaults } from '../workspaces/provisioning';

const SESSION_CONTEXT_KEY_PREFIX = '__or3_session_context_';
const REQUEST_ID_KEY = '__or3_request_id';
const DEFAULT_SHARED_SESSION_CACHE_TTL_MS = 60_000;
const MAX_SHARED_SESSION_CACHE_ENTRIES = 2_000;

let nextAuthorizationRevision = 1;
let globalAuthorizationRevision = 0;
const identityAuthorizationRevisions = new Map<string, number>();
const storeAuthorizationRevisions = new Map<string, number>();

type SharedSessionCacheEntry = {
    session: SessionContext;
    expiresAtMs: number;
};

const sharedSessionCache = new LRUCache<string, SharedSessionCacheEntry>({
    max: MAX_SHARED_SESSION_CACHE_ENTRIES,
});

function getSharedSessionCacheKey(
    providerId: string,
    providerUserId: string,
    storeId: string
): string {
    return `${providerId}:${providerUserId}:${storeId}`;
}

function getIdentityAuthorizationRevisionKey(
    providerId: string,
    providerUserId: string,
    storeId: string
): string {
    return `${providerId}:${providerUserId}:${storeId}`;
}

function getAuthorizationRevision(
    providerId: string,
    providerUserId: string,
    storeId: string
): number {
    return Math.max(
        globalAuthorizationRevision,
        storeAuthorizationRevisions.get(storeId) ?? 0,
        identityAuthorizationRevisions.get(
            getIdentityAuthorizationRevisionKey(providerId, providerUserId, storeId)
        ) ?? 0
    );
}

function advanceAuthorizationRevision(): number {
    const revision = nextAuthorizationRevision;
    nextAuthorizationRevision += 1;
    return revision;
}

function clearSharedSessionCacheEntry(
    providerId: string | undefined,
    providerUserId: string | undefined,
    storeId?: string
): void {
    if (!providerId || !providerUserId) {
        if (storeId) {
            const storeSuffix = `:${storeId}`;
            for (const key of sharedSessionCache.keys()) {
                if (key.endsWith(storeSuffix)) {
                    sharedSessionCache.delete(key);
                }
            }
            return;
        }

        sharedSessionCache.clear();
        return;
    }

    if (storeId) {
        sharedSessionCache.delete(
            getSharedSessionCacheKey(providerId, providerUserId, storeId)
        );
        return;
    }

    const prefix = `${providerId}:${providerUserId}:`;
    for (const key of sharedSessionCache.keys()) {
        if (key.startsWith(prefix)) {
            sharedSessionCache.delete(key);
        }
    }
}

function getConfiguredSessionCacheTtlMs(config: ReturnType<typeof useRuntimeConfig>): number {
    const candidate = Number(
        (config.auth as { sessionCacheTtlMs?: unknown } | undefined)
            ?.sessionCacheTtlMs
    );
    if (!Number.isFinite(candidate) || candidate <= 0) {
        return DEFAULT_SHARED_SESSION_CACHE_TTL_MS;
    }
    return Math.floor(candidate);
}

function getSessionCacheTtlMs(
    config: ReturnType<typeof useRuntimeConfig>,
    providerSession: ProviderSession
): number {
    const configured = getConfiguredSessionCacheTtlMs(config);
    const untilProviderExpiry = providerSession.expiresAt.getTime() - Date.now();
    if (!Number.isFinite(untilProviderExpiry) || untilProviderExpiry <= 0) {
        return 1;
    }
    return Math.max(1, Math.min(configured, Math.floor(untilProviderExpiry)));
}

type SessionProvisioningFailureMode =
    | 'throw'
    | 'unauthenticated'
    | 'service-unavailable';

function getSessionProvisioningFailureMode(
    config: ReturnType<typeof useRuntimeConfig>
): SessionProvisioningFailureMode {
    const candidate = (config.auth as { sessionProvisioningFailure?: unknown } | undefined)
        ?.sessionProvisioningFailure;
    if (
        candidate === 'throw' ||
        candidate === 'unauthenticated' ||
        candidate === 'service-unavailable'
    ) {
        return candidate;
    }
    return 'throw';
}

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

    const storeId =
        (config.sync as { provider?: string } | undefined)?.provider ||
        (config.public as {
            sync?: { provider?: string };
        }).sync?.provider ||
        'convex';
    const sharedCacheKey = getSharedSessionCacheKey(
        providerSession.provider,
        providerSession.user.id,
        storeId
    );
    const sharedCached = sharedSessionCache.get(sharedCacheKey);
    if (sharedCached) {
        if (sharedCached.expiresAtMs > Date.now()) {
            recordSessionResolution(true);
            event.context[cacheKey] = sharedCached.session;
            return sharedCached.session;
        }
        sharedSessionCache.delete(sharedCacheKey);
    }

    // Map provider session to internal user/workspace via the configured AuthWorkspaceStore
    try {
        // Get the configured workspace store based on sync provider
        const { getAuthWorkspaceStore } = await import('./store/registry');
        const store = getAuthWorkspaceStore(storeId);

        if (!store) {
            throw new Error(
                `[auth:session] AuthWorkspaceStore not registered for provider: ${storeId}`
            );
        }

        const registrationMode = resolveRegistrationMode(config);

        let userId: string;
        const existingUser = store.getUser
            ? await store.getUser({
                  provider: providerSession.provider,
                  providerUserId: providerSession.user.id,
              })
            : null;

        if (existingUser) {
            userId = existingUser.userId;
        } else {
            const registrationDecision = evaluateUnknownUserRegistration({
                event,
                store,
                mode: registrationMode,
                email: providerSession.user.email,
                bootstrapEmail: (config.auth as { bootstrapEmail?: string } | undefined)
                    ?.bootstrapEmail,
            });

            if (!registrationDecision.allowed) {
                if (registrationDecision.reason === 'invite_unsupported') {
                    throw createError({
                        statusCode: 503,
                        statusMessage:
                            'Invite-only registration is enabled but the selected auth store does not support invites.',
                    });
                }

                if (registrationDecision.reason === 'invite_secret_missing') {
                    throw createError({
                        statusCode: 503,
                        statusMessage:
                            'Invite-only registration is enabled but invite token secret is not configured.',
                    });
                }

                if (registrationDecision.reason === 'disabled') {
                    throw createError({
                        statusCode: 403,
                        statusMessage:
                            'Registration is currently disabled. Please contact an administrator.',
                    });
                }

                throw createError({
                    statusCode: 403,
                    statusMessage:
                        registrationDecision.reason === 'invite_required'
                            ? 'A valid invite is required to register.'
                            : 'Invite token is invalid or expired.',
                });
            }

            if (registrationDecision.invite) {
                if (typeof store.acceptInviteAndProvisionUser !== 'function') {
                    throw createError({
                        statusCode: 503,
                        statusMessage: 'Auth store missing atomic invite provisioning capability.',
                    });
                }

                const providerEmail =
                    providerSession.user.email?.trim().toLowerCase() ?? '';
                const inviteEmail =
                    registrationDecision.invite.payload.email.trim().toLowerCase();
                if (!providerEmail || providerEmail !== inviteEmail) {
                    throw createError({
                        statusCode: 403,
                        statusMessage: 'Invite token is invalid or expired.',
                    });
                }

                const provisioned = await store.acceptInviteAndProvisionUser({
                    provider: providerSession.provider,
                    providerUserId: providerSession.user.id,
                    email: providerEmail,
                    displayName: providerSession.user.displayName,
                    workspaceId: registrationDecision.invite.payload.workspaceId,
                    tokenHash: registrationDecision.invite.tokenHash,
                });
                if (!provisioned.ok) {
                    throw createError({
                        statusCode: 403,
                        statusMessage: 'Invite token is invalid or expired.',
                    });
                }
                userId = provisioned.userId;
                if (provisioned.createdUser) {
                    await emitWebhookSystemHook('auth.user:action:created', {
                        userId,
                        provider: providerSession.provider,
                        email: providerSession.user.email ?? null,
                    });
                }

                deleteCookie(event, 'or3_invite_token', {
                    path: '/',
                });
            } else {
                const created = await store.getOrCreateUser({
                    provider: providerSession.provider,
                    providerUserId: providerSession.user.id,
                    email: providerSession.user.email,
                    displayName: providerSession.user.displayName,
                });
                userId = created.userId;
                await emitWebhookSystemHook('auth.user:action:created', {
                    userId,
                    provider: providerSession.provider,
                    email: providerSession.user.email ?? null,
                });
            }
        }

        // Get or create default workspace
        const { workspaceId, workspaceName, created } =
            await store.getOrCreateDefaultWorkspace(userId);

        if (created) {
            try {
                await provisionWorkspaceDefaults(event, workspaceId);
            } catch (error) {
                console.warn('[auth:session] Failed to provision new workspace defaults', {
                    workspaceId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // Get workspace role
        const role = await store.getWorkspaceRole({ userId, workspaceId });

        if (!role) {
            throw new Error(
                `[auth:session] User ${userId} has no access to workspace ${workspaceId}`
            );
        }

        // Check if user has deployment admin access using the provider-agnostic checker
        const adminChecker = getDeploymentAdminChecker(event);
        const deploymentAdmin = await adminChecker.checkDeploymentAdmin(
            providerSession.user.id,
            providerSession.provider
        );

        const workspaceInfo = {
            id: workspaceId,
            name: workspaceName,
            role,
        };

        const sessionContext: SessionContext = {
            authenticated: true,
            provider: providerSession.provider,
            providerUserId: providerSession.user.id,
            user: {
                id: userId,
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
            authorizationRevision: getAuthorizationRevision(
                providerSession.provider,
                providerSession.user.id,
                storeId
            ),
        };

        recordSessionResolution(true);
        // Cache result
        event.context[cacheKey] = sessionContext;
        sharedSessionCache.set(sharedCacheKey, {
            session: sessionContext,
            expiresAtMs: Date.now() + getSessionCacheTtlMs(config, providerSession),
        });
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
        const provisioningFailure = getSessionProvisioningFailureMode(config);

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

/**
 * Internal API.
 *
 * Purpose:
 * Clear shared cross-request session cache. Intended for tests.
 */
export function _resetSharedSessionCache(): void {
    sharedSessionCache.clear();
    identityAuthorizationRevisions.clear();
    storeAuthorizationRevisions.clear();
    globalAuthorizationRevision = 0;
    nextAuthorizationRevision = 1;
}

/**
 * Internal API.
 *
 * Purpose:
 * Invalidates cross-request session cache for a specific authenticated identity.
 * Use this when workspace membership/selection mutates and the next request must
 * resolve fresh session context immediately.
 */
export function invalidateSharedSessionCacheForIdentity(input: {
    provider?: string;
    providerUserId?: string;
    storeId?: string;
}): void {
    clearSharedSessionCacheEntry(input.provider, input.providerUserId, input.storeId);

    const revision = advanceAuthorizationRevision();
    if (input.provider && input.providerUserId && input.storeId) {
        identityAuthorizationRevisions.set(
            getIdentityAuthorizationRevisionKey(
                input.provider,
                input.providerUserId,
                input.storeId
            ),
            revision
        );
        return;
    }

    if (input.storeId) {
        storeAuthorizationRevisions.set(input.storeId, revision);
        return;
    }

    globalAuthorizationRevision = revision;
}
