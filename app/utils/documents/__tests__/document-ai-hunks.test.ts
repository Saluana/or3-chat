import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { freezeDocumentForAi, buildDocumentAiCandidate } from '../document-ai-operations';
import {
    createDocumentAiHunks,
    describeDocumentAiOperation,
    projectFreezeRootsAfterOps,
    resolveHunkAnchor,
} from '../document-ai-hunks';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

function makeEditor() {
    editor = new Editor({
        extensions: [StarterKit],
        content: {
            type: 'doc',
            content: [
                { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'One' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Three' }] },
            ],
        },
    });
    return editor;
}

describe('document AI hunk labels', () => {
    it('uses human titles and never exposes block refs like b2', () => {
        const current = makeEditor();
        const snapshot = freezeDocumentForAi(current);
        const described = describeDocumentAiOperation({
            kind: 'replace_block',
            ref: 'b2',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Water during dry weather.' }] }],
        }, snapshot);
        expect(described.label).toBe('Water during dry weather.');
        expect(described.label).not.toMatch(/\bb\d+\b/u);

        const hunks = createDocumentAiHunks([{
            kind: 'replace_block',
            ref: 'b2',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Water during dry weather.' }] }],
        }], snapshot);
        expect(hunks[0]?.id).toBe('change-1');
        expect(hunks[0]?.number).toBe(1);
        expect(hunks[0]?.label).toBe('Water during dry weather.');
        expect(JSON.stringify(hunks)).not.toMatch(/Replace b\d+/u);
    });
});

describe('document AI hunk anchors', () => {
    it('remaps later freeze refs after an earlier replace is accepted', () => {
        const current = makeEditor();
        const snapshot = freezeDocumentForAi(current);
        const accepted = [{
            kind: 'replace_block' as const,
            ref: 'b1',
            content: [
                { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'New title' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] },
            ],
        }];

        const projected = projectFreezeRootsAfterOps(snapshot, accepted);
        expect(projected.map((entry) => entry.ref)).toEqual([undefined, undefined, 'b2', 'b3']);

        current.commands.setContent(buildDocumentAiCandidate(current, snapshot, accepted));

        const anchor = resolveHunkAnchor(current, snapshot, accepted, {
            kind: 'replace_block',
            ref: 'b3',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated three' }] }],
        });
        expect(anchor).not.toBeNull();
        expect(anchor?.nodeRange).not.toBeNull();

        // Live top-level index for b3 should be 3 (after two inserted nodes + b2).
        const textAtAnchor = current.state.doc.textBetween(
            anchor!.nodeRange!.from,
            anchor!.nodeRange!.to,
            '\n',
        );
        expect(textAtAnchor).toContain('Three');
    });

    it('anchors the first pending replace before any accepts', () => {
        const current = makeEditor();
        const snapshot = freezeDocumentForAi(current);
        const anchor = resolveHunkAnchor(current, snapshot, [], {
            kind: 'replace_block',
            ref: 'b2',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated' }] }],
        });
        expect(anchor?.side).toBe(-1);
        expect(current.state.doc.textBetween(
            anchor!.nodeRange!.from,
            anchor!.nodeRange!.to,
            '\n',
        )).toContain('Two');
    });
});
