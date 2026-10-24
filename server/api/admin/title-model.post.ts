import { z } from 'zod';
import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { requireAdminApiContext } from '../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { readLimitedJsonBody } from '../../utils/security/limited-json-body';
import { TITLE_MODEL_SETTING, TitleModelSchema } from '~~/shared/titles/title';
import { stripModelVariantSuffix } from '~~/shared/openrouter/model-variants';
import { createOpenRouterClient, fetchOpenRouterCatalog } from '~~/shared/openrouter';
import { resolveOpenRouterCredential } from '../../secrets/openrouter';
import { useRuntimeConfig } from '#imports';

const BodySchema = z.object({ workspaceId: z.string().min(1).max(200),
    model: TitleModelSchema }).strict();

export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const context = await requireAdminApiContext(event, { ownerOnly: true, mutation: true, allowWorkspaceAdmin: true });
    const body = BodySchema.safeParse(await readLimitedJsonBody(event, 2048));
    if (!body.success) throw createError({ statusCode: 400 });
    const workspaceId = resolveAdminWorkspaceTarget(context, body.data.workspaceId);
    const { apiKey } = await resolveOpenRouterCredential(event, context.session);
    const catalog = await fetchOpenRouterCatalog(createOpenRouterClient({ apiKey, serverURL: useRuntimeConfig(event).openrouterBaseUrl }), undefined, { deadlineMs: 15000 })
        .catch(() => { throw createError({ statusCode: 502, statusMessage: 'Model catalog unavailable.' }); });
    const base = stripModelVariantSuffix(body.data.model);
    if (!catalog.some(model => model.id === base && (!model.architecture?.output_modalities || model.architecture.output_modalities.includes('text'))))
        throw createError({ statusCode: 400, statusMessage: 'Select a supported text model.' });
    await getWorkspaceSettingsStore(event).set(workspaceId, TITLE_MODEL_SETTING, body.data.model)
        .catch(() => { throw createError({ statusCode: 503, statusMessage: 'Title model could not be saved.' }); });
    return { model: body.data.model };
});
