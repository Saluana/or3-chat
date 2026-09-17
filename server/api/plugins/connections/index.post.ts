import { createError, defineEventHandler } from 'h3';
import {
    readConnectionBody,
    requireConnectionApiContext,
    requireConnectionProvider,
    requirePluginMutation,
} from '../../../utils/plugins/connections/api-context';

type CreateBody = {
    readonly pluginId?: unknown;
    readonly providerId?: unknown;
    readonly label?: unknown;
    readonly credential?: unknown;
    readonly scopes?: unknown;
};

/**
 * Stores a connection credential.
 *
 * The credential is encrypted with the host key immediately; it is never
 * echoed, logged or written anywhere else. Scopes are intersected with the
 * provider's declared scopes so a caller cannot widen access.
 */
export default defineEventHandler(async (event) => {
    requirePluginMutation(event);
    const context = await requireConnectionApiContext(event);
    const body = await readConnectionBody<CreateBody>(event);

    const pluginId = typeof body.pluginId === 'string' ? body.pluginId.trim() : '';
    const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : '';
    const credential = typeof body.credential === 'string' ? body.credential : '';
    const label = typeof body.label === 'string' ? body.label.trim() : '';

    if (!pluginId || pluginId.length > 128) {
        throw createError({ statusCode: 400, statusMessage: 'pluginId is required' });
    }
    if (!credential || credential.length > 4096) {
        throw createError({ statusCode: 400, statusMessage: 'credential is required' });
    }

    const provider = requireConnectionProvider(providerId);
    const requested = Array.isArray(body.scopes)
        ? body.scopes.filter((scope): scope is string => typeof scope === 'string')
        : provider.scopes;
    const scopes = requested.filter((scope) => provider.scopes.includes(scope));
    if (scopes.length !== requested.length) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Requested scopes are not declared by this provider',
        });
    }

    const result = await context.service.create({
        ownerUserId: context.userId,
        workspaceId: context.workspaceId,
        pluginId,
        providerId,
        label: label || provider.label,
        scopes,
        credential,
    });

    if (result.status !== 'created') {
        throw createError({
            statusCode: result.code === 'secret-unavailable' ? 503 : 400,
            statusMessage: result.message,
        });
    }

    // `view` only: the plaintext credential is never returned by the API.
    return { connection: result.view };
});
