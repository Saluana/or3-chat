import { createError, defineEventHandler, readBody } from 'h3';
import { valid } from 'semver';
import { requireAdminApiContext } from '../../../admin/api';
import { writeUpdatePin } from '../../../utils/plugins/marketplace/update-pins';

export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { ownerOnly: true, mutation: true });
    const body = await readBody<{ pluginId?: unknown; version?: unknown }>(event);
    if (!body || typeof body.pluginId !== 'string' ||
        !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(body.pluginId) ||
        (body.version !== null && (typeof body.version !== 'string' || !valid(body.version)))) {
        throw createError({ statusCode: 400, statusMessage: 'Provide a plugin id and a semantic version, or null to remove the pin.' });
    }
    await writeUpdatePin(body.pluginId, body.version);
    return { ok: true };
});
