import { createError, defineEventHandler } from 'h3';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import {
    ImmutablePluginPackageStore,
    PluginPackageStoreError,
} from '../../../admin/plugins/package-store';
import { PackageOperationLockError } from '../../../admin/plugins/package-operation-lock';
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
import {
    bindCandidateOperation,
    resolvePluginPackage,
} from '../../../utils/plugins/setup/discovery';

type TestBody = {
    readonly ref?: unknown;
    readonly pluginId?: unknown;
    /** Pending acquisition that owns the candidate package, when one is being set up. */
    readonly operationId?: unknown;
    /** Exact immutable package the setup page rendered, when provided. */
    readonly expectedPackageDigest?: unknown;
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
 *
 * The package is the verified selection (candidate first during setup), so a
 * marketplace package that only exists in immutable storage can be tested, and
 * a stale form that names a different package is refused. A candidate test is
 * bound to the acquisition operation that owns its exact digest, exactly like
 * connection creation, so another workspace's or an orphaned candidate cannot
 * drive the test.
 *
 * The selection, binding and credential-backed dispatch run under the package
 * lifecycle lease, so a promotion, rollback or cancellation cannot replace the
 * target between the caller's decision and the dispatched test.
 */
export default defineEventHandler(async (event) => {
    requirePluginMutation(event);
    const context = await requireConnectionApiContext(event);
    const body = await readConnectionBody<TestBody>(event);

    const ref = typeof body.ref === 'string' ? body.ref : '';
    const pluginId = typeof body.pluginId === 'string' ? body.pluginId.trim() : '';
    const requestedOperationId =
        typeof body.operationId === 'string' && body.operationId.length > 0
            ? body.operationId
            : null;
    const expectedPackageDigest =
        typeof body.expectedPackageDigest === 'string' &&
        body.expectedPackageDigest.length > 0
            ? body.expectedPackageDigest
            : null;
    if (!ref || !pluginId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'ref and pluginId are required',
        });
    }

    const packages = new ImmutablePluginPackageStore(EXTENSIONS_BASE_DIR);
    try {
        return await packages.runPluginOperation(pluginId, async () => {
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

            const selection = await resolvePluginPackage(
                pluginId,
                EXTENSIONS_BASE_DIR,
                'auto'
            );
            if (!selection) {
                throw createError({
                    statusCode: 404,
                    statusMessage: 'Plugin is not installed',
                });
            }
            if (selection.status === 'blocked' || !selection.path) {
                throw createError({
                    statusCode: 409,
                    statusMessage: 'The selected plugin package is blocked or inactive.',
                    data: { code: 'plugin-package-blocked', issues: selection.issues },
                });
            }
            if (
                expectedPackageDigest !== null &&
                selection.digest !== expectedPackageDigest
            ) {
                throw createError({
                    statusCode: 409,
                    statusMessage:
                        'The package changed since this setup page was loaded. Reload and try again.',
                    data: { code: 'setup-package-conflict' },
                });
            }
            if (selection.status === 'candidate' && selection.digest !== null) {
                const binding = await bindCandidateOperation({
                    pluginId,
                    workspaceId: context.workspaceId,
                    candidateDigest: selection.digest,
                    requestedOperationId,
                    settingsStore: getWorkspaceSettingsStore(event),
                });
                if (!binding.ok) {
                    throw createError({
                        statusCode: 409,
                        statusMessage: binding.message,
                        data: { code: binding.code },
                    });
                }
            } else if (requestedOperationId !== null) {
                throw createError({
                    statusCode: 409,
                    statusMessage:
                        'The requested install candidate is no longer pending.',
                    data: { code: 'setup-operation-conflict' },
                });
            }
            const descriptors = await loadPackageDescriptors({
                extensionsBaseDir: EXTENSIONS_BASE_DIR,
                packagePath: selection.path,
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
    } catch (error) {
        if (error instanceof PackageOperationLockError) {
            throw createError({
                statusCode: 409,
                statusMessage:
                    'The package is being updated right now. Retry once the operation finishes.',
                data: { code: 'setup-package-busy' },
            });
        }
        if (error instanceof PluginPackageStoreError && error.code === 'invalid-plugin-id') {
            throw createError({ statusCode: 400, statusMessage: 'pluginId is invalid' });
        }
        throw error;
    }
});
