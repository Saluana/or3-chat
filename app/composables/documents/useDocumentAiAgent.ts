import { createRuntimeUuid } from '~~/shared/runtime-id';
import { computed, onScopeDispose, readonly, ref, toRaw, watch, type Ref } from 'vue';
import { useOnline } from '@vueuse/core';
import type { Editor, JSONContent } from '@tiptap/core';

import { useUserApiKey } from '~/core/auth/useUserApiKey';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useTokenizer } from '~/composables/core/useTokenizer';
import { useHooks } from '~/core/hooks/useHooks';
import type { DocumentAiEditRequestPayload } from '~/core/hooks/hook-types';
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
    countWords,
    serializeBlocksForModel,
    summarizeOutlineForPrompt,
} from '~/utils/documents/document-ai-index';
import { resolveDocumentAiToolsForRun } from '~/utils/documents/document-ai-registry-tools';
import {
    executeDocumentAiTool,
    isDocumentAiNativeTool,
} from '~/utils/documents/document-ai-tools';
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
import { getDb, getWorkspaceGeneration } from '~/db/client';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
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

// These commands exist only while the Document AI extension is installed.
function documentAiCommands(editor: Editor): Partial<Editor['commands']> {
    return editor.commands;
}

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
    /** Content is applied; acceptance retries only its local save. */
    applied?: boolean;
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

const AUTO_FOCUS_CONTEXT_WORDS = 1_800;

/**
 * The composer no longer asks people to choose a scope. A real selection is a
 * strict edit target; otherwise the agent may edit the document, using the
 * caret block as its default anchor.
 */
export function resolveAutomaticDocumentAiScope(editor: Editor): DocumentAiScope {
    return editor.state.selection.empty ? 'document' : 'selection';
}

export function resolveDocumentAiCursorBlockIndex(
    editor: Editor,
    snapshot: DocumentAiFrozenSnapshot,
): number {
    if (!snapshot.blocks.length) return -1;
    const cursor = editor.state.selection.head;
    let selectedIndex = 0;
    editor.state.doc.forEach((node, position, index) => {
        const end = position + node.nodeSize;
        if (cursor >= position && cursor <= end) selectedIndex = index;
    });
    return Math.min(selectedIndex, snapshot.blocks.length - 1);
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

export function seedEditableContext(
    editor: Editor,
    snapshot: DocumentAiFrozenSnapshot,
    scope: DocumentAiScope,
    chunkWordLimit: number,
) {
    if (scope === 'selection' && !snapshot.selection) {
        throw new Error('Select text before using selection scope.');
    }

    const writableBlocks = scope === 'selection'
        ? []
        : scope === 'document'
            ? snapshot.blocks
            : currentSectionBlocks(editor, snapshot);
    const allowedRefs = new Set(
        scope === 'selection' ? [] : writableBlocks.map((block) => block.ref),
    );
    const readableRefs = new Set(snapshot.blocks.map((block) => block.ref));
    const outline = buildDocumentOutline(snapshot, readableRefs);
    const limit = clampDocumentAiChunkWords(chunkWordLimit);
    const chunks = chunkDocumentBlocks(snapshot.blocks, limit).map((chunk) => ({
        index: chunk.index,
        fromRef: chunk.fromRef,
        toRef: chunk.toRef,
        wordCount: chunk.wordCount,
        blockCount: chunk.blocks.length,
    }));

    // Small docs fit in the seed. Large docs send one bounded cursor-local
    // window plus the outline/chunk map; tools can pull any other range.
    const totalWords = snapshot.blocks.reduce(
        (total, block) => total + countWords(block.text),
        0,
    );
    const isEmptyDocument = totalWords === 0;
    const includeWholeDocument = totalWords <= limit && snapshot.blocks.length <= 80;
    const cursorIndex = resolveDocumentAiCursorBlockIndex(editor, snapshot);
    const cursorBlock = cursorIndex >= 0 ? snapshot.blocks[cursorIndex] ?? null : null;
    const focusChunks = chunkDocumentBlocks(
        snapshot.blocks,
        Math.min(limit, AUTO_FOCUS_CONTEXT_WORDS),
    );
    const focusChunk = focusChunks.find((chunk) =>
        cursorBlock
        && cursorBlock.index >= chunk.blockStart
        && cursorBlock.index < chunk.blockEnd
    ) ?? focusChunks[0];

    return {
        blocks: writableBlocks,
        allowedRefs,
        readableRefs,
        seedText: JSON.stringify({
            contextMode: 'automatic',
            scope,
            chunkWordLimit: limit,
            cursor: cursorBlock
                ? {
                      blockRef: cursorBlock.ref,
                      blockIndex: cursorBlock.index,
                      blockType: cursorBlock.type,
                      position: editor.state.selection.head,
                  }
                : null,
            selection: snapshot.selection
                ? {
                      text: snapshot.selection.text,
                      content: snapshot.selection.content,
                      openStart: snapshot.selection.openStart,
                      openEnd: snapshot.selection.openEnd,
                  }
                : null,
            outlineSummary: summarizeOutlineForPrompt(outline),
            chunks,
            documentBlocks: includeWholeDocument
                ? serializeBlocksForModel(snapshot.blocks)
                : undefined,
            cursorContextBlocks: !includeWholeDocument && focusChunk
                ? serializeBlocksForModel(focusChunk.blocks)
                : undefined,
            emptyDocument: isEmptyDocument,
            note: scope === 'selection'
                ? 'The selection is the only writable target. The cursor-local/full document content and read tools are context only. Call propose_edits with exactly one replace_selection that preserves the selection shape.'
                : isEmptyDocument
                ? 'Document is empty. Create the article with propose_edits using insert_end and/or replace_block on b1. Do not stall on outline/search.'
                : includeWholeDocument
                    ? 'The full document is included. Treat the cursor block as the likely target unless the request clearly asks for a broader change.'
                    : 'A bounded cursor-local window is included with the full outline/chunk map. Read other chunks only when needed, and prefer the cursor block unless the request clearly targets broader content.',
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
        documentAiCommands(editor).clearDocumentAiHunks?.();
        return;
    }
    const pendingId = activeHunkId
        ?? proposal.hunks.find((hunk) => hunk.status === 'pending')?.id
        ?? null;
    documentAiCommands(editor).setDocumentAiHunks?.({
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
    readOnly?: Readonly<Ref<boolean>>;
}) {
    const status = ref<'idle' | 'estimating' | 'preparing' | 'streaming' | 'preview' | 'error'>('idle');
    const online = useOnline();
    let estimateGeneration = 0;
    const error = ref('');
    const tokenEstimate = ref(0);
    const proposal = ref<DocumentAiProposal | null>(null);
    function ownsProposal(documentId: string): boolean { return proposal.value?.documentId === documentId; }
    const chatToolRuns = new Map<string, {
        snapshotId: string;
        documentId: string;
        version: number;
        snapshot: DocumentAiFrozenSnapshot;
        scope: DocumentAiScope;
        allowedRefs: Set<string>;
        readableRefs: Set<string>;
        seedText: string;
        stagedOperations: DocumentAiOperation[];
    }>();
    const retiredChatRequests = new Set<string>();
    let chatPreviewRequestId: string | null = null;
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
            readOnly: options.readOnly?.value,
            status: status.value,
            accepting: accepting.value,
        }));
    }

    watch([options.editor, () => options.readOnly?.value, status, accepting], syncEditorLock, { flush: 'sync' });
    watch(online, connected => {
        if (connected || (status.value !== 'preparing' && status.value !== 'streaming')) return;
        abort();
        error.value = 'AI stopped when the connection was lost. Your request is kept. Send it again when you’re online.';
        status.value = 'error';
        syncEditorLock();
    }, { flush: 'sync' });
    onScopeDispose(abort);

    function retireChatRuns() {
        if (chatPreviewRequestId) retiredChatRequests.add(chatPreviewRequestId);
        for (const requestId of chatToolRuns.keys()) retiredChatRequests.add(requestId);
        chatToolRuns.clear();
        // Bound retained turn IDs. A stale snapshotId still prevents edits if
        // an older request eventually falls out of this history.
        while (retiredChatRequests.size > 128) {
            retiredChatRequests.delete(retiredChatRequests.values().next().value!);
        }
    }

    function chatToolRun(requestId: string, refreshIfChanged = false) {
        const editor = options.editor.value;
        if (!editor || editor.isDestroyed || options.readOnly?.value) throw new Error('The document editor is unavailable.');
        if (retiredChatRequests.has(requestId)) {
            throw new Error('This chat edit was reviewed. Start a new chat turn to edit this document again.');
        }
        if (status.value === 'preparing' || status.value === 'streaming' || accepting.value) {
            throw new Error('The document editor is busy.');
        }
        let existing = chatToolRuns.get(requestId);
        if (existing) {
            if (existing.documentId === options.documentId.value
                && existing.version === options.contentVersion.value) return { editor, run: existing };
            if (!refreshIfChanged || existing.stagedOperations.length || chatPreviewRequestId === requestId) {
                throw new Error('The document changed. Read its outline again before editing.');
            }
            chatToolRuns.delete(requestId);
        }
        if (proposal.value) throw new Error('Review or discard the existing document proposal before reading a new snapshot.');
        const snapshot = freezeDocumentForAi(editor);
        const scope = resolveAutomaticDocumentAiScope(editor);
        const seed = seedEditableContext(editor, snapshot, scope, settings.value.chunkWordLimit);
        const run = {
            snapshotId: createRuntimeUuid(),
            documentId: options.documentId.value,
            version: options.contentVersion.value,
            snapshot,
            scope,
            allowedRefs: seed.allowedRefs,
            readableRefs: seed.readableRefs,
            seedText: '',
            stagedOperations: [] as DocumentAiOperation[],
        };
        run.seedText = JSON.stringify({
            snapshotId: run.snapshotId,
            ...JSON.parse(seed.seedText),
        });
        if (chatToolRuns.size >= 8) {
            const oldest = chatToolRuns.keys().next().value;
            if (oldest) {
                chatToolRuns.delete(oldest);
                retiredChatRequests.add(oldest);
            }
        }
        chatToolRuns.set(requestId, run);
        return { editor, run };
    }

    function getChatContext(requestId: string): string {
        return chatToolRun(requestId, true).run.seedText;
    }

    function executeChatTool(name: string, argsJson: string, requestId: string): string {
        if (!isDocumentAiNativeTool(name)) throw new Error(`Unknown document tool: ${name}`);
        const parsed = JSON.parse(argsJson) as { documentId?: unknown; snapshotId?: unknown };
        if (parsed.documentId !== options.documentId.value) {
            throw new Error('The requested document is no longer open in this editor.');
        }
        if (name === 'get_proposal_status' && proposal.value && chatPreviewRequestId !== requestId) {
            return JSON.stringify({
                totalStaged: proposal.value.operations.length,
                reviewPending: true,
                message: 'A proposal is already waiting for review in the document editor.',
            });
        }
        const refreshIfChanged = name === 'get_document_outline'
            || name === 'list_document_chunks' || name === 'search_document'
            || name === 'get_proposal_status';
        const { editor, run } = chatToolRun(requestId, refreshIfChanged);
        if ((name === 'read_blocks' || name === 'propose_edits')
            && parsed.snapshotId !== run.snapshotId) {
            throw new Error('The document snapshot changed. Read its outline again and use the new snapshotId.');
        }
        if (name === 'propose_edits' && proposal.value && chatPreviewRequestId !== requestId) {
            throw new Error('Review or discard the existing document proposal before staging new edits.');
        }

        const result = executeDocumentAiTool(name, argsJson, {
            editor,
            snapshot: run.snapshot,
            scope: run.scope,
            allowedRefs: run.allowedRefs,
            readableRefs: run.readableRefs,
            chunkWordLimit: settings.value.chunkWordLimit,
            stagedOperations: run.stagedOperations,
            onStageOperations(operations) {
                const combined = [...run.stagedOperations, ...operations];
                const candidate = buildDocumentAiCandidate(editor, run.snapshot, combined);
                const hunks = createDocumentAiHunks(combined, run.snapshot);
                bindHunkHandlers(editor);
                clearScopeHighlight();
                run.stagedOperations.push(...operations);
                chatPreviewRequestId = requestId;
                proposalOriginCurrent = captureProposalOrigin(editor);
                proposal.value = {
                    documentId: run.documentId,
                    candidate,
                    diff: summarizeDocumentAiDiff(run.snapshot.content, candidate),
                    operations: combined,
                    hunks,
                    snapshot: run.snapshot,
                    requestVersion: options.contentVersion.value,
                    prompt: 'Chat edit',
                    scope: run.scope,
                };
                focusedHunkId.value = hunks[0]?.id ?? null;
                syncHunkDecorations(editor, proposal.value, focusedHunkId.value);
                status.value = 'preview';
                syncEditorLock();
                // The editor lock itself must not invalidate the frozen run.
                run.version = options.contentVersion.value;
                proposal.value.requestVersion = run.version;
            },
        });
        return refreshIfChanged
            ? JSON.stringify({ snapshotId: run.snapshotId, result: JSON.parse(result) as unknown })
            : result;
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
            documentAiCommands(editor).setDocumentAiScopeRange?.(null);
            return;
        }
        if (mode === 'show') scopeHighlightActive = true;

        if (
            !scopeHighlightActive
            || status.value === 'streaming'
            || status.value === 'preview'
            || Boolean(proposal.value)
        ) {
            documentAiCommands(editor).setDocumentAiScopeRange?.(null);
            return;
        }
        const range = resolveDocumentAiScopeRange(editor, lastScope.value);
        documentAiCommands(editor).setDocumentAiScopeRange?.(range);
    }

    function clearScopeHighlight() {
        syncScopeHighlight(undefined, 'clear');
    }

    function invalidateEstimateCache() {
        estimateSeedCache = null;
    }

    function enqueueAccept(work: () => Promise<void>): Promise<void> {
        return acceptControl.enqueue(async () => {
            error.value = '';
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

    let proposalOriginCurrent: (() => boolean) | undefined;
    function captureProposalOrigin(editor: Editor) {
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const account = getCachedSessionContext()?.user?.id;
        const id = options.documentId.value;
        return () => getDb() === db && getWorkspaceGeneration() === generation
            && getCachedSessionContext()?.user?.id === account && options.documentId.value === id
            && options.editor.value === editor && !editor.isDestroyed;
    }

    function assertAcceptableProposal(current: DocumentAiProposal) {
        if (proposalOriginCurrent && !proposalOriginCurrent()) throw new Error('This proposal belongs to an earlier editor session.');
        if (options.readOnly?.value) throw new Error('The document editor is unavailable.');
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
            proposal: proposal.value ? toRaw(proposal.value) : null,
            current: toRaw(current),
            documentId: options.documentId.value,
        });
    }

    function bindHunkHandlers(editor: Editor) {
        documentAiCommands(editor).setDocumentAiHunkHandlers?.({
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

    async function resolveModel(attachments: readonly DocumentAiAttachment[], signal: AbortSignal): Promise<OpenRouterModel> {
        await ensureLoaded();
        signal.throwIfAborted();
        if (!online.value) throw new Error('You’re offline. Reconnect to send an AI request.');
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

    const isEstimating = (): boolean => status.value === 'estimating';

    async function estimate(request: DocumentAiEstimateRequest) {
        if (options.readOnly?.value) return 0;
        const editor = options.editor.value;
        if (!editor) return 0;
        // Never let estimate stomp an in-flight agent run / preview.
        if (status.value === 'preparing' || status.value === 'streaming' || status.value === 'preview' || accepting.value) return tokenEstimate.value;
        const mine = ++estimateGeneration;
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const account = getCachedSessionContext()?.user?.id;
        const id = options.documentId.value;
        const ownsEstimate = () => mine === estimateGeneration && isEstimating()
            && options.editor.value === editor && !editor.isDestroyed && options.documentId.value === id
            && getDb() === db && getWorkspaceGeneration() === generation
            && getCachedSessionContext()?.user?.id === account;
        status.value = 'estimating';
        try {
            await ensureLoaded();
            if (!ownsEstimate()) return 0;
            const scope = resolveAutomaticDocumentAiScope(editor);
            lastScope.value = scope;
            const chunkWordLimit = settings.value.chunkWordLimit;
            const version = options.contentVersion.value;
            const documentId = options.documentId.value;
            const scopeKey = estimateScopeKey(editor, scope);
            let seedText = '';
            const cacheHit = estimateSeedCache
                && estimateSeedCache.documentId === documentId
                && estimateSeedCache.contentVersion === version
                && estimateSeedCache.scope === scope
                && estimateSeedCache.scopeKey === scopeKey
                && estimateSeedCache.chunkWordLimit === chunkWordLimit;
            if (cacheHit && estimateSeedCache) {
                seedText = estimateSeedCache.seedText;
            } else {
                const snapshot = freezeDocumentForAi(editor);
                const context = seedEditableContext(
                    editor,
                    snapshot,
                    scope,
                    chunkWordLimit,
                );
                seedText = context.seedText;
                estimateSeedCache = {
                    documentId,
                    contentVersion: version,
                    scope,
                    scopeKey,
                    chunkWordLimit,
                    seedText,
                };
            }
            const references = await referenceContext(request.references);
            if (!ownsEstimate()) return 0;
            const count = await countTokens(`${request.prompt}\n${seedText}\n${references}`);
            if (!ownsEstimate()) return 0;
            tokenEstimate.value = count;
            return tokenEstimate.value;
        } catch (caught) {
            if (ownsEstimate()) {
                error.value = caught instanceof Error ? caught.message : String(caught);
            }
            return 0;
        } finally {
            if (ownsEstimate()) status.value = 'idle';
        }
    }

    async function ensureAiCheckpoint(editor: Editor) {
        if (checkpointCreated.value) return;
        const isCurrent = captureProposalOrigin(editor);
        const db = getDb();
        await createDocumentRevision({
            documentId: options.documentId.value,
            title: options.title.value,
            content: editor.getJSON(),
            source: 'ai',
        }, db);
        if (isCurrent()) checkpointCreated.value = true;
    }

    async function submit(submission: DocumentAiSubmission) {
        if (options.readOnly?.value) return;
        const editor = options.editor.value;
        if (!editor || !submission.prompt.trim() || status.value === 'preparing' || status.value === 'streaming' || accepting.value) return;
        if (!online.value) {
            error.value = 'You’re offline. Reconnect to send an AI request.';
            if (!proposal.value) status.value = 'error';
            return;
        }
        const submitDocumentId = options.documentId.value;
        retireChatRuns();
        chatPreviewRequestId = null;
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

        const originDb = getDb();
        const originGeneration = getWorkspaceGeneration();
        const originAccount = getCachedSessionContext()?.user?.id ?? null;
        const ownsRun = () => runControl.isCurrent(myGeneration)
            && options.editor.value === editor && !editor.isDestroyed
            && options.documentId.value === submitDocumentId && !options.readOnly?.value
            && getDb() === originDb && getWorkspaceGeneration() === originGeneration
            && (getCachedSessionContext()?.user?.id ?? null) === originAccount;
        const abortController = new AbortController();
        controller.value = abortController;
        status.value = 'preparing';
        let request: DocumentAiEditRequestPayload | undefined;
        try {
            const attachments = validateDocumentAiAttachments(submission.attachments);
            const snapshot = freezeDocumentForAi(editor);
            const scope = resolveAutomaticDocumentAiScope(editor);
            lastScope.value = scope;
            clearScopeHighlight();
            const requestVersion = options.contentVersion.value;
            await ensureLoaded();
            if (!ownsRun()) return;
            const context = seedEditableContext(
                editor,
                snapshot,
                scope,
                settings.value.chunkWordLimit,
            );
            const references = await referenceContext(submission.references, true);
            if (!ownsRun()) return;
            const model = await resolveModel(attachments, abortController.signal);
            if (!ownsRun()) return;

            const tools = resolveDocumentAiToolsForRun(settings.value.enabledTools);
            if (!tools.length) {
                error.value = 'Enable at least one tool in Document AI settings.';
                status.value = 'error';
                return;
            }
            if (!tools.some((tool) => tool.function.name === 'propose_edits')) {
                error.value = 'Enable “Suggest edits” in Document AI settings to prepare document changes for review.';
                status.value = 'error';
                return;
            }

            const count = await countTokens(`${submission.prompt}\n${context.seedText}\n${references}`);
            if (!ownsRun()) return;
            tokenEstimate.value = count;
            if (options.contentVersion.value !== requestVersion) {
                error.value = 'The document changed while preparing the request. Submit it again.';
                status.value = 'error';
                return;
            }
            const contextLimit = model.top_provider?.context_length ?? model.context_length ?? 32_000;
            if (tokenEstimate.value + 4096 > contextLimit) {
                error.value = `This ${scope} is too large for ${model.name}. Choose a larger-context model or a smaller scope.`;
                status.value = 'error';
                return;
            }

            request = await hooks.applyFilters('ai.document.edit:filter:request', {
                documentId: submitDocumentId,
                modelId: model.id,
                prompt: submission.prompt.trim(),
                scope,
                context: context.seedText,
                references: uniqueDocumentAiReferences(submission.references),
                referenceContext: references,
                tokenEstimate: tokenEstimate.value,
                maxIterations: settings.value.maxIterations,
                chunkWordLimit: settings.value.chunkWordLimit,
            });
            if (!ownsRun()) return;
            status.value = 'streaming';
            agentStatus.value = 'Starting…';
            clearScopeHighlight();
            syncEditorLock();
            await hooks.doAction('ai.document.edit:action:before', request);
            if (!ownsRun() || abortController.signal.aborted) return;
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
                            text: `Request:\n${request.prompt}\n\nAutomatically resolved edit target:\n${request.scope}\n\nFrozen document context (selection/cursor/outline/chunks; writable limits are enforced by tools):\n${request.context}\n\nRead-only reference context:\n${request.referenceContext || '(none)'}`,
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
                onStatus: event => {
                    if (ownsRun() && !abortController.signal.aborted) onAgentStatus(event);
                },
                toolContext: {
                    editor,
                    snapshot,
                    scope,
                    allowedRefs: context.allowedRefs,
                    readableRefs: context.readableRefs,
                    chunkWordLimit: settings.value.chunkWordLimit,
                },
            });

            if (
                !ownsRun()
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
            proposalOriginCurrent = captureProposalOrigin(editor);
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
            if (!ownsRun()) return;
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
            if (request) await hooks.doAction('ai.document.edit:action:error', { request, error: caught });
        } finally {
            if (controller.value === abortController) controller.value = null;
            if (runControl.isCurrent(myGeneration) && (status.value === 'streaming' || status.value === 'preparing')) {
                // Loop ended without preview/error transition (shouldn't happen often).
                status.value = 'idle';
                syncEditorLock();
            }
        }
    }

    async function accept() {
        if (options.readOnly?.value) return;
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
            const originDb = getDb();
            const originGeneration = getWorkspaceGeneration();
            const originAccount = getCachedSessionContext()?.user?.id;
            let applied = current;
            if (!current.applied) {
                await ensureAiCheckpoint(editor);
                if (!proposalStillOwned(current)) return;
                if (options.editor.value !== editor || editor.isDestroyed || getDb() !== originDb
                    || getWorkspaceGeneration() !== originGeneration
                    || getCachedSessionContext()?.user?.id !== originAccount) return;
                assertAcceptableProposal(current);
                const candidate = buildDocumentAiCandidate(editor, current.snapshot, operations);
                editor.schema.nodeFromJSON(candidate).check();
                editor.commands.setContent(candidate, { emitUpdate: true, errorOnInvalidContent: true });
                applied = { ...current, applied: true, requestVersion: options.contentVersion.value };
                proposal.value = applied;
                syncHunkDecorations(editor, null);
            }
            await options.persistCurrent();
            if (!proposalStillOwned(applied)) return;
            proposal.value = null;
            retireChatRuns();
            chatPreviewRequestId = null;
            focusedHunkId.value = null;
            syncHunkDecorations(editor, null);
            status.value = 'idle';
            agentStatus.value = '';
            checkpointCreated.value = false;
        });
    }

    async function acceptHunk(hunkId: string) {
        if (options.readOnly?.value) return;
        return enqueueAccept(async () => {
            const editor = options.editor.value;
            const current = proposal.value;
            if (!editor || !current) return;
            assertAcceptableProposal(current);
            const hunk = current.hunks.find((entry) => entry.id === hunkId);
            if (!hunk || hunk.status !== 'pending') return;

            await ensureAiCheckpoint(editor);
            if (proposal.value !== current) return;
            assertAcceptableProposal(current);
            if (options.editor.value !== editor || editor.isDestroyed) return;
            if (chatPreviewRequestId) retireChatRuns();

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
            applyDocumentAiOperationLive(editor, current.snapshot, acceptedBefore, hunk.op, current.hunks.map((entry) => entry.op));
            const versionAfterAccept = options.contentVersion.value;
            if (proposal.value && toRaw(proposal.value) === interim) {
                proposal.value = { ...interim, applied: !pending.length, requestVersion: versionAfterAccept };
            }
            await options.persistCurrent();
            if (!ownsProposal(current.documentId)) return;

            if (!pending.length) {
                proposal.value = null;
                retireChatRuns();
                chatPreviewRequestId = null;
                focusedHunkId.value = null;
                syncHunkDecorations(editor, null);
                status.value = 'idle';
                agentStatus.value = '';
                checkpointCreated.value = false;
                return;
            }

            const previewOps = nextHunks.filter((entry) => entry.status !== 'discarded').map((entry) => entry.op);
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
        if (!current.hunks.some((hunk) => hunk.id === hunkId && hunk.status === 'pending')) return;
        if (chatPreviewRequestId) retireChatRuns();
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
            retireChatRuns();
            chatPreviewRequestId = null;
            focusedHunkId.value = null;
            syncHunkDecorations(editor, null);
            status.value = 'idle';
            agentStatus.value = '';
            checkpointCreated.value = false;
            syncEditorLock();
            return;
        }
        const applied = nextHunks.filter((entry) => entry.status !== 'discarded').map((entry) => entry.op);
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
        retireChatRuns();
        chatPreviewRequestId = null;
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
        estimateGeneration++;
        controller.value?.abort();
        controller.value = null;
        // Retire active preparation/estimation without clearing a review or error.
        if (status.value === 'preparing' || status.value === 'streaming' || status.value === 'estimating') {
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
        documentAiCommands(editor).setActiveDocumentAiHunk?.(hunkId);
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
        getChatContext,
        executeChatTool,
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
