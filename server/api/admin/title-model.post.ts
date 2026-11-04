import { z } from 'zod';
import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { requireAdminApiContext } from '../../admin/api';
import { resolveAdminWorkspaceTarget } from '../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { readLimitedJsonBody } from '../../utils/security/limited-json-body';
import { FAST_MODEL_SETTING, FastModelSchema } from '~~/shared/ai/fast-model';
import { stripModelVariantSuffix } from '~~/shared/openrouter/model-variants';
import { createOpenRouterClient, fetchOpenRouterCatalog } from '~~/shared/openrouter';
import { fetchOpenAiCatalog, isOpenAiModel } from '~~/shared/openai/models';
import { resolveChatCredential } from '../../utils/ai/chat-router';
import { useRuntimeConfig } from '#imports';

const BodySchema = z.object({ workspaceId: z.string().min(1).max(200),
    model: FastModelSchema }).strict();

/** Saves the workspace fast model after checking it against its own router's catalog. */
export default defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    const context = await requireAdminApiContext(event, { ownerOnly: true, mutation: true, allowWorkspaceAdmin: true });
    const body = BodySchema.safeParse(await readLimitedJsonBody(event, 2048));
    if (!body.success) throw createError({ statusCode: 400 });
    const workspaceId = resolveAdminWorkspaceTarget(context, body.data.workspaceId);
    const config = useRuntimeConfig(event);
    const openAi = isOpenAiModel(body.data.model);
    const { apiKey } = await resolveChatCredential(event, body.data.model, context.session);
    if (openAi && !apiKey) throw createError({ statusCode: 400, statusMessage: 'Save an OpenAI key before choosing an OpenAI model.' });
    const catalog = await (openAi ? fetchOpenAiCatalog(apiKey!, config.openaiBaseUrl)
        : fetchOpenRouterCatalog(createOpenRouterClient({ apiKey, serverURL: config.openrouterBaseUrl }), undefined, { deadlineMs: 15000 }))
        .catch(() => { throw createError({ statusCode: 502, statusMessage: 'Model catalog unavailable.' }); });
    const base = openAi ? body.data.model : stripModelVariantSuffix(body.data.model);
    if (!catalog.some(model => model.id === base && (!model.architecture?.output_modalities || model.architecture.output_modalities.includes('text'))))
        throw createError({ statusCode: 400, statusMessage: 'Select a supported text model.' });
    await getWorkspaceSettingsStore(event).set(workspaceId, FAST_MODEL_SETTING, body.data.model)
        .catch(() => { throw createError({ statusCode: 503, statusMessage: 'Fast model could not be saved.' }); });
    return { model: body.data.model };
});
