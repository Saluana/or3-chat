import { createError, defineEventHandler, setHeader } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { getJobProvider } from '../../../utils/background-jobs/store';
import { supportsClientToolHandoff, supportsDelegationCoordination, supportsDelegationHistory, supportsDurableBackgroundJobs } from '../../../utils/background-jobs/capabilities';
import { getSyncGatewayAdapter } from '../../../sync/gateway/registry';
import { useRuntimeConfig } from '#imports';
import { getServerTool } from '../../../utils/chat/tool-registry';
import { modelSearchDefinition } from '~~/shared/openrouter/delegation-model-catalog';
import { toolDefinitionEquals } from '~~/shared/chat/tool-policy';

/** Check the active provider before selecting a detached browser-tool run. */
export default defineEventHandler(async (event) => {
    setHeader(event, 'Cache-Control', 'no-store, private');
    const session = await resolveSessionContext(event);
    requireSession(session);
    const workspaceId = session.workspace?.id;
    if (!workspaceId) {
        throw createError({ statusCode: 403, statusMessage: 'Workspace required' });
    }
    requireCan(session, 'workspace.write', { kind: 'workspace', id: workspaceId });
    const provider = await getJobProvider();
    const syncId = (useRuntimeConfig().public as { sync?: { provider?: string } }).sync?.provider;
    const durableDelegation = supportsDelegationCoordination(provider) && supportsClientToolHandoff(provider) && !!syncId &&
        supportsDelegationHistory(getSyncGatewayAdapter(syncId));
    const modelSearch = getServerTool('search_models');
    return {
        available: supportsDurableBackgroundJobs(provider) && supportsClientToolHandoff(provider),
        // This only signals private metadata support, not durable delegation.
        delegationDefaultsCaptureVersion: 1,
        ...(modelSearch && modelSearch.runtime !== 'client' && toolDefinitionEquals(modelSearch.definition, modelSearchDefinition)
            ? { serverModelSearchVersion: 1 } : {}),
        ...(durableDelegation ? { durableDelegationVersion: 1 } : {}),
    };
});
