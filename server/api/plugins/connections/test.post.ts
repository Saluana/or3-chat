import { createError, defineEventHandler } from 'h3';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import {
    readConnectionBody,
    requireConnectionApiContext,
    requireConnectionProvider,
    requirePluginMutation,
} from '../../../utils/plugins/connections/api-context';
import { runConnectionSetupTest } from '../../../utils/plugins/connections/setup-test';
import { createFetchConnectionTransport } from '../../../utils/plugins/connections/transport';
import {
    loadPackageDescriptors,
    toConnectionDispatchPolicy,
} from '../../../utils/plugins/setup/load-descriptors';
import { resolveSetupTestTarget } from '../../../utils/plugins/setup/test-target';

type TestBody = {
    readonly ref?: unknown;
    readonly pluginId?: unknown;
};

/**
 * Runs the bounded, read-only test action for a connection and records
 * revision-bound evidence.
 *
 * The operation and its URL are resolved here from the provider's approved
 * operation and the release policy for the connection's bound slot; the caller
 * supplies only the opaque reference. Non-idempotent or write operations are
 * refused by the setup-test module, and dispatch re-validates the request against
 * the release's approved destinations.
 */
export default defineEventHandler(async (event) => {
    requirePluginMutation(event);
    const context = await requireConnectionApiContext(event);
    const body = await readConnectionBody<TestBody>(event);

    const ref = typeof body.ref === 'string' ? body.ref : '';
    const pluginId = typeof body.pluginId === 'string' ? body.pluginId.trim() : '';
    if (!ref || !pluginId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'ref and pluginId are required',
        });
    }

    const resolved = await context.service.resolve({
        ref,
        pluginId,
        workspaceId: context.workspaceId,
        ownerUserId: context.userId,
    });
    if (resolved.status === 'denied') {
        throw createError({ statusCode: 403, statusMessage: resolved.message });
    }
    const connection = resolved.connection;
    const provider = requireConnectionProvider(connection.providerId);

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
    if (!descriptors.setup) {
        throw createError({
            statusCode: 409,
            statusMessage: 'The package setup descriptor is unavailable',
        });
    }

    const target = resolveSetupTestTarget({
        setup: descriptors.setup,
        policy: descriptors.policy,
        provider,
        slotId: connection.slotId,
    });
    if (!target.ok) {
        throw createError({ statusCode: 409, statusMessage: target.message });
    }

    return await runConnectionSetupTest({
        service: context.service,
        provider,
        ref,
        pluginId,
        workspaceId: context.workspaceId,
        ownerUserId: context.userId,
        operationId: target.target.operationId,
        url: target.target.url,
        deadlineMs: target.target.deadlineMs,
        transport: createFetchConnectionTransport(),
        policy: toConnectionDispatchPolicy(descriptors.policy),
    });
});
