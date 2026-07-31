import type { Editor } from '@tiptap/core';
import type { DocumentAiScope } from '~/composables/editor/useDocumentAiActions';

export interface DocumentAiScopeRange {
    from: number;
    to: number;
    mode: 'block' | 'inline';
}

/**
 * Resolve the live editor range Document AI will consider for a scope.
 * Used for the composer scope highlight (not the frozen review widgets).
 */
export function resolveDocumentAiScopeRange(
    editor: Editor,
    scope: DocumentAiScope,
): DocumentAiScopeRange | null {
    const doc = editor.state.doc;
    const docSize = doc.content.size;

    if (scope === 'document') {
        if (docSize <= 0) return null;
        return { from: 0, to: docSize, mode: 'block' };
    }

    if (scope === 'selection') {
        const { from, to, empty } = editor.state.selection;
        if (empty || from === to) return null;
        return { from, to, mode: 'inline' };
    }

    // Section: from nearest heading through the next equal/higher heading.
    // Docs without headings treat "section" as the caret's current block only —
    // never the whole document (that left every block painted with scope chrome).
    let selectedIndex = 0;
    const blocks: Array<{ index: number; from: number; to: number; isHeading: boolean; level: number }> = [];
    doc.forEach((node, position, index) => {
        const end = position + node.nodeSize;
        blocks.push({
            index,
            from: position,
            to: end,
            isHeading: node.type.name === 'heading',
            level: node.type.name === 'heading' ? Number(node.attrs?.level ?? 1) : 4,
        });
        const caret = editor.state.selection.from;
        if (caret >= position && caret <= end) selectedIndex = index;
    });
    if (!blocks.length) return null;

    if (!blocks.some((block) => block.isHeading)) {
        const block = blocks[selectedIndex];
        if (!block) return null;
        return { from: block.from, to: block.to, mode: 'block' };
    }

    let start = selectedIndex;
    while (start > 0 && !blocks[start]?.isHeading) start -= 1;
    const startLevel = blocks[start]?.isHeading ? blocks[start]!.level : 4;
    let endIndex = blocks.length - 1;
    for (let index = start + 1; index < blocks.length; index += 1) {
        const block = blocks[index]!;
        if (block.isHeading && block.level <= startLevel) {
            endIndex = index - 1;
            break;
        }
    }

    const from = blocks[start]?.from ?? 0;
    const to = blocks[endIndex]?.to ?? docSize;
    if (to <= from) return null;
    return { from, to, mode: 'block' };
}
