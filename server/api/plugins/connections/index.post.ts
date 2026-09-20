import { createError, defineEventHandler } from 'h3';
import {
    readConnectionBody,
    requireConnectionApiContext,
    requireConnectionProvider,
    requirePluginMutation,
} from '../../../utils/plugins/connections/api-context';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import {
    ImmutablePluginPackageStore,
    PluginPackageStoreError,
} from '../../../admin/plugins/package-store';
import { PackageOperationLockError } from '../../../admin/plugins/package-operation-lock';
import {
    bindCandidateOperation,
    resolvePluginPackage,
} from '../../../utils/plugins/setup/discovery';
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
    /** Pending acquisition that owns the candidate package, when one is being set up. */
    readonly operationId?: unknown;
    /** Exact immutable package the setup page rendered. */
    readonly expectedPackageDigest?: unknown;
};

/**
 * Stores a connection credential.
 *
 * When the caller names a declared slot, the provider, scopes and operations
 * come from the verified selected package's own policy and are validated
 * against the registered provider, so a binding cannot be created that the
 * release does not approve. A pending candidate is bound to the acquisition
 * operation that owns it, and the credential can never be created against a
 * package the caller did not render. The credential is encrypted with the host
 * key immediately; it is never echoed, logged or written anywhere else.
 *
 * The whole resolve → bind → create sequence runs under the package lifecycle
 * lease, so a promotion, rollback or cancellation cannot replace the candidate
 * between the caller's decision and the stored credential.
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
    const requestedOperationId =
        typeof body.operationId === 'string' && body.operationId.length > 0
            ? body.operationId
            : null;
    const expectedPackageDigest =
        typeof body.expectedPackageDigest === 'string' &&
        body.expectedPackageDigest.length > 0
            ? body.expectedPackageDigest
            : null;

    if (!pluginId || pluginId.length > 128) {
        throw createError({ statusCode: 400, statusMessage: 'pluginId is required' });
    }
    if (!credential || credential.length > 4096) {
        throw createError({ statusCode: 400, statusMessage: 'credential is required' });
    }

    const packages = new ImmutablePluginPackageStore(EXTENSIONS_BASE_DIR);
    try {
        return await packages.runPluginOperation(pluginId, async () => {
            let provider: ConnectionProviderDescriptor;
            let providerId: string;
            let scopes: readonly string[];
            let connectionLabel: string;

            if (slotId) {
                // Marketplace packages live in the immutable pointer store and
                // never appear in the legacy extension inventory. Resolve the
                // verified selection so a candidate is discovered and a blocked
                // pointer is refused instead of silently falling back to legacy
                // code. The lease makes this decision hold through the create.
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
                if (selection.status === 'blocked') {
                    throw createError({
                        statusCode: 409,
                        statusMessage:
                            'This plugin package is blocked; its selected version could not be verified.',
                        data: { code: 'plugin-package-blocked', issues: selection.issues },
                    });
                }
                if (!selection.path) {
                    throw createError({
                        statusCode: 409,
                        statusMessage: 'No plugin package is currently selected for setup.',
                        data: { code: 'plugin-package-inactive' },
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
                // A candidate connection may only be declared by the
                // acquisition that owns the exact candidate digest; a runtime
                // selection must not carry a stale operation reference.
                if (selection.status === 'candidate' && selection.digest !== null) {
                    const binding = await bindCandidateOperation({
                        pluginId,
                        workspaceId: context.workspaceId,
                        candidateDigest: selection.digest,
                        requestedOperationId,
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
                const declared: Or3PackageConnection | undefined =
                    descriptors.policy?.connections.find(
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

                // Binding validation: the host provider must actually support
                // the declared mechanism, scopes and operations, or the
                // credential would be stored against a capability the release
                // only pretends to have.
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
                const declaredOperationIds = provider.operations.map(
                    (operation) => operation.id
                );
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
                    ? body.scopes.filter(
                          (scope): scope is string => typeof scope === 'string'
                      )
                    : provider.scopes;
                const allowed = requested.filter((scope) =>
                    provider.scopes.includes(scope)
                );
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
