import { createError, defineEventHandler, readBody, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../admin/api';
import { requesterIdentity } from '../../../../utils/plugins/acquisition/route-identity';
import { rolloutCandidateFor, rolloutCoordinatorFor } from '../../../../admin/plugins/rollout-route-support';
import { rolloutHttpError } from '../../../../admin/plugins/rollout-route-error';

const Selection = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('selected'), workspaceIds: z.array(z.string().min(1).max(256)).min(1).max(1000) }).strict(),
    z.object({ kind: z.literal('all-existing') }).strict(),
    z.object({ kind: z.literal('new-only') }).strict(),
]);
const BodySchema = z.object({
    pluginId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
    selection: Selection,
    enabled: z.boolean(),
    includeFutureWorkspaces: z.boolean(),
    approvedGrants: z.array(z.string().min(1).max(64)).max(64).optional(),
}).strict();

export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, { ownerOnly: true, superAdminOnly: true, mutation: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const parsed = BodySchema.safeParse(await readBody(event));
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid rollout selection' });
    try {
        const { candidate, release, policy } = await rolloutCandidateFor(parsed.data.pluginId, !parsed.data.enabled);
        const coordinator = rolloutCoordinatorFor(event);
        const record = await coordinator.createPreview({ ...parsed.data, approvedGrants: parsed.data.approvedGrants ?? candidate.requestedGrants, actorId: requesterIdentity(context), candidate });
        return {
            ok: true,
            preview: await coordinator.deps.records.page(record.id),
            release: { version: release?.version ?? policy?.approvedRelease.version ?? 'Unavailable', packageDigest: record.packageDigest, authoritySha256: record.authoritySha256,
                trust: release?.authority?.trust ?? candidate.authority?.trust ?? 'unknown', requestedGrants: release?.requestedGrants ?? candidate.requestedGrants,
                authority: release?.authority ?? candidate.authority ?? null },
        };
    } catch (error) { throw rolloutHttpError(error); }
});
