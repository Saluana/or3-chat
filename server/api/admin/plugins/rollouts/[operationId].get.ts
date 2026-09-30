import { createError, defineEventHandler, getQuery, getRouterParam, setResponseHeader } from 'h3';
import { requireAdminApiContext } from '../../../../admin/api';
import { PluginRolloutStore } from '../../../../admin/plugins/rollout-store';
import { rolloutCandidateFor } from '../../../../admin/plugins/rollout-route-support';
import { rolloutMutationStatus } from '../../../../admin/plugins/rollout-route-error';

export default defineEventHandler(async (event) => {
    await requireAdminApiContext(event, { ownerOnly: true, superAdminOnly: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const id = getRouterParam(event, 'operationId') ?? '';
    const query = getQuery(event);
    const result = await new PluginRolloutStore().page(id, Number(query.page) || 1, 25,
        query.filter === 'problems' ? 'problems' : 'all');
    if (!result) throw createError({ statusCode: 404, statusMessage: 'Rollout not found' });
    let release = null;
    if (result.status === 'preview') {
        const { candidate, policy } = await rolloutCandidateFor(result.pluginId, !result.enabled);
        if (candidate.packageDigest !== result.packageDigest || candidate.authoritySha256 !== result.authoritySha256) {
            throw createError({ statusCode: 409, statusMessage: 'The selected release changed. Preview the rollout again.' });
        }
        release = { version: policy?.approvedRelease.version ?? 'Unavailable', packageDigest: result.packageDigest,
            trust: candidate.authority?.trust ?? 'unknown', requestedGrants: candidate.requestedGrants,
            authority: candidate.authority };
    }
    return { ok: true, operation: result, release, mutation: rolloutMutationStatus(id) };
});
