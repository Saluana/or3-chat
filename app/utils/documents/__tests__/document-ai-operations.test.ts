import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
    buildDocumentAiCandidate,
    freezeDocumentForAi,
    parseDocumentAiOperations,
    summarizeDocumentAiDiff,
} from '../document-ai-operations';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

function makeEditor() {
    editor = new Editor({
        extensions: [StarterKit],
        content: {
            type: 'doc',
            content: [
                { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Plan' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Old copy' }] },
            ],
        },
    });
    return editor;
}

describe('document AI operations', () => {
    it('maps stable top-level references and builds a schema-valid candidate', () => {
        const current = makeEditor();
        const snapshot = freezeDocumentForAi(current);
        expect(snapshot.blocks.map((block) => block.ref)).toEqual(['b1', 'b2']);
        const candidate = buildDocumentAiCandidate(current, snapshot, [{
            kind: 'replace_block',
            ref: 'b2',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Clear copy' }] }],
        }]);
        expect(current.schema.nodeFromJSON(candidate).textContent).toBe('PlanClear copy');
        expect(summarizeDocumentAiDiff(snapshot.content, candidate).changed).toBe(1);
    });

    it('rejects unknown references and unsafe links', () => {
        const current = makeEditor();
        const snapshot = freezeDocumentForAi(current);
        expect(() => buildDocumentAiCandidate(current, snapshot, [{
            kind: 'delete_block', ref: 'missing',
        }])).toThrow(/unknown/iu);
        expect(() => buildDocumentAiCandidate(current, snapshot, [{
            kind: 'replace_block',
            ref: 'b2',
            content: [{
                type: 'paragraph',
                content: [{ type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
            }],
        }])).toThrow(/unsafe link/iu);
    });

    it('rejects oversized or malformed tool output', () => {
        expect(() => parseDocumentAiOperations({ operations: [{ kind: 'invent_node' }] })).toThrow(/unsupported/iu);
        expect(() => parseDocumentAiOperations({})).toThrow(/operations array/iu);
    });
});
