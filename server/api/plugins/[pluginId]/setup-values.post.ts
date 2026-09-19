import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { requirePluginMutation } from '../../../utils/plugins/connections/api-context';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { PluginAcquisitionOperationStore } from '../../../utils/plugins/acquisition/operation-store';
import { ImmutablePluginPackageStore } from '../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../admin/plugins/package-pointer-store';
import { resolvePluginPackage } from '../../../utils/plugins/setup/discovery';
import { loadPackageDescriptors } from '../../../utils/plugins/setup/load-descriptors';
import {
    readSetupValues,
    writeSetupValues,
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
};

/**
 * Persists non-secret setup values for one plugin in the active workspace.
 *
 * The resolved package's field schema is the validator: unknown keys are
 * refused, each value must satisfy its field kind (choice membership, numeric
 * normalization, required non-empty), and the merged document is validated as a
 * whole. Secrets belong in a connection record, never here.
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
    if (!workspaceId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.write', { kind: 'workspace', id: workspaceId });

    const pluginId = getRouterParam(event, 'pluginId') ?? '';
    if (!pluginId || pluginId.length > 128) {
        throw createError({ statusCode: 400, statusMessage: 'pluginId is required' });
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

    // An acquisition records its candidate in the package pointer store before
    // setup, so the save endpoint must resolve the selected package as well as a
    // legacy extension directory. The running plugin writes `slot=current`, so
    // its own settings save never lands in a pending candidate's document.
    const query = getQuery(event);
    const slot = query.slot === 'current' ? ('current' as const) : undefined;
    const requestedOperationId =
        operationId ??
        (typeof query.operationId === 'string' && query.operationId.length > 0
            ? query.operationId
            : null);
    const installed = await resolvePluginPackage(
        pluginId,
        EXTENSIONS_BASE_DIR,
        slot ?? 'auto'
    );
    if (!installed) {
        throw createError({ statusCode: 404, statusMessage: 'Plugin is not installed' });
    }
    if (
        expectedPackageDigest !== null &&
        installed.digest !== expectedPackageDigest
    ) {
        throw createError({
            statusCode: 409,
            statusMessage:
                'The package changed since this setup form was loaded. Reload and try again.',
            data: { code: 'setup-package-conflict' },
        });
    }

    // Candidate setup must be tied to the exact durable acquisition that owns
    // the pointer. Runtime/current saves may omit an operation; auto-selected
    // candidates may infer one only when there is exactly one matching active
    // operation, never from plugin id alone.
    let boundOperationId: string | null = requestedOperationId;
    if (installed.digest !== null && slot !== 'current') {
        const packages = new ImmutablePluginPackageStore(EXTENSIONS_BASE_DIR);
        const pointers = new PluginPackagePointerStore(EXTENSIONS_BASE_DIR, packages);
        const pointer = await pointers.readPointer(pluginId).catch(() => null);
        const isCandidate = pointer?.candidate?.packageDigest === installed.digest;
        if (isCandidate) {
            const operations = await new PluginAcquisitionOperationStore().list(pluginId);
            const matching = operations.filter(
                (candidate) =>
                    candidate.candidateDigest === installed.digest &&
                    candidate.status !== 'completed' &&
                    candidate.status !== 'canceled'
            );
            if (boundOperationId === null && matching.length === 1) {
                boundOperationId = matching[0]!.operationId;
            }
            const operation = boundOperationId
                ? matching.find((candidate) => candidate.operationId === boundOperationId)
                : undefined;
            if (!operation || operation.pluginId !== pluginId || operation.workspaceId !== workspaceId) {
                throw createError({
                    statusCode: 409,
                    statusMessage:
                        'This candidate is owned by a different or unavailable install operation. Reload the Marketplace update and try again.',
                    data: { code: 'setup-operation-conflict' },
                });
            }
        } else if (boundOperationId !== null) {
            throw createError({
                statusCode: 409,
                statusMessage: 'The requested install candidate is no longer pending.',
                data: { code: 'setup-operation-conflict' },
            });
        }
    }
    const descriptors = await loadPackageDescriptors({
        extensionsBaseDir: EXTENSIONS_BASE_DIR,
        packagePath: installed.path,
    });
    if (!descriptors.setup) {
        throw createError({
            statusCode: 409,
            statusMessage: `This package's ${descriptors.problems.join('; ') || 'setup descriptor'} cannot validate settings`,
        });
    }

    const current = await readSetupValues(event, workspaceId, pluginId, {
        packageDigest: installed.digest,
        ...(boundOperationId === null ? {} : { operationId: boundOperationId }),
        ...(boundOperationId === null
            ? {}
            : {
                  basePackageDigest:
                      (await resolvePluginPackage(pluginId, EXTENSIONS_BASE_DIR, 'current'))
                          ?.digest ?? null,
              }),
    });
    const result = applySetupValuesPatch({
        fields: descriptors.setup.fields,
        current,
        patch: patch as Readonly<Record<string, unknown>>,
    });

    if (result.unknownKeys.length > 0) {
        throw createError({
            statusCode: 400,
            statusMessage: `Unknown setting${result.unknownKeys.length > 1 ? 's' : ''}: ${result.unknownKeys.join(', ')}`,
            data: { fieldErrors: result.unknownKeys.map((key) => ({ key, message: 'Unknown setting' })) },
        });
    }
    if (result.errors.length > 0) {
        throw createError({
            statusCode: 400,
            statusMessage: result.errors.map((error) => error.message).join('; '),
            data: { fieldErrors: result.errors },
        });
    }

    let revision: number | null = null;
    try {
        if (installed.digest === null) {
            await writeUnscopedSetupValues(event, workspaceId, pluginId, { ...result.values });
        } else {
            revision = await writeSetupValues(
                event,
                workspaceId,
                pluginId,
                { packageDigest: installed.digest, operationId: boundOperationId },
                { ...result.values },
                expectedRevision
            );
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
        values: result.values,
        keys: Object.keys(result.values).sort(),
        packageDigest: installed.digest,
        revision,
    };
});
