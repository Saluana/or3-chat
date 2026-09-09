/**
 * Workflow image-output routing helpers.
 *
 * Background workflow execution cannot attach provider image bytes to the
 * local message file store. Keep workflows that may use an image-output model
 * on the foreground path, where the message-owned image bridge is available.
 */
import type { OpenRouterModel } from '~/core/auth/models-service';
import { getCapabilities } from '~/utils/modelCatalog';

type ModelReferenceData = {
    model?: unknown;
    modelRequest?: { models?: unknown };
};

function addModelReference(
    modelIds: string[],
    data: ModelReferenceData | null | undefined
): boolean {
    if (!data || typeof data !== 'object') return false;
    let found = false;
    if (typeof data.model === 'string' && data.model.trim()) {
        modelIds.push(data.model.trim());
        found = true;
    }
    const requestedModels = data.modelRequest?.models;
    if (Array.isArray(requestedModels)) {
        for (const model of requestedModels) {
            if (typeof model !== 'string' || !model.trim()) continue;
            modelIds.push(model.trim());
            found = true;
        }
    }
    return found;
}

function collectWorkflowModelIds(workflow: unknown): {
    modelIds: string[];
    hasUnknownModelReference: boolean;
} {
    if (!workflow || typeof workflow !== 'object') {
        return { modelIds: [], hasUnknownModelReference: true };
    }
    const nodes = (workflow as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodes)) {
        return { modelIds: [], hasUnknownModelReference: true };
    }

    const modelIds: string[] = [];
    let hasUnknownModelReference = false;
    for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const typed = node as {
            type?: string;
            data?: ModelReferenceData & {
                branches?: Array<ModelReferenceData>;
                conditionModel?: unknown;
                conditionModelRequest?: { models?: unknown };
            };
        };
        const data = typed.data;

        if (typed.type === 'subflow') {
            // The referenced graph is resolved later, so its model catalog is
            // not available at this admission boundary.
            hasUnknownModelReference = true;
            continue;
        }

        if (typed.type === 'agent' || typed.type === 'router') {
            if (!addModelReference(modelIds, data)) {
                hasUnknownModelReference = true;
            }
        }

        if (typed.type === 'parallel') {
            const hasParentModel = addModelReference(modelIds, data);
            const branches = Array.isArray(data?.branches)
                ? data.branches
                : [];
            if (!hasParentModel && branches.length === 0) {
                hasUnknownModelReference = true;
            }
            for (const branch of branches) {
                if (!addModelReference(modelIds, branch)) {
                    // A branch may inherit the parent model. Only mark it
                    // unknown when the parent did not provide one either.
                    if (!hasParentModel) {
                        hasUnknownModelReference = true;
                    }
                }
            }
        }

        if (typeof data?.conditionModel === 'string' && data.conditionModel.trim()) {
            modelIds.push(data.conditionModel.trim());
        } else if (Array.isArray(data?.conditionModelRequest?.models)) {
            for (const model of data.conditionModelRequest.models) {
                if (typeof model === 'string' && model.trim()) {
                    modelIds.push(model.trim());
                }
            }
        }
    }

    return {
        modelIds: [...new Set(modelIds)],
        hasUnknownModelReference,
    };
}

/**
 * Returns true when foreground execution is required to preserve generated
 * image attachments for this workflow.
 *
 * Missing catalog entries are treated conservatively because routing an
 * unknown model to the background path could lose image bytes permanently.
 */
export function workflowNeedsForegroundImagePersistence(
    workflow: unknown,
    catalog: readonly OpenRouterModel[]
): boolean {
    const { modelIds, hasUnknownModelReference } =
        collectWorkflowModelIds(workflow);
    if (hasUnknownModelReference) return true;

    return modelIds.some((modelId) => {
        const model = catalog.find((candidate) => candidate.id === modelId);
        return !model || getCapabilities(model).imageOutput;
    });
}
