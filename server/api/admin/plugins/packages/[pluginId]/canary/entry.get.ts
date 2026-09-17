import { createError, defineEventHandler, getQuery, getRouterParam, setResponseHeader } from 'h3';
import { requireAdminApiContext } from '../../../../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../../../../admin/stores/registry';
import { pluginPackageServices } from '../../../../../../admin/plugins/package-operation-support';
import {
    PluginPackageAssetError,
    PluginPackageAssetReader,
} from '../../../../../../admin/plugins/package-assets';

/**
 * Serve the candidate's client entry bytes to the browser that holds a valid
 * canary ticket.
 *
 * The ticket is the grant: the reader deliberately skips the selected-version
 * check (the candidate is not promoted yet), so this route must never be
 * reachable without a live, single-use ticket for this exact digest.
 */
export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, {
        ownerOnly: true,
        superAdminOnly: true,
    });
    const pluginId = getRouterParam(event, 'pluginId');
    const query = getQuery(event);
    const ticketId = typeof query.ticketId === 'string' ? query.ticketId : '';
    if (!pluginId || !ticketId) {
        throw createError({ statusCode: 400, statusMessage: 'ticketId is required' });
    }
    const services = pluginPackageServices(getWorkspaceSettingsStore(event));
    const ticket = await services.clientCanary.readTicket(ticketId);
    if (!ticket || ticket.pluginId !== pluginId || ticket.expiresAt <= Date.now()) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const reader = new PluginPackageAssetReader(services.packages, services.pointers);
    try {
        const asset = await reader.readAsset({
            pluginId,
            packageDigest: ticket.packageDigest,
            requestPath: ticket.clientEntry.entry,
        });
        setResponseHeader(event, 'Content-Type', asset.contentType);
        setResponseHeader(event, 'Content-Length', asset.bytes.byteLength);
        setResponseHeader(event, 'Cache-Control', 'no-store');
        setResponseHeader(event, 'X-Content-Type-Options', 'nosniff');
        return asset.bytes;
    } catch (error) {
        if (error instanceof PluginPackageAssetError) {
            throw createError({ statusCode: 404, statusMessage: 'Not Found' });
        }
        throw error;
    }
});
