import { checkExplorerPage } from '../../utils/sync/explorer-capability';
import { requireHistoryCapability, checkHistory, assertHistoryResponse } from '../../utils/sync/history-incarnation';
import { classifySnapshotPage } from '../../utils/sync/unavailable-records';
import { observeSyncRequest } from '../../sync/observations';
import { hasWorkspaceItemSemantics } from "~~/shared/posts/workspace-item-capability";
import { requireWorkspaceItemCapability } from "../../utils/sync/workspace-item-capability";
/**
 * @module server/api/sync/snapshot.post
 *
 * Returns one bounded page from a provider's consistent materialized snapshot.
 * Fresh clients atomically install the full page chain before replaying changes
 * strictly after its high-watermark.
 */
import { defineEventHandler, createError, setResponseHeader } from 'h3';
import {
    MAX_SYNC_SNAPSHOT_REQUEST_BYTES,
    SnapshotRequestSchema,
    SnapshotResponseSchema,
    getSnapshotResponseContractError,
} from '~~/shared/sync/schemas';
import { resolveSessionContext } from '../../auth/session';
import { readLimitedJsonBody } from '../../utils/security/limited-json-body';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isSyncEnabled } from '../../utils/sync/is-sync-enabled';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';
import {
    checkSyncRateLimit,
    getSyncRateLimitStats,
    recordSyncRequest,
} from '../../utils/sync/rate-limiter';
import { enforceRateLimit } from '../../utils/rate-limit/enforce';
import { setNoCacheHeaders } from '../../utils/headers';
import {
    isGenericFileMetaPayload,
    requireFileKindCapability,
} from '../../utils/storage/file-kind-capability';

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event) || !isSyncEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    setNoCacheHeaders(event);
    const body = await readLimitedJsonBody(event, MAX_SYNC_SNAPSHOT_REQUEST_BYTES);
    requireHistoryCapability(body);
    const request = SnapshotRequestSchema.safeParse(body);
    if (!request.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid snapshot request' });
    }

    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user || !session.workspace) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.read', {
        kind: 'workspace',
        id: request.data.scope.workspaceId,
    });

    const userId = session.user.id;
    return await observeSyncRequest(event, userId, request.data.scope.workspaceId, 'snapshot', async () => {
        const rateLimit = checkSyncRateLimit(userId, 'sync:snapshot');
        enforceRateLimit(event, rateLimit);

        const stats = getSyncRateLimitStats(userId, 'sync:snapshot');
        if (stats) {
            setResponseHeader(event, 'X-RateLimit-Limit', String(stats.limit));
            setResponseHeader(event, 'X-RateLimit-Remaining', String(stats.remaining));
        }

        const adapter = getActiveSyncGatewayAdapter();
        if (!adapter?.snapshot) {
            throw createError({
                statusCode: 503,
                statusMessage: 'Snapshot bootstrap unavailable for active sync adapter',
            });
        }

        recordSyncRequest(userId, 'sync:snapshot');

        const history = await checkHistory(event, adapter, request.data, request.data.historyIncarnation === null && !request.data.pageToken);
        const page = await adapter.snapshot(event, request.data);
        assertHistoryResponse(page.historyIncarnation, history);
        const response = SnapshotResponseSchema.safeParse(
            await classifySnapshotPage(event, adapter, request.data, page)
        );
        if (!response.success) {
            throw createError({ statusCode: 502, statusMessage: 'Invalid snapshot response' });
        }
        if (getSnapshotResponseContractError(request.data, response.data)) {
            throw createError({ statusCode: 502, statusMessage: 'Invalid snapshot response' });
        }

        // Snapshot pages are collected before installation, so reject the whole
        // page before any caller can apply a partial generic-file record.
        if (response.data.items.some((item) =>
            item.kind === 'row' &&
            isGenericFileMetaPayload(item.tableName, item.payload)
        )) {
            requireFileKindCapability(request.data.fileKindCapability);
        }

        checkExplorerPage(request.data.explorerCapability, response.data.items, response.data.unavailable ?? []);
        if (response.data.items.some(item => item.kind === "row" && hasWorkspaceItemSemantics(item.tableName, item.payload))) requireWorkspaceItemCapability(request.data.workspaceItemCapability);
        return response.data;
    });
});
