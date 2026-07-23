import { computed, readonly, ref, watch, type Ref } from 'vue';
import type { Editor, JSONContent } from '@tiptap/core';
import { useUserApiKey } from '~/core/auth/useUserApiKey';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useTokenizer } from '~/composables/core/useTokenizer';
import { useHooks } from '~/core/hooks/useHooks';
import type { DocumentAiScope } from '~/composables/editor/useDocumentAiActions';
import type { OpenRouterModel } from '~~/shared/openrouter/types';
import {
    DEFAULT_DOCUMENT_AI_MAX_ITERATIONS,
    useDocumentAiSettings,
} from './useDocumentAiSettings';
import {
    documentAiToolStatusLabel,
    runDocumentAiAgentLoop,
    type DocumentAiAgentStatusEvent,
} from './documentAiAgentLoop';
import {
    buildDocumentAiCandidate,
    freezeDocumentForAi,
    summarizeDocumentAiDiff,
    type DocumentAiDiffSummary,
    type DocumentAiFrozenSnapshot,
    type DocumentAiOperation,
} from '~/utils/documents/document-ai-operations';
import {
    buildDocumentOutline,
    chunkDocumentBlocks,
    clampDocumentAiChunkWords,
    serializeBlocksForModel,
    summarizeOutlineForPrompt,
} from '~/utils/documents/document-ai-index';
import { resolveDocumentAiToolsForRun } from '~/utils/documents/document-ai-registry-tools';
import {
    validateDocumentAiAttachments,
    type DocumentAiAttachment,
} from '~/utils/documents/document-ai-attachments';
import { resolveDocumentAiScopeRange } from '~/utils/documents/document-ai-scope';
import {
    canClearStatusAfterAbort,
    createAcceptQueue,
    createDocumentAiRunGeneration,
    proposalStillOwned as proposalIdentityOwned,
    shouldLockDocumentAiEditor,
} from './documentAiLifecycle';
import {
    acceptedDocumentAiOperations,
    applyDocumentAiOperationLive,
    createDocumentAiHunks,
    pendingDocumentAiOperations,
    type DocumentAiHunk,
} from '~/utils/documents/document-ai-hunks';
import { createDocumentRevision } from '~/db/document-revisions';
import {
    formatDocumentAiReferenceContext,
    resolveDocumentAiReference,
    uniqueDocumentAiReferences,
    type DocumentAiContextReference,
} from '~/utils/documents/document-ai-context';
import {
    FALLBACK_DOCUMENT_MODEL,
    buildDocumentAiSystemPrompt,
    isForcedToolThinkingConflict,
    resolveDocumentAiToolStreamOptions,
} from '~/core/documents/document-ai-agent-policy';

export {
    DOCUMENT_AI_WORKFLOW_INSTRUCTION,
    DOCUMENT_EDIT_TOOL,
    buildDocumentAiSystemPrompt,
    isForcedToolThinkingConflict,
    modelLikelyEnablesThinking,
    resolveDocumentAiToolStreamOptions,
} from '~/core/documents/document-ai-agent-policy';

export interface DocumentAiProposal {
    documentId: string;
    candidate: JSONContent;
    diff: DocumentAiDiffSummary;
    operations: DocumentAiOperation[];
    hunks: DocumentAiHunk[];
    snapshot: DocumentAiFrozenSnapshot;
    requestVersion: number;
    prompt: string;
    scope: DocumentAiScope;
}

export type { DocumentAiAttachment };

export interface DocumentAiEstimateRequest {
    prompt: string;
    scope: DocumentAiScope;
    references: DocumentAiContextReference[];
}

export interface DocumentAiSubmission extends DocumentAiEstimateRequest {
    attachments: DocumentAiAttachment[];
}

function currentSectionBlocks(editor: Editor, snapshot: DocumentAiFrozenSnapshot) {
    let selectedIndex = 0;
    const selection = editor.state.selection.from;
    editor.state.doc.forEach((node, position, index) => {
        const end = position + node.nodeSize;
        if (selection >= position && selection <= end) selectedIndex = index;
    });
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

function seedEditableContext(
    editor: Editor,
    snapshot: DocumentAiFrozenSnapshot,
    scope: DocumentAiScope,
    chunkWordLimit: number,
) {
    if (scope === 'selection') {
        if (!snapshot.selection) throw new Error('Select text before using selection scope.');
        return {
            blocks: [] as typeof snapshot.blocks,
            allowedRefs: new Set<string>(),
            seedText: JSON.stringify({
                selection: {
                    text: snapshot.selection.text,
                    content: snapshot.selection.content,
                    openStart: snapshot.selection.openStart,
                    openEnd: snapshot.selection.openEnd,
                },
                note: 'Call propose_edits with a single replace_selection. Return TipTap JSON that preserves marks and the same block/inline shape as selection.content.',
            }),
        };
    }

    const blocks = scope === 'document'
        ? snapshot.blocks
        : currentSectionBlocks(editor, snapshot);
    const allowedRefs = new Set(blocks.map((block) => block.ref));
    const outline = buildDocumentOutline(snapshot, allowedRefs);
    const limit = clampDocumentAiChunkWords(chunkWordLimit);
    const chunks = chunkDocumentBlocks(blocks, limit).map((chunk) => ({
        index: chunk.index,
        fromRef: chunk.fromRef,
        toRef: chunk.toRef,
        wordCount: chunk.wordCount,
        blockCount: chunk.blocks.length,
    }));

    // Small sections still fit in the seed; large scopes get outline + chunk map only.
    const totalWords = blocks.reduce((total, block) => {
        const words = block.text.trim() ? block.text.trim().split(/\s+/u).length : 0;
        return total + words;
    }, 0);
    const isEmptyDocument = totalWords === 0;
    const includeInlineBlocks = totalWords <= limit && blocks.length <= 80;

    return {
        blocks,
        allowedRefs,
        seedText: JSON.stringify({
            scope,
            chunkWordLimit: limit,
            outlineSummary: summarizeOutlineForPrompt(outline),
            chunks,
            editableBlocks: includeInlineBlocks ? serializeBlocksForModel(blocks) : undefined,
            emptyDocument: isEmptyDocument,
            note: isEmptyDocument
                ? 'Document is empty. Create the article with propose_edits using insert_end and/or replace_block on b1. Do not stall on outline/search.'
                : includeInlineBlocks
                    ? 'Editable blocks are included below. You may still use tools, then propose_edits.'
                    : 'Document is large. Use list_document_chunks / read_blocks before propose_edits.',
        }),
    };
}

function syncHunkDecorations(
    editor: Editor | null,
    proposal: DocumentAiProposal | null,
    activeHunkId?: string | null,
) {
    if (!editor || editor.isDestroyed) return;
    if (!proposal) {
        editor.commands.clearDocumentAiHunks?.();
        return;
    }
    const pendingId = activeHunkId
        ?? proposal.hunks.find((hunk) => hunk.status === 'pending')?.id
        ?? null;
    editor.commands.setDocumentAiHunks?.({
        hunks: proposal.hunks,
        snapshot: proposal.snapshot,
        activeHunkId: pendingId,
    });
}

type EstimateSeedCache = {
    documentId: string;
    contentVersion: number;
    scope: DocumentAiScope;
    scopeKey: string;
    chunkWordLimit: number;
    seedText: string;
};

function estimateScopeKey(editor: Editor, scope: DocumentAiScope): string {
    if (scope === 'document') return 'document';
    if (scope === 'selection') {
        const { from, to, empty } = editor.state.selection;
        return empty ? 'selection:empty' : `selection:${from}:${to}`;
    }
    const range = resolveDocumentAiScopeRange(editor, 'section');
    return range ? `section:${range.from}:${range.to}` : 'section:none';
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
    const agentStatus = ref('');
    const controller = ref<AbortController | null>(null);
    const checkpointCreated = ref(false);
    const accepting = ref(false);
    const lastScope = ref<DocumentAiScope>('section');
    /** Composer-driven scope chrome; off until estimate/submit explicitly shows it. */
    let scopeHighlightActive = false;
    let estimateSeedCache: EstimateSeedCache | null = null;
    /** Bumped on abort/reset/new submit so older runs cannot stomp status. */
    const runControl = createDocumentAiRunGeneration();
    const acceptControl = createAcceptQueue();
    const { apiKey } = useUserApiKey();
    const { settings, ensureLoaded } = useDocumentAiSettings();
    const { catalog, fetchModels } = useModelStore();
    const { countTokens } = useTokenizer();
    const hooks = useHooks();
    const referenceContextCache = new Map<string, string>();

    const stale = computed(() => Boolean(
        proposal.value && (
            proposal.value.documentId !== options.documentId.value
            || proposal.value.requestVersion !== options.contentVersion.value
        )
    ));

    // Drop inline review widgets when the freeze is invalidated; keep the bar
    // so the user can regenerate. Skip while accepting — live apply bumps
    // contentVersion before we retarget requestVersion.
    watch(stale, (isStale) => {
        if (!isStale || accepting.value) return;
        syncHunkDecorations(options.editor.value, null);
    });

    const pendingHunkCount = computed(
        () => proposal.value?.hunks.filter((hunk) => hunk.status === 'pending').length ?? 0,
    );
    const focusedHunkId = ref<string | null>(null);

    function setEditorEditable(editable: boolean) {
        const editor = options.editor.value;
        if (!editor || editor.isDestroyed) return;
        if (editor.isEditable === editable) return;
        // TipTap's setEditable emits "update" by default even though the doc
        // did not change — that falsely bumps contentVersion and marks proposals stale.
        editor.setEditable(editable, false);
    }

    function syncEditorLock() {
        setEditorEditable(!shouldLockDocumentAiEditor({
            status: status.value,
            accepting: accepting.value,
        }));
    }

    /**
     * Scope highlight is opt-in composer chrome — not permanent document styling.
     * - `show`: paint after estimate/submit while composing
     * - `refresh`: update caret-relative range only if already showing
     * - `clear`: hide (open doc / reject / accept-done / reset)
     */
    function syncScopeHighlight(
        scope?: DocumentAiScope,
        mode: 'show' | 'refresh' | 'clear' = 'refresh',
    ) {
        const editor = options.editor.value;
        if (!editor || editor.isDestroyed) return;
        if (scope) lastScope.value = scope;

        if (mode === 'clear') {
            scopeHighlightActive = false;
            editor.commands.setDocumentAiScopeRange?.(null);
            return;
        }
        if (mode === 'show') scopeHighlightActive = true;

        if (
            !scopeHighlightActive
            || status.value === 'streaming'
            || status.value === 'preview'
            || Boolean(proposal.value)
        ) {
            editor.commands.setDocumentAiScopeRange?.(null);
            return;
        }
        const range = resolveDocumentAiScopeRange(editor, lastScope.value);
        editor.commands.setDocumentAiScopeRange?.(range);
    }

    function clearScopeHighlight() {
        syncScopeHighlight(undefined, 'clear');
    }

    function invalidateEstimateCache() {
        estimateSeedCache = null;
    }

    function enqueueAccept(work: () => Promise<void>): Promise<void> {
        return acceptControl.enqueue(async () => {
            accepting.value = true;
            syncEditorLock();
            try {
                await work();
            } catch (caught) {
                error.value = caught instanceof Error ? caught.message : String(caught);
                throw caught;
            } finally {
                accepting.value = false;
                syncEditorLock();
                // Never re-paint scope chrome after accept; review is done or still locked.
                clearScopeHighlight();
            }
        });
    }

    function assertAcceptableProposal(current: DocumentAiProposal) {
        if (current.documentId !== options.documentId.value) {
            reject();
            throw new Error('This proposal belongs to a different document.');
        }
        if (stale.value) {
            throw new Error('The document changed. Regenerate this edit from the latest version.');
        }
    }

    function proposalStillOwned(current: DocumentAiProposal): boolean {
        return proposalIdentityOwned({
            proposal: proposal.value,
            current,
            documentId: options.documentId.value,
        });
    }

    function bindHunkHandlers(editor: Editor) {
        editor.commands.setDocumentAiHunkHandlers?.({
            onAcceptHunk: (hunkId) => {
                if (accepting.value) return;
                if (stale.value) {
                    error.value = 'The document changed. Regenerate this edit from the latest version.';
                    return;
                }
                void acceptHunk(hunkId).catch((caught) => {
                    error.value = caught instanceof Error ? caught.message : String(caught);
                });
            },
            onDiscardHunk: (hunkId) => {
                if (accepting.value) return;
                discardHunk(hunkId);
            },
            onFocusHunk: (hunkId) => {
                if (accepting.value) return;
                focusHunk(hunkId);
            },
        });
    }

    function onAgentStatus(event: DocumentAiAgentStatusEvent) {
        switch (event.type) {
            case 'iteration':
                agentStatus.value = `Thinking (step ${event.iteration}/${event.maxIterations})…`;
                break;
            case 'tool_start':
                agentStatus.value = `${documentAiToolStatusLabel(event.name)}…`;
                break;
            case 'tool_end':
                if (!event.ok && event.detail) {
                    agentStatus.value = `${documentAiToolStatusLabel(event.name)} failed`;
                }
                break;
            case 'staged':
                agentStatus.value = `Staged ${event.totalStaged} edit${event.totalStaged === 1 ? '' : 's'}…`;
                break;
            case 'done':
                agentStatus.value = event.totalStaged
                    ? `Ready · ${event.totalStaged} edit${event.totalStaged === 1 ? '' : 's'}`
                    : 'Finished without edits';
                break;
            default: {
                const _exhaustive: never = event;
                void _exhaustive;
            }
        }
    }

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

    async function referenceContext(
        references: readonly DocumentAiContextReference[],
        fresh = false,
    ) {
        const unique = uniqueDocumentAiReferences(references);
        const currentDocument = unique.find(
            (reference) => reference.source === 'document' && reference.id === options.documentId.value,
        );
        if (currentDocument) {
            throw new Error('The current document is already included. Remove it from referenced context.');
        }

        const resolved = await Promise.all(unique.map(async (reference) => {
            const key = `${reference.source}:${reference.id}`;
            const cached = fresh ? undefined : referenceContextCache.get(key);
            const content = cached ?? await resolveDocumentAiReference(reference);
            if (content) referenceContextCache.set(key, content);
            return content ? { reference, content } : null;
        }));
        const missing = unique.filter((_, index) => !resolved[index]);
        if (missing.length) {
            const labels = missing.map((reference) => `“${reference.label}”`).join(', ');
            throw new Error(`Could not load referenced context ${labels}. Remove it or choose it again.`);
        }
        return formatDocumentAiReferenceContext(
            resolved.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
        );
    }

    async function estimate(request: DocumentAiEstimateRequest) {
        const editor = options.editor.value;
        if (!editor) return 0;
        // Never let estimate stomp an in-flight agent run / preview.
        if (status.value === 'streaming' || status.value === 'preview') return tokenEstimate.value;
        status.value = 'estimating';
        try {
            await ensureLoaded();
            lastScope.value = request.scope;
            // Do not paint scope chrome while typing — the composer already labels
            // the active scope; block highlights made the whole section look selected.
            clearScopeHighlight();
            const chunkWordLimit = settings.value.chunkWordLimit;
            const version = options.contentVersion.value;
            const documentId = options.documentId.value;
            const scopeKey = estimateScopeKey(editor, request.scope);
            let seedText = '';
            const cacheHit = estimateSeedCache
                && estimateSeedCache.documentId === documentId
                && estimateSeedCache.contentVersion === version
                && estimateSeedCache.scope === request.scope
                && estimateSeedCache.scopeKey === scopeKey
                && estimateSeedCache.chunkWordLimit === chunkWordLimit;
            if (cacheHit && estimateSeedCache) {
                seedText = estimateSeedCache.seedText;
            } else {
                const snapshot = freezeDocumentForAi(editor);
                const context = seedEditableContext(
                    editor,
                    snapshot,
                    request.scope,
                    chunkWordLimit,
                );
                seedText = context.seedText;
                estimateSeedCache = {
                    documentId,
                    contentVersion: version,
                    scope: request.scope,
                    scopeKey,
                    chunkWordLimit,
                    seedText,
                };
            }
            const references = await referenceContext(request.references);
            tokenEstimate.value = await countTokens(`${request.prompt}\n${seedText}\n${references}`);
            if (status.value === 'estimating') error.value = '';
            return tokenEstimate.value;
        } catch (caught) {
            if (status.value === 'estimating') {
                error.value = caught instanceof Error ? caught.message : String(caught);
            }
            return 0;
        } finally {
            if (status.value === 'estimating') status.value = 'idle';
        }
    }

    async function ensureAiCheckpoint(editor: Editor) {
        if (checkpointCreated.value) return;
        await createDocumentRevision({
            documentId: options.documentId.value,
            title: options.title.value,
            content: editor.getJSON(),
            source: 'ai',
        });
        checkpointCreated.value = true;
    }

    async function submit(submission: DocumentAiSubmission) {
        const editor = options.editor.value;
        if (!editor || !submission.prompt.trim() || status.value === 'streaming') return;
        const submitDocumentId = options.documentId.value;
        abort();
        // New generation after abort so this submit owns status transitions.
        const myGeneration = runControl.bump();
        proposal.value = null;
        focusedHunkId.value = null;
        syncHunkDecorations(editor, null);
        error.value = '';
        agentStatus.value = '';
        checkpointCreated.value = false;
        invalidateEstimateCache();
        bindHunkHandlers(editor);

        let attachments: DocumentAiAttachment[];
        try {
            attachments = validateDocumentAiAttachments(submission.attachments);
        } catch (caught) {
            error.value = caught instanceof Error ? caught.message : String(caught);
            status.value = 'error';
            syncEditorLock();
            return;
        }

        const snapshot = freezeDocumentForAi(editor);
        const scope = submission.scope === 'selection' && !snapshot.selection
            ? 'section'
            : submission.scope;
        lastScope.value = scope;
        clearScopeHighlight();
        await ensureLoaded();
        if (!runControl.isCurrent(myGeneration)) return;
        const context = seedEditableContext(
            editor,
            snapshot,
            scope,
            settings.value.chunkWordLimit,
        );
        let references = '';
        let model: OpenRouterModel;
        try {
            references = await referenceContext(submission.references, true);
            model = await resolveModel(attachments);
        } catch (caught) {
            if (!runControl.isCurrent(myGeneration)) return;
            error.value = caught instanceof Error ? caught.message : String(caught);
            status.value = 'error';
            syncEditorLock();
            return;
        }
        if (!runControl.isCurrent(myGeneration) || options.documentId.value !== submitDocumentId) return;

        const tools = resolveDocumentAiToolsForRun(settings.value.enabledTools);
        if (!tools.length) {
            error.value = 'Enable at least one tool in Document AI settings.';
            status.value = 'error';
            return;
        }
        if (!tools.some((tool) => tool.function.name === 'propose_edits')) {
            error.value = 'Enable “Propose edits” in Document AI settings to stage document changes.';
            status.value = 'error';
            return;
        }

        tokenEstimate.value = await countTokens(`${submission.prompt}\n${context.seedText}\n${references}`);
        if (!runControl.isCurrent(myGeneration)) return;
        const contextLimit = model.top_provider?.context_length ?? model.context_length ?? 32_000;
        if (tokenEstimate.value + 4096 > contextLimit) {
            error.value = `This ${scope} is too large for ${model.name ?? model.id}. Choose a larger-context model or a smaller scope.`;
            status.value = 'error';
            return;
        }

        let request = await hooks.applyFilters('ai.document.edit:filter:request', {
            documentId: submitDocumentId,
            modelId: model.id,
            prompt: submission.prompt.trim(),
            scope,
            context: context.seedText,
            references: uniqueDocumentAiReferences(submission.references),
            referenceContext: references,
            tokenEstimate: tokenEstimate.value,
            maxIterations: settings.value.maxIterations ?? DEFAULT_DOCUMENT_AI_MAX_ITERATIONS,
            chunkWordLimit: settings.value.chunkWordLimit,
        });
        if (!runControl.isCurrent(myGeneration) || options.documentId.value !== submitDocumentId) return;
        const abortController = new AbortController();
        controller.value = abortController;
        status.value = 'streaming';
        agentStatus.value = 'Starting…';
        clearScopeHighlight();
        syncEditorLock();
        await hooks.doAction('ai.document.edit:action:before', request);
        try {
            const streamOptions = resolveDocumentAiToolStreamOptions(model);
            const orMessages = [
                {
                    role: 'system' as const,
                    content: buildDocumentAiSystemPrompt(settings.value.systemInstruction),
                },
                {
                    role: 'user' as const,
                    content: [
                        {
                            type: 'text' as const,
                            text: `Request:\n${request.prompt}\n\nScope:\n${request.scope}\n\nEditable frozen context (outline/chunks; use tools to read more):\n${request.context}\n\nRead-only reference context:\n${request.referenceContext || '(none)'}`,
                        },
                        ...attachments.map((attachment) =>
                            attachment.kind === 'image'
                                ? {
                                      type: 'image_url' as const,
                                      image_url: { url: attachment.dataUrl },
                                  }
                                : {
                                      type: 'file' as const,
                                      file: {
                                          filename: attachment.name,
                                          file_data: attachment.dataUrl,
                                      },
                                  },
                        ),
                    ],
                },
            ];

            const { operations } = await runDocumentAiAgentLoop({
                apiKey: apiKey.value,
                modelId: request.modelId,
                orMessages,
                signal: abortController.signal,
                maxIterations: settings.value.maxIterations,
                maxContextTokens: contextLimit,
                tools,
                enabledTools: settings.value.enabledTools,
                toolChoice: streamOptions.toolChoice,
                reasoning: streamOptions.reasoning,
                onStatus: onAgentStatus,
                toolContext: {
                    editor,
                    snapshot,
                    scope,
                    allowedRefs: context.allowedRefs,
                    chunkWordLimit: settings.value.chunkWordLimit,
                },
            });

            if (
                !runControl.isCurrent(myGeneration)
                || options.documentId.value !== submitDocumentId
                || abortController.signal.aborted
            ) {
                return;
            }

            if (!operations.length) {
                throw new Error('The model did not stage any document edits.');
            }

            const candidate = buildDocumentAiCandidate(editor, snapshot, operations);
            editor.schema.nodeFromJSON(candidate);
            const hunks = createDocumentAiHunks(operations, snapshot);
            // Capture after lock/stream side-effects so soft-lock cannot mark us stale.
            const requestVersion = options.contentVersion.value;
            const nextProposal: DocumentAiProposal = {
                documentId: submitDocumentId,
                candidate,
                diff: summarizeDocumentAiDiff(snapshot.content, candidate),
                operations,
                hunks,
                snapshot,
                requestVersion,
                prompt: request.prompt,
                scope,
            };
            proposal.value = nextProposal;
            focusedHunkId.value = hunks[0]?.id ?? null;
            syncHunkDecorations(editor, nextProposal, focusedHunkId.value);
            status.value = 'preview';
            syncEditorLock();
            clearScopeHighlight();
            if (focusedHunkId.value) focusHunk(focusedHunkId.value);
            await hooks.doAction('ai.document.edit:action:after', {
                request,
                operationCount: operations.length,
                accepted: false,
            });
        } catch (caught) {
            if (!runControl.isCurrent(myGeneration)) return;
            if (abortController.signal.aborted) {
                if (canClearStatusAfterAbort({
                    myGeneration,
                    runGeneration: runControl.current(),
                    status: status.value,
                })) {
                    status.value = 'idle';
                    agentStatus.value = '';
                    syncEditorLock();
                }
                return;
            }
            error.value = caught instanceof Error ? caught.message : String(caught);
            status.value = 'error';
            syncEditorLock();
            await hooks.doAction('ai.document.edit:action:error', { request, error: caught });
        } finally {
            if (controller.value === abortController) controller.value = null;
            if (runControl.isCurrent(myGeneration) && status.value === 'streaming') {
                // Loop ended without preview/error transition (shouldn't happen often).
                status.value = 'idle';
                syncEditorLock();
            }
        }
    }

    async function accept() {
        return enqueueAccept(async () => {
            const editor = options.editor.value;
            const current = proposal.value;
            if (!editor || !current) return;
            assertAcceptableProposal(current);
            const operations = current.hunks
                .filter((hunk) => hunk.status === 'accepted' || hunk.status === 'pending')
                .map((hunk) => hunk.op);
            if (!operations.length) {
                reject();
                return;
            }
            await ensureAiCheckpoint(editor);
            if (!proposalStillOwned(current) || stale.value) return;
            const candidate = buildDocumentAiCandidate(editor, current.snapshot, operations);
            editor.schema.nodeFromJSON(candidate);
            editor.commands.setContent(candidate, {
                emitUpdate: true,
                errorOnInvalidContent: true,
            });
            await options.persistCurrent();
            if (!proposalStillOwned(current)) return;
            proposal.value = null;
            focusedHunkId.value = null;
            syncHunkDecorations(editor, null);
            status.value = 'idle';
            agentStatus.value = '';
            checkpointCreated.value = false;
        });
    }

    async function acceptHunk(hunkId: string) {
        return enqueueAccept(async () => {
            const editor = options.editor.value;
            const current = proposal.value;
            if (!editor || !current) return;
            assertAcceptableProposal(current);
            const hunk = current.hunks.find((entry) => entry.id === hunkId);
            if (!hunk || hunk.status !== 'pending') return;

            await ensureAiCheckpoint(editor);
            if (proposal.value !== current || stale.value) return;

            const nextHunks = current.hunks.map((entry) => (
                entry.id === hunkId ? { ...entry, status: 'accepted' as const } : entry
            ));
            const accepted = acceptedDocumentAiOperations(nextHunks);
            const pending = pendingDocumentAiOperations(nextHunks);
            const nextActiveId = nextHunks.find((entry) => entry.status === 'pending')?.id ?? null;
            focusedHunkId.value = nextActiveId;

            // Close this card / activate the next one BEFORE mutating the doc.
            // Otherwise mapped decorations keep the accepted review widget on screen.
            const interim: DocumentAiProposal = {
                ...current,
                hunks: nextHunks,
                operations: [...accepted, ...pending],
                candidate: current.candidate,
                diff: current.diff,
            };
            proposal.value = interim;
            syncHunkDecorations(editor, pending.length ? interim : null, nextActiveId);

            const acceptedBefore = acceptedDocumentAiOperations(current.hunks);
            applyDocumentAiOperationLive(editor, current.snapshot, acceptedBefore, hunk.op);
            const versionAfterAccept = options.contentVersion.value;
            if (proposal.value === interim) {
                proposal.value = { ...interim, requestVersion: versionAfterAccept };
            }
            await options.persistCurrent();
            if (proposal.value?.documentId !== current.documentId) return;

            if (!pending.length) {
                proposal.value = null;
                focusedHunkId.value = null;
                syncHunkDecorations(editor, null);
                status.value = 'idle';
                agentStatus.value = '';
                checkpointCreated.value = false;
                return;
            }

            const previewOps = [...accepted, ...pending];
            const preview = buildDocumentAiCandidate(editor, current.snapshot, previewOps);
            const next: DocumentAiProposal = {
                ...current,
                hunks: nextHunks,
                operations: previewOps,
                candidate: preview,
                diff: summarizeDocumentAiDiff(current.snapshot.content, preview),
                requestVersion: options.contentVersion.value,
            };
            proposal.value = next;
            syncHunkDecorations(editor, next, nextActiveId);
            status.value = 'preview';
            if (nextActiveId) focusHunk(nextActiveId);
        });
    }

    function discardHunk(hunkId: string) {
        const editor = options.editor.value;
        const current = proposal.value;
        if (!editor || !current) return;
        const nextHunks = current.hunks.map((entry) => (
            entry.id === hunkId ? { ...entry, status: 'discarded' as const } : entry
        ));
        const next: DocumentAiProposal = { ...current, hunks: nextHunks };
        proposal.value = next;
        const pendingOps = pendingDocumentAiOperations(nextHunks);
        const acceptedOps = acceptedDocumentAiOperations(nextHunks);
        const nextActiveId = nextHunks.find((entry) => entry.status === 'pending')?.id ?? null;
        focusedHunkId.value = nextActiveId;
        if (!pendingOps.length && !acceptedOps.length) {
            reject();
            return;
        }
        if (!pendingOps.length) {
            // All remaining were discarded; live doc already reflects accepted hunks.
            proposal.value = null;
            focusedHunkId.value = null;
            syncHunkDecorations(editor, null);
            status.value = 'idle';
            agentStatus.value = '';
            checkpointCreated.value = false;
            syncEditorLock();
            return;
        }
        const applied = [...acceptedOps, ...pendingOps];
        const candidate = buildDocumentAiCandidate(editor, current.snapshot, applied);
        proposal.value = {
            ...next,
            operations: applied,
            candidate,
            diff: summarizeDocumentAiDiff(current.snapshot.content, candidate),
        };
        syncHunkDecorations(editor, proposal.value, nextActiveId);
        if (nextActiveId) focusHunk(nextActiveId);
    }

    function reject() {
        const editor = options.editor.value;
        proposal.value = null;
        focusedHunkId.value = null;
        syncHunkDecorations(editor, null);
        error.value = '';
        status.value = 'idle';
        agentStatus.value = '';
        checkpointCreated.value = false;
        referenceContextCache.clear();
        syncEditorLock();
        clearScopeHighlight();
    }

    function abort() {
        runControl.bump();
        controller.value?.abort();
        controller.value = null;
        // Only clear streaming — never stomp an unrelated preview/error state.
        if (status.value === 'streaming') {
            status.value = 'idle';
            agentStatus.value = '';
            syncEditorLock();
            clearScopeHighlight();
        }
    }

    /** Abort in-flight work and clear any preview when switching documents. */
    function reset() {
        abort();
        reject();
        referenceContextCache.clear();
        invalidateEstimateCache();
        lastScope.value = 'section';
        clearScopeHighlight();
    }

    function focusHunk(hunkId: string) {
        const editor = options.editor.value;
        if (!editor || !proposal.value) return;
        focusedHunkId.value = hunkId;
        editor.commands.setActiveDocumentAiHunk?.(hunkId);
        // Wait for the decoration refresh to mount the next card/marker before scrolling.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const node = editor.view.dom.querySelector(
                    `[data-hunk-id="${CSS.escape(hunkId)}"]`,
                );
                node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            });
        });
    }

    function focusNextHunk(delta: 1 | -1) {
        const current = proposal.value;
        if (!current) return;
        const pending = current.hunks.filter((hunk) => hunk.status === 'pending');
        if (!pending.length) return;
        const activeId = focusedHunkId.value
            ?? pending[0]?.id
            ?? null;
        const index = Math.max(0, pending.findIndex((hunk) => hunk.id === activeId));
        const next = pending[(index + delta + pending.length) % pending.length];
        if (next) focusHunk(next.id);
    }

    return {
        status: readonly(status),
        error: readonly(error),
        tokenEstimate: readonly(tokenEstimate),
        proposal: readonly(proposal),
        agentStatus: readonly(agentStatus),
        pendingHunkCount,
        focusedHunkId: readonly(focusedHunkId),
        stale,
        accepting: readonly(accepting),
        estimate,
        submit,
        accept,
        acceptHunk,
        discardHunk,
        reject,
        abort,
        reset,
        focusHunk,
        focusNextHunk,
        syncScopeHighlight,
        clearScopeHighlight,
    };
}
