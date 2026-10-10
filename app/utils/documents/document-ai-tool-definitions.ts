import type { ToolDefinition } from '~/utils/chat/types';

export const MAX_DOCUMENT_AI_OPERATIONS = 64;

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
            descriptionHint: 'See the sections of a document and where they appear.',
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
            label: 'Browse document parts',
            descriptionHint: 'Find manageable parts of a long document for the AI to read.',
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
            label: 'Read part of a document',
            descriptionHint: 'Let the AI read a specific part of a document, including its formatting.',
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
            descriptionHint: 'Find words or phrases within a document.',
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
            label: 'Suggest edits',
            descriptionHint: 'Prepare document changes for you to review before applying them.',
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
            label: 'Check suggested edits',
            descriptionHint: 'See which suggested edits are waiting for your review.',
            category: 'Document',
            defaultEnabled: true,
            icon: 'i-lucide-clipboard-list',
        },
    },
];

export const DOCUMENT_AI_NATIVE_TOOL_NAMES = new Set(
    DOCUMENT_AI_AGENT_TOOLS.map((tool) => tool.function.name),
);
