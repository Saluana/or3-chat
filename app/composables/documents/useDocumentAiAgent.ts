import { computed, readonly, ref, type Ref } from 'vue';
import type { Editor, JSONContent } from '@tiptap/core';
import { useUserApiKey } from '~/core/auth/useUserApiKey';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useTokenizer } from '~/composables/core/useTokenizer';
import { useHooks } from '~/core/hooks/useHooks';
import { openRouterStreamWithRetry } from '~/utils/chat/openrouterStream';
import type { ToolDefinition } from '~/utils/chat/types';
import type { DocumentAiScope } from '~/composables/editor/useDocumentAiActions';
import type { OpenRouterModel } from '~~/shared/openrouter/types';
import { useDocumentAiSettings } from './useDocumentAiSettings';
import {
    buildDocumentAiCandidate,
    freezeDocumentForAi,
    parseDocumentAiOperations,
    summarizeDocumentAiDiff,
    type DocumentAiDiffSummary,
    type DocumentAiFrozenSnapshot,
    type DocumentAiOperation,
} from '~/utils/documents/document-ai-operations';
import { createDocumentRevision } from '~/db/document-revisions';

const FALLBACK_DOCUMENT_MODEL = 'openai/gpt-oss-120b';

const DOCUMENT_EDIT_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'propose_document_edits',
        description: 'Propose a bounded, reviewable set of edits to the referenced document blocks.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['operations'],
            properties: {
                operations: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 32,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['kind'],
                        properties: {
                            kind: {
                                enum: [
                                    'replace_selection',
                                    'replace_block',
                                    'delete_block',
                                    'insert_before',
                                    'insert_after',
                                    'insert_end',
                                ],
                            },
                            ref: { type: 'string' },
                            content: {
                                type: 'array',
                                items: { type: 'object', additionalProperties: true },
                            },
                        },
                    },
                },
            },
        },
    },
};

export interface DocumentAiProposal {
    candidate: JSONContent;
    diff: DocumentAiDiffSummary;
    operations: DocumentAiOperation[];
    requestVersion: number;
    prompt: string;
    scope: DocumentAiScope;
}

export interface DocumentAiAttachment {
    name: string;
    mime: string;
    kind: 'image' | 'pdf';
    dataUrl: string;
}

function currentSectionBlocks(editor: Editor, snapshot: DocumentAiFrozenSnapshot) {
    let selectedIndex = 0;
    const selection = editor.state.selection.from;
    let offset = 0;
    editor.state.doc.forEach((node, position, index) => {
        const end = position + node.nodeSize;
        if (selection >= position && selection <= end) selectedIndex = index;
        offset = end;
    });
    void offset;
    let start = selectedIndex;
    while (start > 0 && snapshot.blocks[start]?.node.type !== 'heading') start -= 1;
    const startLevel = snapshot.blocks[start]?.node.type === 'heading'
        ? Number(snapshot.blocks[start]?.node.attrs?.level ?? 1)
        : 4;
    let end = snapshot.blocks.length;
    for (let index = start + 1; index < snapshot.blocks.length; index += 1) {
        const node = snapshot.blocks[index]?.node;
        if (node?.type === 'heading' && Number(node.attrs?.level ?? 1) <= startLevel) {
            end = index;
            break;
        }
    }
    return snapshot.blocks.slice(start, end);
}

function toolCapable(model: { supported_parameters?: string[] }) {
    return model.supported_parameters?.includes('tools') === true;
}

export function useDocumentAiAgent(options: {
    editor: Ref<Editor | null>;
    documentId: Ref<string>;
    title: Ref<string>;
    contentVersion: Ref<number>;
    persistCurrent: () => Promise<void>;
}) {
    const status = ref<'idle' | 'estimating' | 'streaming' | 'preview' | 'error'>('idle');
    const error = ref('');
    const tokenEstimate = ref(0);
    const proposal = ref<DocumentAiProposal | null>(null);
    const controller = ref<AbortController | null>(null);
    const { apiKey } = useUserApiKey();
    const { settings, ensureLoaded } = useDocumentAiSettings();
    const { catalog, fetchModels } = useModelStore();
    const { countTokens } = useTokenizer();
    const hooks = useHooks();

    const stale = computed(() => Boolean(
        proposal.value && proposal.value.requestVersion !== options.contentVersion.value
    ));

    async function resolveModel(attachments: readonly DocumentAiAttachment[] = []): Promise<OpenRouterModel> {
        await ensureLoaded();
        if (!catalog.value.length) await fetchModels().catch(() => []);
        let inherited = FALLBACK_DOCUMENT_MODEL;
        try {
            inherited = localStorage.getItem('last_selected_model') || inherited;
        } catch { /* localStorage may be unavailable */ }
        const preferred = settings.value.modelId || inherited;
        const needsVision = attachments.some((attachment) => attachment.kind === 'image');
        const acceptsAttachments = (model: OpenRouterModel) => !needsVision || model.architecture?.input_modalities?.includes('image') === true;
        const selected = catalog.value.find((model) => model.id === preferred && toolCapable(model) && acceptsAttachments(model)) ?? catalog.value.find((model) => toolCapable(model) && acceptsAttachments(model));
        if (catalog.value.length && !selected) {
            throw new Error(needsVision ? 'No model that supports both images and document tools is available. Choose a vision-capable model in document AI settings.' : 'No tool-capable model is available. Choose one in document AI settings.');
        }
        return (
            selected ?? {
                id: preferred,
                name: preferred,
                context_length: 32_000,
                supported_parameters: ['tools'],
            }
        );
    }

    function scopeContext(editor: Editor, snapshot: DocumentAiFrozenSnapshot, scope: DocumentAiScope) {
        if (scope === 'selection') {
            if (!snapshot.selection) throw new Error('Select text before using selection scope.');
            return {
                blocks: [] as typeof snapshot.blocks,
                text: JSON.stringify({ selection: snapshot.selection.text }),
                allowedRefs: new Set<string>(),
            };
        }
        const blocks = scope === 'document'
            ? snapshot.blocks
            : currentSectionBlocks(editor, snapshot);
        return {
            blocks,
            text: JSON.stringify(blocks.map((block) => ({
                ref: block.ref,
                type: block.type,
                text: block.text,
                node: block.node,
            }))),
            allowedRefs: new Set(blocks.map((block) => block.ref)),
        };
    }

    async function estimate(prompt: string, scope: DocumentAiScope) {
        const editor = options.editor.value;
        if (!editor) return 0;
        status.value = 'estimating';
        try {
            const snapshot = freezeDocumentForAi(editor);
            const context = scopeContext(editor, snapshot, scope);
            tokenEstimate.value = await countTokens(`${prompt}\n${context.text}`);
            return tokenEstimate.value;
        } finally {
            if (status.value === 'estimating') status.value = 'idle';
        }
    }

    async function submit(prompt: string, requestedScope: DocumentAiScope, attachments: readonly DocumentAiAttachment[] = []) {
        const editor = options.editor.value;
        if (!editor || !prompt.trim() || status.value === 'streaming') return;
        abort();
        proposal.value = null;
        error.value = '';
        const snapshot = freezeDocumentForAi(editor);
        const scope = requestedScope === 'selection' && !snapshot.selection
            ? 'section'
            : requestedScope;
        const context = scopeContext(editor, snapshot, scope);
        const model = await resolveModel(attachments);
        tokenEstimate.value = await countTokens(`${prompt}\n${context.text}`);
        const contextLimit = model.top_provider?.context_length ?? model.context_length ?? 32_000;
        if (tokenEstimate.value + 4096 > contextLimit) {
            throw new Error(`This ${scope} is too large for ${model.name ?? model.id}. Choose a larger-context model or a smaller scope.`);
        }

        let request = await hooks.applyFilters('ai.document.edit:filter:request', {
            documentId: options.documentId.value,
            modelId: model.id,
            prompt: prompt.trim(),
            scope,
            context: context.text,
            tokenEstimate: tokenEstimate.value,
        });
        const requestVersion = options.contentVersion.value;
        const abortController = new AbortController();
        controller.value = abortController;
        status.value = 'streaming';
        await hooks.doAction('ai.document.edit:action:before', request);
        try {
            let argumentsJson = '';
            for await (const event of openRouterStreamWithRetry({
                apiKey: apiKey.value,
                model: request.modelId,
                modalities: ['text'],
                signal: abortController.signal,
                maxRetries: 2,
                tools: [DOCUMENT_EDIT_TOOL],
                toolChoice: {
                    type: 'function',
                    function: { name: 'propose_document_edits' },
                },
                orMessages: [
                    {
                        role: 'system',
                        content: `${settings.value.systemInstruction}\nReturn edits only through propose_document_edits. Use only the supplied block references and valid Tiptap JSON nodes.`,
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: `Request: ${request.prompt}\nScope: ${request.scope}\nFrozen content:\n${request.context}`,
                            },
                            ...attachments.map((attachment) =>
                                attachment.kind === 'image'
                                    ? {
                                          type: 'image_url',
                                          image_url: { url: attachment.dataUrl },
                                      }
                                    : {
                                          type: 'file',
                                          file: {
                                              filename: attachment.name,
                                              file_data: attachment.dataUrl,
                                          },
                                      },
                            ),
                        ],
                    },
                ],
            })) {
                if (
                    event.type === 'tool_call'
                    && event.tool_call.function.name === 'propose_document_edits'
                ) argumentsJson = event.tool_call.function.arguments;
            }
            if (!argumentsJson) throw new Error('The model did not return a document edit proposal.');
            const operations = parseDocumentAiOperations(JSON.parse(argumentsJson));
            for (const operation of operations) {
                if (scope === 'selection' && operation.kind !== 'replace_selection') {
                    throw new Error('The model proposed edits outside the selected text.');
                }
                if ('ref' in operation && !context.allowedRefs.has(operation.ref)) {
                    throw new Error(`The model proposed an edit outside the ${scope} scope.`);
                }
                if (operation.kind === 'insert_end' && scope !== 'document') {
                    throw new Error('Insert-at-end is only available for whole-document edits.');
                }
            }
            const candidate = buildDocumentAiCandidate(editor, snapshot, operations);
            editor.schema.nodeFromJSON(candidate);
            proposal.value = {
                candidate,
                diff: summarizeDocumentAiDiff(snapshot.content, candidate),
                operations,
                requestVersion,
                prompt: request.prompt,
                scope,
            };
            status.value = 'preview';
            await hooks.doAction('ai.document.edit:action:after', {
                request,
                operationCount: operations.length,
                accepted: false,
            });
        } catch (caught) {
            if (abortController.signal.aborted) {
                status.value = 'idle';
                return;
            }
            error.value = caught instanceof Error ? caught.message : String(caught);
            status.value = 'error';
            await hooks.doAction('ai.document.edit:action:error', { request, error: caught });
        } finally {
            if (controller.value === abortController) controller.value = null;
        }
    }

    async function accept() {
        const editor = options.editor.value;
        const current = proposal.value;
        if (!editor || !current) return;
        if (stale.value) throw new Error('The document changed. Regenerate this edit from the latest version.');
        await createDocumentRevision({
            documentId: options.documentId.value,
            title: options.title.value,
            content: editor.getJSON(),
            source: 'ai',
        });
        editor.schema.nodeFromJSON(current.candidate);
        editor.commands.setContent(current.candidate, {
            emitUpdate: true,
            errorOnInvalidContent: true,
        });
        await options.persistCurrent();
        proposal.value = null;
        status.value = 'idle';
    }

    function reject() {
        proposal.value = null;
        error.value = '';
        status.value = 'idle';
    }

    function abort() {
        controller.value?.abort();
        controller.value = null;
        if (status.value === 'streaming') status.value = 'idle';
    }

    return {
        status: readonly(status),
        error: readonly(error),
        tokenEstimate: readonly(tokenEstimate),
        proposal: readonly(proposal),
        stale,
        estimate,
        submit,
        accept,
        reject,
        abort,
    };
}
