import { createError, defineEventHandler, readBody, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../admin/api';
import { requesterIdentity } from '../../../utils/plugins/acquisition/route-identity';
import { SitePluginPolicyStore } from '../../../admin/plugins/site-policy';
import { ensureSitePolicyMigrated, verifiedReleaseForSite } from '../../../admin/plugins/site-policy-service';

const BodySchema = z.object({
    pluginId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
    action: z.enum(['approve', 'hide']),
    expectedRevision: z.number().int().nonnegative(),
    version: z.string().min(1).max(64).optional(),
    expectedReleaseId: z.string().min(1).max(128).optional(),
    expectedPackageTreeSha256: z.string().regex(/^sha256-[a-f0-9]{64}$/).optional(),
    expectedAuthoritySha256: z.string().regex(/^sha256-[a-f0-9]{64}$/).optional(),
}).strict();

export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, { ownerOnly: true, superAdminOnly: true, mutation: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const parsed = BodySchema.safeParse(await readBody(event));
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid approval request' });
    const body = parsed.data;
    const store = new SitePluginPolicyStore();
    await ensureSitePolicyMigrated(store);
    const current = await store.read(body.pluginId);
    if ((current?.revision ?? 0) !== body.expectedRevision) throw createError({ statusCode: 409, statusMessage: 'Site approval changed; refresh and review again' });
    if (body.action === 'hide' && !current) throw createError({ statusCode: 404, statusMessage: 'No approval exists to hide' });
    if (body.action === 'approve' && (!body.version || !body.expectedReleaseId || !body.expectedPackageTreeSha256 || !body.expectedAuthoritySha256)) {
        throw createError({ statusCode: 400, statusMessage: 'Review one exact release before approving it' });
    }
    const release = body.action === 'approve'
        ? await verifiedReleaseForSite(body.pluginId, body.version!) : current!.approvedRelease;
    if (body.action === 'approve' && (release.releaseId !== body.expectedReleaseId ||
        release.packageTreeSha256 !== body.expectedPackageTreeSha256 ||
        release.authoritySha256 !== body.expectedAuthoritySha256)) {
        throw createError({ statusCode: 409, statusMessage: 'The signed release changed. Review it again.' });
    }
    const saved = await store.save(body.pluginId, body.expectedRevision, {
        catalogVisible: body.action === 'approve',
        approvedRelease: release,
        futureDefault: current?.approvedRelease.packageTreeSha256 === release.packageTreeSha256 ? current.futureDefault : null,
    }, requesterIdentity(context));
    return { ok: true, policy: saved };
});
