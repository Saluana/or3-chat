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
        expect(() => buildDocumentAiCandidate(current, snapshot, [{
            kind: 'replace_block',
            ref: 'b2',
            content: [{
                type: 'paragraph',
                content: [{ type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'file:///tmp/x' } }] }],
            }],
        }])).toThrow(/unsafe link/iu);
    });

    it('rejects oversized or malformed tool output', () => {
        expect(() => parseDocumentAiOperations({ operations: [{ kind: 'invent_node' }] })).toThrow(/unsupported/iu);
        expect(() => parseDocumentAiOperations({})).toThrow(/operations array/iu);
    });

    it('freezes selection TipTap JSON with marks and applies replace_selection without flattening', () => {
        const current = makeEditor();
        current.commands.setContent({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'Hello ' },
                        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
                        { type: 'text', text: ' world' },
                    ],
                },
                { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
            ],
        });

        let boldFrom = -1;
        let boldTo = -1;
        current.state.doc.descendants((node, pos) => {
            if (node.isText && node.text === 'bold' && node.marks.some((mark) => mark.type.name === 'bold')) {
                boldFrom = pos;
                boldTo = pos + node.nodeSize;
            }
        });
        expect(boldFrom).toBeGreaterThan(0);
        current.commands.setTextSelection({ from: boldFrom, to: boldTo });

        const snapshot = freezeDocumentForAi(current);
        expect(snapshot.selection?.content.length).toBeGreaterThan(0);
        expect(JSON.stringify(snapshot.selection?.content)).toContain('"bold"');

        const candidate = buildDocumentAiCandidate(current, snapshot, [{
            kind: 'replace_selection',
            content: [{ type: 'text', text: 'BOLD', marks: [{ type: 'bold' }] }],
        }]);
        const next = current.schema.nodeFromJSON(candidate);
        expect(next.textContent).toContain('BOLD');
        expect(next.textContent).toContain('Second');
        let sawBold = false;
        next.descendants((node) => {
            if (node.isText && node.text === 'BOLD' && node.marks.some((mark) => mark.type.name === 'bold')) {
                sawBold = true;
            }
        });
        expect(sawBold).toBe(true);
    });
});
