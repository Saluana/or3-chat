import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3';
import { requireAdminApiContext } from '../../../../../admin/api';
import { rolloutCandidateFor, rolloutCoordinatorFor } from '../../../../../admin/plugins/rollout-route-support';
import { expectedRolloutRevision, respondToRolloutMutation, rolloutHttpError } from '../../../../../admin/plugins/rollout-route-error';

export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { ownerOnly: true, superAdminOnly: true, mutation: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const coordinator = rolloutCoordinatorFor(event);
    const id = getRouterParam(event, 'operationId') ?? '';
    const record = await coordinator.deps.records.read(id);
    if (!record) throw createError({ statusCode: 404, statusMessage: 'Rollout not found' });
    const expectedRevision = await expectedRolloutRevision(event);
    try {
        const { candidate } = await rolloutCandidateFor(record.pluginId, !record.enabled);
        return await respondToRolloutMutation(event, coordinator, id, coordinator.continue(id, candidate, expectedRevision));
    } catch (error) { throw rolloutHttpError(error); }
});
