/**
 * Shared context for plugin connection and setup routes.
 *
 * Resolves the verified session, the active workspace, the connection service
 * for the running provider, and the provider catalogue. Every route re-derives
 * ownership from the session; nothing is trusted from the request body.
 *
 * Mutations additionally pass the same-origin mutation guard the rest of the
 * host uses, with a JSON requirement and an explicit intent header, so a
 * credentialed cross-origin (or same-site sibling) request cannot mutate state.
 */

import type { H3Event } from 'h3';
import { createError } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { requireSameOriginMutation } from '../../../utils/security/mutation-guard';
import { listConnectionProviders } from './providers/registry';
import { resolveConnectionService } from './resolve';
import type { PluginConnectionService } from './service';

/** Intent header/value the host UI must send with plugin mutations. */
export const PLUGIN_MUTATION_INTENT_HEADER = 'x-or3-plugin-intent';
export const PLUGIN_MUTATION_INTENT_VALUE = 'plugin';

export interface ConnectionApiContext {
    readonly userId: string;
    readonly workspaceId: string;
    readonly service: PluginConnectionService;
    readonly durable: boolean;
}

/**
 * Guard a credentialed plugin mutation. Applies to every non-GET method; the
 * guard itself skips safe methods, so calling it unconditionally is correct.
 */
export function requirePluginMutation(event: H3Event): void {
    requireSameOriginMutation(event, {
        intentHeader: PLUGIN_MUTATION_INTENT_HEADER,
        intentValue: PLUGIN_MUTATION_INTENT_VALUE,
        requireJson: true,
    });
}

export async function requireConnectionApiContext(
    event: H3Event
): Promise<ConnectionApiContext> {
    const config = useRuntimeConfig();
    if (!config.auth.enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const session = await resolveSessionContext(event);
    requireSession(session);

    const userId = session.user?.id;
    const workspaceId = session.workspace?.id;
    if (!userId || !workspaceId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.write', { kind: 'workspace', id: workspaceId });

    const resolved = resolveConnectionService();
    return {
        userId,
        workspaceId,
        service: resolved.service,
        durable: resolved.durable,
    };
}

export function requireConnectionProvider(providerId: string) {
    const provider = listConnectionProviders().find((entry) => entry.id === providerId);
    if (!provider) {
        throw createError({
            statusCode: 400,
            statusMessage: `Unknown connection provider: ${providerId}`,
        });
    }
    return provider;
}

export async function readConnectionBody<T>(event: H3Event): Promise<T> {
    return await readLimitedJsonBody<T>(event);
}
