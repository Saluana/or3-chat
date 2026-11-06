import { createError, setResponseHeader, type H3Event } from 'h3';
import { requireAdminApiContext } from './api';
import { isAdminEnabled } from '../utils/admin/is-admin-enabled';

/** A section that can fail or be unsupported without hiding the rest of a page. */
export type Inspection<T> =
    | { status: 'available'; value: T; observedAt: number }
    | { status: 'unavailable' | 'error'; code: string };

export async function inspect<T>(read: (() => Promise<T>) | null): Promise<Inspection<T>> {
    if (!read) return { status: 'unavailable', code: 'provider_capability_unavailable' };
    try { return { status: 'available', value: await read(), observedAt: Date.now() }; }
    catch { return { status: 'error', code: 'provider_read_failed' }; }
}

/**
 * Cross-account support access. Requires the separately authenticated super
 * admin cookie, so resolving the request never provisions a chat session or workspace.
 */
export async function requireSupportAdmin(event: H3Event, options: { mutation?: boolean } = {}): Promise<string> {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    if (!isAdminEnabled(event)) throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    const context = await requireAdminApiContext(event, { superAdminOnly: true, superAdminCookieOnly: true, mutation: options.mutation });
    if (context.principal.kind !== 'super_admin') throw createError({ statusCode: 403, statusMessage: 'Forbidden: Super admin access required' });
    return context.principal.username;
}

/** Canonical internal user IDs are opaque provider strings; bound them before any lookup. */
export function requireTargetId(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.:@-]{1,200}$/.test(value)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid account ID' });
    }
    return value;
}
