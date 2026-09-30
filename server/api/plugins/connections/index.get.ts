import { defineEventHandler } from 'h3';
import { requireConnectionApiContext } from '../../../utils/plugins/connections/api-context';

/**
 * Lists the caller's own plugin connections for the active workspace.
 * Secrets are never included; only opaque references and test evidence.
 */
export default defineEventHandler(async (event) => {
    const { service, workspaceId, userId, durable } =
        await requireConnectionApiContext(event);
    const connections = await service.list({ ownerUserId: userId, workspaceId });
    return {
        connections,
        durable,
        credentialsAvailable: service.available,
    };
});
