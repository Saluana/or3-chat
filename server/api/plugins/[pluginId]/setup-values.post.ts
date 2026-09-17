import { createError, defineEventHandler, getRouterParam } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { requirePluginMutation } from '../../../utils/plugins/connections/api-context';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { resolvePluginPackage } from '../../../utils/plugins/setup/discovery';
import { loadPackageDescriptors } from '../../../utils/plugins/setup/load-descriptors';
import { readSetupValues, writeSetupValues } from '../../../utils/plugins/setup/settings-store';
import { applySetupValuesPatch } from '~~/shared/plugins/setup/values';

type ValuesBody = { readonly values?: unknown };

/**
 * Persists non-secret setup values for one plugin in the active workspace.
 *
 * The installed package's field schema is the validator: unknown keys are
 * refused, each value must satisfy its field kind (choice membership, numeric
 * normalization, required non-empty), and the merged document is validated as a
 * whole. Secrets belong in a connection record, never here.
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

    // An acquisition records its candidate in the package pointer store before
    // setup, so the save endpoint must resolve the selected package as well as a
    // legacy extension directory.
    const installed = await resolvePluginPackage(pluginId);
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
            statusMessage: `This package's ${descriptors.problems.join('; ') || 'setup descriptor'} cannot validate settings`,
        });
    }

    const current = await readSetupValues(event, workspaceId, pluginId);
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

    await writeSetupValues(event, workspaceId, pluginId, { ...result.values });
    return { ok: true, values: result.values, keys: Object.keys(result.values).sort() };
});
