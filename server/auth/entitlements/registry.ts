import type { H3Event } from 'h3';
import type { SessionContext } from '~/core/hooks/hook-types';
import { useRuntimeConfig } from '#imports';

export interface EntitlementResolverInput {
    event: H3Event;
    session: SessionContext;
    workspaceId: string;
}

export type EntitlementResolver = (
    input: EntitlementResolverInput
) => Promise<string[]>;

const resolverRegistry = new Map<string, EntitlementResolver>();

const DEFAULT_RESOLVER_ID = 'default';
const DEFAULT_RESOLVER: EntitlementResolver = async () => [];

function getCacheKey(workspaceId: string, userId: string): string {
    return `__or3_entitlements_${workspaceId}_${userId}`;
}

function normalizeEntitlements(values: string[]): string[] {
    return Array.from(
        new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
    );
}

export function registerEntitlementResolver(
    id: string,
    resolver: EntitlementResolver
): void {
    if (import.meta.dev && resolverRegistry.has(id)) {
        console.warn(`[auth:entitlements] Replacing resolver: ${id}`);
    }
    resolverRegistry.set(id, resolver);
}

export function listEntitlementResolverIds(): string[] {
    return Array.from(resolverRegistry.keys());
}

export function getEntitlementResolver(id: string): EntitlementResolver | null {
    return resolverRegistry.get(id) ?? null;
}

function resolveActiveResolverId(event?: H3Event): string {
    const config = useRuntimeConfig(event);
    return config.public.sync.provider || config.sync.provider || DEFAULT_RESOLVER_ID;
}

export function getActiveEntitlementResolver(
    event?: H3Event
): EntitlementResolver {
    const activeId = resolveActiveResolverId(event);
    return resolverRegistry.get(activeId) ?? resolverRegistry.get(DEFAULT_RESOLVER_ID) ?? DEFAULT_RESOLVER;
}

export async function resolveEntitlements(
    event: H3Event,
    session: SessionContext
): Promise<string[]> {
    if (!session.authenticated || !session.user?.id || !session.workspace?.id) {
        return [];
    }

    const cacheKey = getCacheKey(session.workspace.id, session.user.id);
    if (event.context[cacheKey]) {
        return event.context[cacheKey] as string[];
    }

    const resolver = getActiveEntitlementResolver(event);
    const resolved = await resolver({
        event,
        session,
        workspaceId: session.workspace.id,
    });

    const normalized = normalizeEntitlements(resolved);
    event.context[cacheKey] = normalized;
    return normalized;
}

registerEntitlementResolver(DEFAULT_RESOLVER_ID, DEFAULT_RESOLVER);
