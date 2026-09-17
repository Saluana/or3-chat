import { createError, defineEventHandler } from 'h3';
import {
    readConnectionBody,
    requireConnectionApiContext,
    requireConnectionProvider,
    requirePluginMutation,
} from '../../../utils/plugins/connections/api-context';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import { loadPackageDescriptors } from '../../../utils/plugins/setup/load-descriptors';
import type { ConnectionProviderDescriptor } from '~~/shared/plugins/connections/contracts';
import type { Or3PackageConnection } from '@or3/plugin-sdk/profile';

type CreateBody = {
    readonly pluginId?: unknown;
    readonly providerId?: unknown;
    /** Declared package connection slot this credential is bound to. */
    readonly slotId?: unknown;
    readonly label?: unknown;
    readonly credential?: unknown;
    readonly scopes?: unknown;
};

/**
 * Stores a connection credential.
 *
 * When the caller names a declared slot, the provider, scopes and operations come
 * from the installed package's own policy and are validated against the
 * registered provider, so a binding cannot be created that the release does not
 * approve. The credential is encrypted with the host key immediately; it is never
 * echoed, logged or written anywhere else.
 */
export default defineEventHandler(async (event) => {
    requirePluginMutation(event);
    const context = await requireConnectionApiContext(event);
    const body = await readConnectionBody<CreateBody>(event);

    const pluginId = typeof body.pluginId === 'string' ? body.pluginId.trim() : '';
    const credential = typeof body.credential === 'string' ? body.credential : '';
    const slotId = typeof body.slotId === 'string' ? body.slotId.trim() : '';
    const requestedProviderId =
        typeof body.providerId === 'string' ? body.providerId.trim() : '';
    const label = typeof body.label === 'string' ? body.label.trim() : '';

    if (!pluginId || pluginId.length > 128) {
        throw createError({ statusCode: 400, statusMessage: 'pluginId is required' });
    }
    if (!credential || credential.length > 4096) {
        throw createError({ statusCode: 400, statusMessage: 'credential is required' });
    }

    let provider: ConnectionProviderDescriptor;
    let providerId: string;
    let scopes: readonly string[];
    let connectionLabel: string;

    if (slotId) {
        const installed = (await listInstalledExtensions()).find(
            (extension) => extension.kind === 'plugin' && extension.id === pluginId
        );
        if (!installed) {
            throw createError({ statusCode: 404, statusMessage: 'Plugin is not installed' });
        }
        const descriptors = await loadPackageDescriptors({
            extensionsBaseDir: EXTENSIONS_BASE_DIR,
            packagePath: installed.path,
        });
        const declared: Or3PackageConnection | undefined = descriptors.policy?.connections.find(
            (candidate) => candidate.id === slotId
        );
        if (!declared) {
            throw createError({
                statusCode: 400,
                statusMessage: `This package does not declare a connection named ${slotId}`,
            });
        }
        provider = requireConnectionProvider(declared.provider);
        providerId = provider.id;
        if (requestedProviderId && requestedProviderId !== providerId) {
            throw createError({
                statusCode: 400,
                statusMessage: `Connection slot ${slotId} belongs to provider ${providerId}`,
            });
        }

        // Binding validation: the host provider must actually support the
        // declared mechanism, scopes and operations, or the credential would be
        // stored against a capability the release only pretends to have.
        if (provider.mechanism !== declared.mechanism) {
            throw createError({
                statusCode: 409,
                statusMessage: `This host does not support the ${declared.mechanism} mechanism for ${provider.id}`,
            });
        }
        const missingProviderScopes = declared.scopes.filter(
            (scope) => !provider.scopes.includes(scope)
        );
        if (missingProviderScopes.length > 0) {
            throw createError({
                statusCode: 409,
                statusMessage: `The ${provider.id} provider does not declare the ${missingProviderScopes.join(', ')} scope`,
            });
        }
        const declaredOperationIds = provider.operations.map((operation) => operation.id);
        const missingOperations = declared.operations.filter(
            (operation) => !declaredOperationIds.includes(operation)
        );
        if (missingOperations.length > 0) {
            throw createError({
                statusCode: 409,
                statusMessage: `The ${provider.id} provider does not declare ${missingOperations.join(', ')}`,
            });
        }
        scopes = [...declared.scopes];
        connectionLabel = label || declared.label;
    } else {
        providerId = requestedProviderId;
        provider = requireConnectionProvider(providerId);
        const requested = Array.isArray(body.scopes)
            ? body.scopes.filter((scope): scope is string => typeof scope === 'string')
            : provider.scopes;
        const allowed = requested.filter((scope) => provider.scopes.includes(scope));
        if (allowed.length !== requested.length) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Requested scopes are not declared by this provider',
            });
        }
        scopes = allowed;
        connectionLabel = label || provider.label;
    }

    const result = await context.service.create({
        ownerUserId: context.userId,
        workspaceId: context.workspaceId,
        pluginId,
        providerId,
        ...(slotId === '' ? {} : { slotId }),
        label: connectionLabel,
        scopes,
        credential,
    });

    if (result.status !== 'created') {
        const status =
            result.code === 'secret-unavailable'
                ? 503
                : result.code === 'conflict'
                  ? 409
                  : 400;
        throw createError({ statusCode: status, statusMessage: result.message });
    }

    // `view` only: the plaintext credential is never returned by the API.
    return { connection: result.view };
});
