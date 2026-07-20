/**
 * @module server/auth/token-broker/resolve.ts
 *
 * Purpose:
 * Resolve provider tokens via the configured ProviderTokenBroker.
 */
import type { H3Event } from 'h3';
import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { useRuntimeConfig } from '#imports';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import type { ProviderTokenRequest } from './types';
import { getProviderTokenBroker } from './registry';
import { resolveSessionContext } from '../session';

const DEFAULT_PROVIDER_TOKEN_CACHE_TTL_MS = 55_000;
const MAX_PROVIDER_TOKEN_CACHE_ENTRIES = 2_000;

type ProviderTokenCacheEntry = {
    token: string;
    expiresAtMs: number;
};

const providerTokenCache = new LRUCache<string, ProviderTokenCacheEntry>({
    max: MAX_PROVIDER_TOKEN_CACHE_ENTRIES,
});

function getConfiguredTokenCacheTtlMs(config: ReturnType<typeof useRuntimeConfig>): number {
    const candidate = Number(
        (config.auth as { tokenCacheTtlMs?: unknown } | undefined)
            ?.tokenCacheTtlMs
    );
    if (!Number.isFinite(candidate) || candidate <= 0) {
        return DEFAULT_PROVIDER_TOKEN_CACHE_TTL_MS;
    }
    return Math.floor(candidate);
}

function getCredentialDigest(event: H3Event): string | null {
    const headers = (event as unknown as { node?: { req?: { headers?: Record<string, string | string[] | undefined> } } }).node?.req?.headers;
    const cookieHeader = headers?.cookie;
    if (typeof cookieHeader === 'string' && cookieHeader.length > 0) {
        return createHash('sha256')
            .update('cookie\0')
            .update(cookieHeader)
            .digest('hex');
    }
    const authHeader = headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.length > 0) {
        return createHash('sha256')
            .update('authorization\0')
            .update(authHeader)
            .digest('hex');
    }
    return null;
}

function getTokenCacheKey(
    brokerId: string,
    request: ProviderTokenRequest,
    credentialDigest: string,
    subject: {
        provider: string;
        providerUserId: string;
        workspaceId: string;
        authorizationRevision: number;
    }
): string {
    return [
        'provider-token',
        `broker=${brokerId}`,
        `target=${request.providerId}`,
        `template=${request.template ?? ''}`,
        `subject=${subject.provider}:${subject.providerUserId}`,
        `workspace=${subject.workspaceId}`,
        `authorization-revision=${subject.authorizationRevision}`,
        `credential-sha256=${credentialDigest}`,
    ].join(':');
}

export async function resolveProviderToken(
    event: H3Event,
    request: ProviderTokenRequest
): Promise<string | null> {
    const config = useRuntimeConfig(event);
    const brokerId = config.auth.provider || CLERK_PROVIDER_ID;
    const broker = getProviderTokenBroker(brokerId);
    if (!broker) {
        return null;
    }

    const credentialDigest = getCredentialDigest(event);
    const session = credentialDigest ? await resolveSessionContext(event) : null;
    const subject = session?.authenticated &&
        session.provider &&
        session.providerUserId &&
        session.workspace
        ? {
              provider: session.provider,
              providerUserId: session.providerUserId,
              workspaceId: session.workspace.id,
              authorizationRevision: session.authorizationRevision ?? 0,
          }
        : null;
    if (credentialDigest && subject) {
        const cacheKey = getTokenCacheKey(
            brokerId,
            request,
            credentialDigest,
            subject
        );
        const cached = providerTokenCache.get(cacheKey);
        if (cached) {
            if (cached.expiresAtMs > Date.now()) {
                return cached.token;
            }
            providerTokenCache.delete(cacheKey);
        }
    }

    const token = await broker.getProviderToken(event, request);
    if (token && credentialDigest && subject) {
        providerTokenCache.set(getTokenCacheKey(
            brokerId,
            request,
            credentialDigest,
            subject
        ), {
            token,
            expiresAtMs: Date.now() + getConfiguredTokenCacheTtlMs(config),
        });
    }
    return token;
}

/**
 * Internal API.
 *
 * Purpose:
 * Clear shared provider token cache. Intended for tests.
 */
export function _resetProviderTokenCache(): void {
    providerTokenCache.clear();
}

/** Internal test-only inspection that never exposes cached token values. */
export function _getProviderTokenCacheKeysForTest(): string[] {
    return [...providerTokenCache.keys()];
}
