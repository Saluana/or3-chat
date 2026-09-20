import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { requirePluginMutation } from '../../../utils/plugins/connections/api-context';
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
import { authorizeHostActivation, checkHostActivationLive } from '../../../utils/plugins/isolation/activation-authorization';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import {
    patchSetupValues,
    readSetupValues,
    writeUnscopedSetupValues,
    SetupValuesRevisionConflictError,
} from '../../../utils/plugins/setup/settings-store';
import { applySetupValuesPatch } from '~~/shared/plugins/setup/values';

type ValuesBody = {
    readonly values?: unknown;
    /** Acquisition whose candidate this configuration prepares, when known. */
    readonly operationId?: unknown;
    /** Revision the form loaded; a stale save is refused instead of overwritten. */
    readonly expectedRevision?: unknown;
    /** Exact immutable package the form rendered. */
    readonly expectedPackageDigest?: unknown;
    /** Host activation handle for a runtime (`slot=current`) save. */
    readonly activationId?: unknown;
};

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Persists non-secret setup values for one plugin in the active workspace.
 *
 * The verified package selection is the identity: the field schema that
 * validates the patch, the digest the values are scoped to and the acquisition
 * operation that owns a candidate all come from it. A blocked or inactive V2
 * lifecycle is refused rather than silently writing to a legacy directory.
 *
 * The whole resolve → bind → write sequence runs under the package lifecycle
 * lease, the same one promotion and rollback hold. A promotion that copies the
 * candidate overlay and swaps the pointer therefore cannot interleave with a
 * successful setup save: whichever acquires the lease first is observed by the
 * other, and a request that arrives after promotion conflicts instead of
 * writing into a document the promotion already committed.
 *
 * Patch-style writes apply the transform inside the settings store's
 * compare-and-set retry loop, so concurrent disjoint patches both land. A form
 * that sends `expectedRevision` keeps the explicit conflict instead of
 * auto-merging. A runtime write (`slot=current`) must name the executing
 * package digest and the host activation handle that sealed it, so an old,
 * revoked or superseded activation cannot configure a package after disable,
 * rollback or promotion.
 *
 * While an update is staged, the resolved package is the candidate, and the
 * values are written under that candidate's digest. The running version keeps
 * its own document, so preparing an update never rewrites live configuration,
 * and a canceled or failed promotion leaves it untouched.
 */
export default defineEventHandler(async (event) => {
    requirePluginMutation(event);
    const session = await resolveSessionContext(event);
    requireSession(session);
    const workspaceId = session.workspace?.id;
    const userId = session.user?.id;
    if (!workspaceId || !userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.write', { kind: 'workspace', id: workspaceId });

    const pluginId = getRouterParam(event, 'pluginId') ?? '';
    if (!pluginId || pluginId.length > 128) {
        throw createError({ statusCode: 400, statusMessage: 'pluginId is required' });
    }
    if (!PLUGIN_ID_PATTERN.test(pluginId) || pluginId.includes('..')) {
        throw createError({ statusCode: 400, statusMessage: 'pluginId is invalid' });
    }

    const body = await readLimitedJsonBody<ValuesBody | undefined>(event);
    const patch = body?.values;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw createError({ statusCode: 400, statusMessage: 'values must be an object' });
    }
    const operationId =
        typeof body?.operationId === 'string' && body.operationId.length > 0
            ? body.operationId
            : null;
    const expectedRevision =
        typeof body?.expectedRevision === 'number' &&
        Number.isInteger(body.expectedRevision) &&
        body.expectedRevision >= 0
            ? body.expectedRevision
            : undefined;
    const expectedPackageDigest =
        typeof body?.expectedPackageDigest === 'string' && body.expectedPackageDigest.length > 0
            ? body.expectedPackageDigest
            : null;
    const activationId =
        typeof body?.activationId === 'string' && body.activationId.length > 0
            ? body.activationId
            : null;

    // The query carries the runtime/setup intent; the body carries the form
    // state. Both are read before the lease so the critical section is only the
    // authoritative resolution and write.
    const query = getQuery(event);
    const slot = query.slot === 'current' ? ('current' as const) : undefined;
    const requestedOperationId =
        operationId ??
        (typeof query.operationId === 'string' && query.operationId.length > 0
            ? query.operationId
            : null);

    const packages = new ImmutablePluginPackageStore(EXTENSIONS_BASE_DIR);
    try {
        // Commit guard for runtime saves: checked on every settings CAS attempt
        // and again after the write, so revoking the activation while the
        // request awaits descriptors or the settings store cannot be outrun.
        let activationGuard: (() => void) | undefined;
        return await packages.runPluginOperation(pluginId, async () => {
            // An acquisition records its candidate in the package pointer store
            // before setup, so the save endpoint resolves the verified selected
            // package as well as a legacy extension directory. The running
            // plugin writes `slot=current`, so its own settings save never lands
            // in a pending candidate's document.
            const selection = await resolvePluginPackage(
                pluginId,
                EXTENSIONS_BASE_DIR,
                slot ?? 'auto'
            );
            if (!selection) {
                throw createError({ statusCode: 404, statusMessage: 'Plugin is not installed' });
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
                    statusMessage: 'No plugin package is currently selected for configuration.',
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
                        'The package changed since this setup form was loaded. Reload and try again.',
                    data: { code: 'setup-package-conflict' },
                });
            }

            // Candidate setup must be tied to the exact durable acquisition that
            // owns the pointer. Runtime/current saves may omit an operation; a
            // candidate may infer one only when exactly one active operation
            // matches its digest. A request whose candidate was promoted while
            // it waited for the lease conflicts here instead of writing.
            let boundOperationId: string | null = null;
            if (selection.status === 'candidate' && selection.digest !== null) {
                const binding = await bindCandidateOperation({
                    pluginId,
                    workspaceId,
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
                boundOperationId = binding.operationId;
            } else if (requestedOperationId !== null) {
                throw createError({
                    statusCode: 409,
                    statusMessage: 'The requested install candidate is no longer pending.',
                    data: { code: 'setup-operation-conflict' },
                });
            }

            // A runtime save is bound to the executing activation: digest alone
            // cannot prove the writer is still authorized after disable,
            // revocation, rollback or a superseding activation.
            if (slot === 'current' && selection.source === 'package') {
                if (expectedPackageDigest === null) {
                    throw createError({
                        statusCode: 409,
                        statusMessage:
                            'Runtime settings saves must name the exact package they were written for.',
                        data: { code: 'setup-package-required' },
                    });
                }
                if (activationId === null) {
                    throw createError({
                        statusCode: 409,
                        statusMessage:
                            'Runtime settings saves must present the activation that is executing.',
                        data: { code: 'activation-required' },
                    });
                }
                const authorized = await authorizeHostActivation({
                    event,
                    activationId,
                    pluginId,
                    workspaceId,
                    userId,
                    packagePath: selection.path,
                    packageDigest: selection.digest,
                    settingsStore: getWorkspaceSettingsStore(event),
                });
                if (!authorized.ok) {
                    throw createError({
                        statusCode: authorized.statusCode,
                        statusMessage: authorized.message,
                        data: { code: authorized.code },
                    });
                }
                const guardedActivationId = activationId;
                activationGuard = () => {
                    const live = checkHostActivationLive(guardedActivationId);
                    if (!live.ok) {
                        throw createError({
                            statusCode: live.statusCode,
                            statusMessage: live.message,
                            data: { code: live.code },
                        });
                    }
                };
            }

            const descriptors = await loadPackageDescriptors({
                extensionsBaseDir: EXTENSIONS_BASE_DIR,
                packagePath: selection.path,
            });
            if (!descriptors.setup) {
                throw createError({
                    statusCode: 409,
                    statusMessage: `This package's ${descriptors.problems.join('; ') || 'setup descriptor'} cannot validate settings`,
                });
            }

            const transform = (current: Readonly<Record<string, unknown>>) => {
                const result = applySetupValuesPatch({
                    fields: descriptors.setup!.fields,
                    current,
                    patch: patch as Readonly<Record<string, unknown>>,
                });
                if (result.unknownKeys.length > 0) {
                    throw createError({
                        statusCode: 400,
                        statusMessage: `Unknown setting${result.unknownKeys.length > 1 ? 's' : ''}: ${result.unknownKeys.join(', ')}`,
                        data: {
                            fieldErrors: result.unknownKeys.map((key) => ({
                                key,
                                message: 'Unknown setting',
                            })),
                        },
                    });
                }
                if (result.errors.length > 0) {
                    throw createError({
                        statusCode: 400,
                        statusMessage: result.errors.map((error) => error.message).join('; '),
                        data: { fieldErrors: result.errors },
                    });
                }
                return result.values;
            };

            let revision: number | null = null;
            let values: Readonly<Record<string, unknown>>;
            try {
                if (selection.digest === null) {
                    // Legacy directories have no revision contract; the unscoped
                    // document remains their only configuration store.
                    values = transform(await readSetupValues(event, workspaceId, pluginId));
                    await writeUnscopedSetupValues(event, workspaceId, pluginId, values);
                } else {
                    // Only a candidate seeds from the running package; a runtime
                    // save never needs to read the selected version again.
                    const basePackageDigest =
                        boundOperationId === null
                            ? null
                            : ((await resolvePluginPackage(
                                  pluginId,
                                  EXTENSIONS_BASE_DIR,
                                  'current'
                              ))?.digest ?? null);
                    const written = await patchSetupValues(
                        event,
                        workspaceId,
                        pluginId,
                        {
                            packageDigest: selection.digest,
                            operationId: boundOperationId,
                            basePackageDigest,
                        },
                        transform,
                        {
                            ...(expectedRevision === undefined ? {} : { expectedRevision }),
                            ...(activationGuard ? { guard: activationGuard } : {}),
                        }
                    );
                    revision = written.revision;
                    values = written.values;
                }
            } catch (error) {
                if (error instanceof SetupValuesRevisionConflictError) {
                    throw createError({
                        statusCode: 409,
                        statusMessage:
                            'The settings changed since this form was loaded. Reload and apply your changes again.',
                        data: {
                            code: 'setup-values-conflict',
                            expectedRevision: error.expectedRevision,
                            actualRevision: error.actualRevision,
                        },
                    });
                }
                throw error;
            }

            return {
                ok: true,
                values,
                keys: Object.keys(values).sort(),
                packageDigest: selection.digest,
                revision,
            };
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
