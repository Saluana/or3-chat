import { z } from 'zod';
import { openRouterCatalogLookupId } from '../openrouter/selection';

export const WORKSPACE_MODELS_KEY = 'chat.models';
const modelId = z.string().trim().min(1).max(256);
export const WorkspaceModelsSchema = z.object({
    hidden: z.array(modelId).max(1000),
    pinned: z.array(modelId).max(30),
    defaultModel: modelId.nullable(),
}).strict().refine(value => !value.pinned.some(id => isModelHidden(value, id))
    && (!value.defaultModel || !isModelHidden(value, value.defaultModel)), 'A hidden model cannot be pinned or the default.');
export type WorkspaceModels = z.infer<typeof WorkspaceModelsSchema>;
export function emptyWorkspaceModels(): WorkspaceModels { return { hidden: [], pinned: [], defaultModel: null }; }
export function isModelHidden(policy: { hidden: string[] }, id: string): boolean {
    return policy.hidden.some(hidden => openRouterCatalogLookupId(hidden) === openRouterCatalogLookupId(id));
}
