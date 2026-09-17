import { createError, defineEventHandler, getRouterParam } from 'h3';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { requirePluginMutation } from '../../../utils/plugins/connections/api-context';

type ValuesBody = { readonly values?: unknown };

const MAX_VALUE_BYTES = 8 * 1024;

/**
 * Persists non-secret setup values for one plugin in the active workspace.
 * Values are validated to a bounded primitive map; secrets belong in a
 * connection record, never here.
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

    const body = await readLimitedJsonBody<ValuesBody>(event);
    const raw = body?.values;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw createError({ statusCode: 400, statusMessage: 'values must be an object' });
    }

    const values: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (key.length > 128) {
            throw createError({ statusCode: 400, statusMessage: 'Setting name is too long' });
        }
        if (typeof value === 'string') {
            if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
                throw createError({ statusCode: 400, statusMessage: `Setting ${key} is too large` });
            }
            values[key] = value;
            continue;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            values[key] = value;
            continue;
        }
        if (typeof value === 'boolean') {
            values[key] = value;
            continue;
        }
        throw createError({
            statusCode: 400,
            statusMessage: `Setting ${key} must be a string, number or boolean`,
        });
    }

    const store = getWorkspaceSettingsStore(event);
    await store.set(workspaceId, `plugin:${pluginId}:setup-values`, JSON.stringify(values));
    return { ok: true, keys: Object.keys(values) };
});
