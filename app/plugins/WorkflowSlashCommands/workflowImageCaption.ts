/**
 * Determines when workflow images need a text fallback and generates it.
 */
import { useModelStore } from '#imports';
import { modelRegistry, type Attachment } from 'or3-workflow-core';

function collectWorkflowModelIds(workflow: unknown): {
    modelIds: string[];
    hasMissingModel: boolean;
} {
    if (!workflow || typeof workflow !== 'object') {
        return { modelIds: [], hasMissingModel: true };
    }
    const nodes = (workflow as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodes)) {
        return { modelIds: [], hasMissingModel: true };
    }

    const modelIds: string[] = [];
    let hasMissingModel = false;
    for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const typed = node as {
            type?: string;
            data?: {
                model?: unknown;
                branches?: Array<{ model?: unknown }>;
            };
        };
        const data = typed.data ?? {};
        const model =
            typeof data.model === 'string' && data.model.trim()
                ? data.model.trim()
                : null;

        if (typed.type === 'agent' || typed.type === 'router') {
            if (model) modelIds.push(model);
            else hasMissingModel = true;
        } else if (typed.type === 'parallel') {
            if (model) modelIds.push(model);
            for (const branch of data.branches ?? []) {
                const branchModel =
                    typeof branch.model === 'string' && branch.model.trim()
                        ? branch.model.trim()
                        : null;
                if (branchModel) modelIds.push(branchModel);
                else if (!model) hasMissingModel = true;
            }
        } else if (typed.type === 'subflow') {
            hasMissingModel = true;
        }
    }
    return { modelIds, hasMissingModel };
}

export async function shouldGenerateCaption(
    workflow: unknown,
    attachments: Attachment[] | undefined
): Promise<boolean> {
    if (!attachments?.some((attachment) => attachment.type === 'image')) {
        return false;
    }

    const { modelIds, hasMissingModel } = collectWorkflowModelIds(workflow);
    if (hasMissingModel || modelIds.length === 0) return true;

    const { catalog, fetchModels } = useModelStore();
    let modelList = catalog.value;
    if (!modelList.length) {
        try {
            modelList = await fetchModels({ ttlMs: 60 * 60 * 1000 });
        } catch {
            return true;
        }
    }
    if (!modelList.length) return true;

    const modalitiesByModel = new Map(
        modelList.map((model) => [
            model.id,
            Array.isArray(model.architecture?.input_modalities)
                ? model.architecture.input_modalities.map((modality) =>
                      String(modality).toLowerCase()
                  )
                : [],
        ])
    );
    return modelIds.some((modelId) => {
        const modalities = modalitiesByModel.get(modelId);
        return modalities
            ? !modalities.includes('image')
            : !modelRegistry.supportsInputModality(modelId, 'image');
    });
}

function attachmentUrl(attachment: Attachment): string | null {
    if (attachment.url) return attachment.url;
    return attachment.content
        ? `data:${attachment.mimeType};base64,${attachment.content}`
        : null;
}

function extractText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map((part) => {
            if (!part || typeof part !== 'object') return '';
            const text = (part as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
        })
        .join('')
        .trim();
}

export async function generateImageCaption(
    attachments: Attachment[],
    apiKey: string
): Promise<string | null> {
    const modelId = modelRegistry.getVisionModels()[0]?.id;
    if (!modelId) return null;

    const imageParts = attachments
        .filter((attachment) => attachment.type === 'image')
        .map(attachmentUrl)
        .filter((url): url is string => Boolean(url))
        .map((url) => ({
            type: 'image_url' as const,
            imageUrl: { url },
        }));
    if (!imageParts.length) return null;

    const { createOpenRouterClient, wrapLegacyChatSendArgs } = await import(
        '~~/shared/openrouter'
    );
    const result = await createOpenRouterClient({ apiKey }).chat.send(
        wrapLegacyChatSendArgs({
            model: modelId,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Provide a concise, plain-text description of the image(s) for downstream text-only models.',
                        },
                        ...imageParts,
                    ],
                },
            ],
            stream: false as const,
        })
    );
    const caption = extractText(
        (result as {
            choices?: Array<{ message?: { content?: unknown } }>;
        }).choices?.[0]?.message?.content
    );
    return caption ? caption.slice(0, 1000) : null;
}
