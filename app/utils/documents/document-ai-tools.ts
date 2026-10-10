import type { Editor } from '@tiptap/core';
import type { ToolDefinition } from '~/utils/chat/types';
import type { DocumentAiScope } from '~/composables/editor/useDocumentAiActions';
import {
    buildDocumentAiCandidate,
    MAX_DOCUMENT_AI_OPERATIONS,
    parseDocumentAiOperations,
    type DocumentAiFrozenSnapshot,
    type DocumentAiOperation,
} from './document-ai-operations';
import {
    buildDocumentOutline,
    chunkDocumentBlocks,
    clampDocumentAiChunkWords,
    searchFrozenDocument,
    serializeBlocksForModel,
    sliceBlocksByRefRange,
    summarizeOutlineForPrompt,
} from './document-ai-index';

import { DOCUMENT_AI_AGENT_TOOLS, DOCUMENT_AI_NATIVE_TOOL_NAMES } from './document-ai-tool-definitions';
export { DOCUMENT_AI_AGENT_TOOLS, DOCUMENT_AI_NATIVE_TOOL_NAMES } from './document-ai-tool-definitions';

export function isDocumentAiNativeTool(name: string): boolean {
    return DOCUMENT_AI_NATIVE_TOOL_NAMES.has(name);
}

/** Document-native tools default on; chat-registry tools default off (opt-in). */
export function isDocumentAiToolEnabled(
    name: string,
    enabledTools: Readonly<Record<string, boolean>>,
    options?: { nativeDefault?: boolean; registryDefault?: boolean },
): boolean {
    const explicit = enabledTools[name];
    if (typeof explicit === 'boolean') return explicit;
    if (isDocumentAiNativeTool(name)) return options?.nativeDefault ?? true;
    return options?.registryDefault ?? false;
}

export function resolveDocumentAiAgentTools(options: {
    enabledTools: Readonly<Record<string, boolean>>;
    registryDefinitions: readonly ToolDefinition[];
}): ToolDefinition[] {
    const native = DOCUMENT_AI_AGENT_TOOLS.filter((tool) =>
        isDocumentAiToolEnabled(tool.function.name, options.enabledTools),
    );
    const registry = options.registryDefinitions.filter((tool) => {
        const name = tool.function.name;
        if (isDocumentAiNativeTool(name)) return false;
        if (tool.runtime === 'server') return false;
        return isDocumentAiToolEnabled(name, options.enabledTools);
    });
    return [...native, ...registry];
}

export interface DocumentAiToolContext {
    editor: Editor;
    snapshot: DocumentAiFrozenSnapshot;
    scope: DocumentAiScope;
    /** Refs the model may change. Selection scope intentionally has none. */
    allowedRefs: ReadonlySet<string>;
    /** Refs the model may inspect for context, even when they are not writable. */
    readableRefs?: ReadonlySet<string>;
    chunkWordLimit: number;
    stagedOperations: DocumentAiOperation[];
    onStageOperations: (operations: DocumentAiOperation[]) => void;
}

function readableBlocks(ctx: DocumentAiToolContext) {
    const refs = ctx.readableRefs ?? ctx.allowedRefs;
    return ctx.snapshot.blocks.filter((block) => refs.has(block.ref));
}

function validateScopedOperations(
    ctx: DocumentAiToolContext,
    operations: DocumentAiOperation[],
) {
    for (const operation of operations) {
        if (ctx.scope === 'selection' && operation.kind !== 'replace_selection') {
            throw new Error('The model proposed edits outside the selected text.');
        }
        if ('ref' in operation && !ctx.allowedRefs.has(operation.ref)) {
            throw new Error(`The model proposed an edit outside the ${ctx.scope} scope.`);
        }
        if (operation.kind === 'insert_end' && ctx.scope !== 'document') {
            throw new Error('Insert-at-end is only available for whole-document edits.');
        }
    }
    const combined = [...ctx.stagedOperations, ...operations];
    if (combined.length > MAX_DOCUMENT_AI_OPERATIONS) {
        throw new Error(`At most ${MAX_DOCUMENT_AI_OPERATIONS} staged operations are allowed.`);
    }
    // Ensure the combined plan still builds a valid candidate against the freeze.
    buildDocumentAiCandidate(ctx.editor, ctx.snapshot, combined);
}

export function executeDocumentAiTool(
    name: string,
    argsJson: string,
    ctx: DocumentAiToolContext,
): string {
    let args: Record<string, unknown> = {};
    if (argsJson.trim()) {
        const parsed: unknown = JSON.parse(argsJson);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`Invalid arguments for ${name}.`);
        }
        args = parsed as Record<string, unknown>;
    }

    switch (name) {
        case 'get_document_outline': {
            const outline = buildDocumentOutline(
                ctx.snapshot,
                ctx.readableRefs ?? ctx.allowedRefs,
            );
            return JSON.stringify({
                scope: ctx.scope,
                writableBlockCount: ctx.allowedRefs.size,
                readableBlockCount: readableBlocks(ctx).length,
                outline,
                summary: summarizeOutlineForPrompt(outline),
            });
        }
        case 'list_document_chunks': {
            const limit = clampDocumentAiChunkWords(ctx.chunkWordLimit);
            const chunks = chunkDocumentBlocks(readableBlocks(ctx), limit).map((chunk) => ({
                index: chunk.index,
                fromRef: chunk.fromRef,
                toRef: chunk.toRef,
                wordCount: chunk.wordCount,
                blockCount: chunk.blocks.length,
            }));
            return JSON.stringify({
                chunkWordLimit: limit,
                chunkCount: chunks.length,
                chunks,
            });
        }
        case 'read_blocks': {
            const fromRef = String(args.fromRef ?? '');
            const toRef = String(args.toRef ?? '');
            const blocks = sliceBlocksByRefRange(
                ctx.snapshot,
                fromRef,
                toRef,
                ctx.readableRefs ?? ctx.allowedRefs,
            );
            const wordCount = blocks.reduce((total, block) => {
                const words = block.text.trim() ? block.text.trim().split(/\s+/u).length : 0;
                return total + words;
            }, 0);
            const limit = clampDocumentAiChunkWords(ctx.chunkWordLimit);
            if (wordCount > limit * 1.35) {
                throw new Error(
                    `Requested range is ~${wordCount} words. Stay near the configured chunk size (${limit} words) or split the read.`,
                );
            }
            return JSON.stringify({
                fromRef,
                toRef,
                wordCount,
                blocks: serializeBlocksForModel(blocks),
            });
        }
        case 'search_document': {
            const query = String(args.query ?? '');
            return JSON.stringify({
                query,
                matches: searchFrozenDocument(
                    ctx.snapshot,
                    query,
                    ctx.readableRefs ?? ctx.allowedRefs,
                ),
            });
        }
        case 'propose_edits': {
            const operations = parseDocumentAiOperations(args);
            validateScopedOperations(ctx, operations);
            ctx.onStageOperations(operations);
            return JSON.stringify({
                staged: operations.length,
                totalStaged: ctx.stagedOperations.length,
                remainingBudget: MAX_DOCUMENT_AI_OPERATIONS - ctx.stagedOperations.length,
                touchedRefs: operations
                    .map((operation) => ('ref' in operation ? operation.ref : operation.kind))
                    .slice(0, 32),
            });
        }
        case 'get_proposal_status': {
            return JSON.stringify({
                totalStaged: ctx.stagedOperations.length,
                remainingBudget: MAX_DOCUMENT_AI_OPERATIONS - ctx.stagedOperations.length,
                operations: ctx.stagedOperations.map((operation) => (
                    'ref' in operation
                        ? { kind: operation.kind, ref: operation.ref }
                        : { kind: operation.kind }
                )),
            });
        }
        default:
            throw new Error(`Unknown document AI tool: ${name}`);
    }
}
