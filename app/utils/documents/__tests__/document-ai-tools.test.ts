import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { freezeDocumentForAi, type DocumentAiOperation } from '../document-ai-operations';
import { DOCUMENT_AI_AGENT_TOOLS, executeDocumentAiTool } from '../document-ai-tools';
import { validateToolDefinition } from '~~/shared/chat/tool-schema';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

function makeEditor() {
    editor = new Editor({
        extensions: [StarterKit],
        content: {
            type: 'doc',
            content: [
                { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Body copy here' }] },
            ],
        },
    });
    return editor;
}

describe('document AI tools', () => {
    it('publishes valid tool definitions', () => {
        for (const tool of DOCUMENT_AI_AGENT_TOOLS) {
            expect(validateToolDefinition(tool)).toMatchObject({ valid: true });
        }
    });

    it('reads outline/chunks and stages edits against the freeze', () => {
        const current = makeEditor();
        const snapshot = freezeDocumentForAi(current);
        const staged: DocumentAiOperation[] = [];
        const ctx = {
            editor: current,
            snapshot,
            scope: 'document' as const,
            allowedRefs: new Set(snapshot.blocks.map((block) => block.ref)),
            chunkWordLimit: 5000,
            stagedOperations: staged,
            onStageOperations: (operations: DocumentAiOperation[]) => {
                staged.push(...operations);
            },
        };

        const outline = JSON.parse(executeDocumentAiTool('get_document_outline', '{}', ctx));
        expect(outline.outline.length).toBeGreaterThan(0);

        const chunks = JSON.parse(executeDocumentAiTool('list_document_chunks', '{}', ctx));
        expect(chunks.chunkCount).toBe(1);

        const read = JSON.parse(executeDocumentAiTool(
            'read_blocks',
            JSON.stringify({ fromRef: 'b1', toRef: 'b2' }),
            ctx,
        ));
        expect(read.blocks).toHaveLength(2);

        const stagedResult = JSON.parse(executeDocumentAiTool(
            'propose_edits',
            JSON.stringify({
                operations: [{
                    kind: 'replace_block',
                    ref: 'b2',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated' }] }],
                }],
            }),
            ctx,
        ));
        expect(stagedResult.totalStaged).toBe(1);
        expect(staged).toHaveLength(1);
    });
});
