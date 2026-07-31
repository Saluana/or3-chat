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

const contentSchema = {
    type: 'array',
    minItems: 1,
    description: 'TipTap JSON nodes only. Never include a doc wrapper, Markdown, HTML, or plain strings.',
    items: { type: 'object', additionalProperties: true },
};

const referencedOperation = (
    kind: 'replace_block' | 'delete_block' | 'insert_before' | 'insert_after',
) => ({
    type: 'object',
    additionalProperties: false,
    required: kind === 'delete_block' ? ['kind', 'ref'] : ['kind', 'ref', 'content'],
    properties: {
        kind: { const: kind },
        ref: {
            type: 'string',
            pattern: '^b[1-9][0-9]*$',
            description: 'Exact block ref such as b3.',
        },
        ...(kind === 'delete_block' ? {} : { content: contentSchema }),
    },
});

export const DOCUMENT_AI_AGENT_TOOLS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'get_document_outline',
            description: 'Get the readable document outline with section word counts and block ranges. Some readable blocks may be context-only when a text selection is the edit target.',
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {},
            },
        },
        ui: {
            label: 'Document outline',
            descriptionHint: 'List sections and block ranges before reading.',
            category: 'Document',
            defaultEnabled: true,
            icon: 'i-lucide-list-tree',
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_document_chunks',
            description: 'List large contiguous chunks of readable document context (configured word budget). Prefer whole chunks over many tiny ranges.',
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {},
            },
        },
        ui: {
            label: 'List chunks',
            descriptionHint: 'Split the doc into sized chunks for reading.',
            category: 'Document',
            defaultEnabled: true,
            icon: 'i-lucide-layers',
        },
    },
    {
        type: 'function',
        function: {
            name: 'read_blocks',
            description: 'Read TipTap JSON for an inclusive readable block range (for example b1…b40). Reading a block does not necessarily make it writable.',
            parameters: {
                type: 'object',
                additionalProperties: false,
                required: ['fromRef', 'toRef'],
                properties: {
                    fromRef: { type: 'string', pattern: '^b[1-9][0-9]*$' },
                    toRef: { type: 'string', pattern: '^b[1-9][0-9]*$' },
                },
            },
        },
        ui: {
            label: 'Read blocks',
            descriptionHint: 'Load TipTap JSON for a block range.',
            category: 'Document',
            defaultEnabled: true,
            icon: 'i-lucide-book-open',
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_document',
            description: 'Search editable document text and return matching block refs with snippets.',
            parameters: {
                type: 'object',
                additionalProperties: false,
                required: ['query'],
                properties: {
                    query: { type: 'string', minLength: 1, maxLength: 200 },
                },
            },
        },
        ui: {
            label: 'Search document',
            descriptionHint: 'Find phrases and matching blocks.',
            category: 'Document',
            defaultEnabled: true,
            icon: 'i-lucide-search',
        },
    },
    {
        type: 'function',
        function: {
            name: 'propose_edits',
            description: `Stage 1–${MAX_DOCUMENT_AI_OPERATIONS} TipTap edit operations against the frozen editable scope. May be called multiple times; later calls append. Do not invent refs. For replace_selection, content must be TipTap JSON matching the frozen selection shape (preserve marks and multi-block structure).`,
            parameters: {
                type: 'object',
                additionalProperties: false,
                required: ['operations'],
                properties: {
                    operations: {
                        type: 'array',
                        minItems: 1,
                        maxItems: MAX_DOCUMENT_AI_OPERATIONS,
                        items: {
                            oneOf: [
                                {
                                    type: 'object',
                                    additionalProperties: false,
                                    required: ['kind', 'content'],
                                    properties: {
                                        kind: { const: 'replace_selection' },
                                        content: contentSchema,
                                    },
                                },
                                referencedOperation('replace_block'),
                                referencedOperation('delete_block'),
                                referencedOperation('insert_before'),
                                referencedOperation('insert_after'),
                                {
                                    type: 'object',
                                    additionalProperties: false,
                                    required: ['kind', 'content'],
                                    properties: {
                                        kind: { const: 'insert_end' },
                                        content: contentSchema,
                                    },
                                },
                            ],
                        },
                    },
                },
            },
        },
        ui: {
            label: 'Propose edits',
            descriptionHint: 'Stage TipTap changes for review. Required to edit.',
            category: 'Document',
            defaultEnabled: true,
            icon: 'i-lucide-pencil',
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_proposal_status',
            description: 'Inspect staged edits so far (count, touched refs, remaining operation budget).',
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {},
            },
        },
        ui: {
            label: 'Proposal status',
            descriptionHint: 'Check what edits are already staged.',
            category: 'Document',
            defaultEnabled: true,
            icon: 'i-lucide-clipboard-list',
        },
    },
];

export const DOCUMENT_AI_NATIVE_TOOL_NAMES = new Set(
    DOCUMENT_AI_AGENT_TOOLS.map((tool) => tool.function.name),
);

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
