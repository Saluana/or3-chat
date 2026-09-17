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

type TestBody = {
    readonly ref?: unknown;
    readonly pluginId?: unknown;
    readonly operationId?: unknown;
    readonly url?: unknown;
};

/**
 * Runs the bounded, read-only test action for a connection and records
 * revision-bound evidence. Non-idempotent or write operations are refused by
 * the setup-test module, not by the caller's choice of operation, and the
 * request must also fall inside the release's approved connection policy.
 */
export default defineEventHandler(async (event) => {
    requirePluginMutation(event);
    const context = await requireConnectionApiContext(event);
    const body = await readConnectionBody<TestBody>(event);

    const ref = typeof body.ref === 'string' ? body.ref : '';
    const pluginId = typeof body.pluginId === 'string' ? body.pluginId.trim() : '';
    const operationId = typeof body.operationId === 'string' ? body.operationId : '';
    const url = typeof body.url === 'string' ? body.url : '';

    if (!ref || !pluginId || !operationId || !url) {
        throw createError({
            statusCode: 400,
            statusMessage: 'ref, pluginId, operationId and url are required',
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
    const provider = requireConnectionProvider(resolved.connection.providerId);

    // The release's own descriptor is the approved-operation source of truth.
    const installed = (await listInstalledExtensions()).find(
        (extension) => extension.kind === 'plugin' && extension.id === pluginId
    );
    let policy = null;
    if (installed) {
        const descriptors = await loadPackageDescriptors({
            extensionsBaseDir: EXTENSIONS_BASE_DIR,
            packagePath: installed.path,
        });
        policy = toConnectionDispatchPolicy(descriptors.policy);
    }

    const result = await runConnectionSetupTest({
        service: context.service,
        provider,
        ref,
        pluginId,
        workspaceId: context.workspaceId,
        ownerUserId: context.userId,
        operationId,
        url,
        transport: createFetchConnectionTransport(),
        policy,
    });

    return result;
});
