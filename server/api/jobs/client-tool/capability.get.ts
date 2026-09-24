import { createError, defineEventHandler, setHeader } from 'h3';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { getJobProvider } from '../../../utils/background-jobs/store';

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
    return {
        available: Boolean(
            provider.claimClientToolCall &&
            provider.settleClientToolCall &&
            provider.updateJobExecution
        ),
    };
});
