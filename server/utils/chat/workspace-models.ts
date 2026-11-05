import type { H3Event } from 'h3';
import { createError } from 'h3';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { emptyWorkspaceModels, WorkspaceModelsSchema, WORKSPACE_MODELS_KEY, isModelHidden } from '~~/shared/ai/workspace-models';

export async function readWorkspaceModels(event: H3Event, workspaceId: string) {
    const raw = await getWorkspaceSettingsStore(event).get(workspaceId, WORKSPACE_MODELS_KEY);
    if (!raw) return emptyWorkspaceModels();
    try { return WorkspaceModelsSchema.parse(JSON.parse(raw)); }
    catch { throw createError({ statusCode: 503, statusMessage: 'Workspace model settings are unavailable.' }); }
}
export async function requireWorkspaceModel(event: H3Event, workspaceId: string, model: string) {
    if (isModelHidden(await readWorkspaceModels(event, workspaceId), model))
        throw createError({ statusCode: 403, statusMessage: 'This model is not available in this workspace. Choose another model.' });
}
