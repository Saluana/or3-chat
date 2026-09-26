/** Pending buyer-approved release requests for the site administrator. */
import { defineEventHandler, setResponseHeader } from 'h3';
import { requireAdminApiContext } from '../../../admin/api';
import { LibraryInstallRequestStore } from '../../../admin/library/install-requests';
import { PluginAcquisitionOperationStore } from '../../../utils/plugins/acquisition/operation-store';

export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { ownerOnly: true, superAdminOnly: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const [requests, operations] = await Promise.all([
        new LibraryInstallRequestStore().list(),
        new PluginAcquisitionOperationStore().list(),
    ]);
    const byRequest = new Map(operations.filter((operation) => operation.libraryGrant)
        .map((operation) => [operation.libraryGrant!.requestId, operation]));
    return {
        ok: true,
        requests: requests.filter((request) => request.expiresAt > Date.now())
            .map((request) => ({
                ...request,
                operationId: byRequest.get(request.id)?.operationId ?? null,
                operationStatus: byRequest.get(request.id)?.status ?? null,
            })),
    };
});
