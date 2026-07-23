import type { Editor, JSONContent } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';

export const MAX_DOCUMENT_AI_OPERATIONS = 64;
export const MAX_DOCUMENT_AI_OUTPUT_BYTES = 256 * 1024;

export type DocumentAiOperation =
    | { kind: 'replace_selection'; content: JSONContent[] }
    | { kind: 'replace_block'; ref: string; content: JSONContent[] }
    | { kind: 'delete_block'; ref: string }
    | { kind: 'insert_before'; ref: string; content: JSONContent[] }
    | { kind: 'insert_after'; ref: string; content: JSONContent[] }
    | { kind: 'insert_end'; content: JSONContent[] };

export interface DocumentAiBlockReference {
    ref: string;
    index: number;
    type: string;
    text: string;
    node: JSONContent;
}

export interface DocumentAiFrozenSnapshot {
    content: JSONContent;
    blocks: DocumentAiBlockReference[];
    selection: { from: number; to: number; text: string } | null;
}

export interface DocumentAiDiffSummary {
    added: number;
    removed: number;
    changed: number;
    entries: Array<{ kind: 'added' | 'removed' | 'changed'; before?: string; after?: string }>;
}

export function parseDocumentAiOperations(value: unknown): DocumentAiOperation[] {
    const raw = value && typeof value === 'object'
        ? (value as { operations?: unknown }).operations
        : undefined;
    if (!Array.isArray(raw)) throw new Error('AI response did not include an operations array.');
    return raw.map((item) => {
        if (!item || typeof item !== 'object') throw new Error('AI edit operation is invalid.');
        const operation = item as Record<string, unknown>;
        const kind = operation.kind;
        if (
            kind !== 'replace_selection'
            && kind !== 'replace_block'
            && kind !== 'delete_block'
            && kind !== 'insert_before'
            && kind !== 'insert_after'
            && kind !== 'insert_end'
        ) throw new Error(`Unsupported AI edit operation: ${String(kind)}`);
        if (kind !== 'replace_selection' && kind !== 'insert_end' && typeof operation.ref !== 'string') {
            throw new Error('AI edit operation is missing a block reference.');
        }
        if (kind !== 'delete_block' && !Array.isArray(operation.content)) {
            throw new Error('AI edit operation is missing node content.');
        }
        return operation as unknown as DocumentAiOperation;
    });
}

function textOf(node: JSONContent): string {
    if (typeof node.text === 'string') return node.text;
    return (node.content ?? []).map(textOf).join(node.type === 'paragraph' ? '' : ' ');
}

export function freezeDocumentForAi(editor: Editor): DocumentAiFrozenSnapshot {
    const content = editor.getJSON();
    const blocks = (content.content ?? []).map((node, index) => ({
        ref: `b${index + 1}`,
        index,
        type: node.type ?? 'unknown',
        text: textOf(node).trim(),
        node,
    }));
    const { from, to } = editor.state.selection;
    return {
        content,
        blocks,
        selection: from !== to
            ? { from, to, text: editor.state.doc.textBetween(from, to, '\n') }
            : null,
    };
}

function hasInvalidLink(node: JSONContent): boolean {
    for (const mark of node.marks ?? []) {
        if (mark.type !== 'link') continue;
        const href = String(mark.attrs?.href ?? '').trim();
        if (!href || /^(?:javascript|data|vbscript):/iu.test(href)) return true;
    }
    return (node.content ?? []).some(hasInvalidLink);
}

function validateInsertedNodes(editor: Editor, nodes: JSONContent[]): void {
    if (!Array.isArray(nodes) || !nodes.length) {
        throw new Error('AI edit content must include at least one node.');
    }
    for (const node of nodes) {
        if (hasInvalidLink(node)) throw new Error('AI edit contains an unsafe link.');
        editor.schema.nodeFromJSON(node);
    }
}

export function buildDocumentAiCandidate(
    editor: Editor,
    snapshot: DocumentAiFrozenSnapshot,
    operations: DocumentAiOperation[]
): JSONContent {
    if (!Array.isArray(operations) || !operations.length || operations.length > MAX_DOCUMENT_AI_OPERATIONS) {
        throw new Error(`AI must propose between 1 and ${MAX_DOCUMENT_AI_OPERATIONS} operations.`);
    }
    if (new TextEncoder().encode(JSON.stringify(operations)).byteLength > MAX_DOCUMENT_AI_OUTPUT_BYTES) {
        throw new Error('AI edit output is too large.');
    }
    const selectionOperations = operations.filter((operation) => operation.kind === 'replace_selection');
    if (selectionOperations.length) {
        if (operations.length !== 1 || !snapshot.selection) {
            throw new Error('Selection replacement must be the only operation and requires a frozen selection.');
        }
        const operation = selectionOperations[0]!;
        validateInsertedNodes(editor, operation.content);
        const doc = editor.schema.nodeFromJSON(snapshot.content);
        const tr = EditorState.create({ doc }).tr.replaceWith(
            snapshot.selection!.from,
            snapshot.selection!.to,
            operation.content.map((node) => editor.schema.nodeFromJSON(node))
        );
        return tr.doc.toJSON();
    }

    const roots = (snapshot.content.content ?? []).map((node, index) => ({
        node,
        ref: snapshot.blocks[index]?.ref,
    }));
    const knownReferences = new Set(snapshot.blocks.map((block) => block.ref));
    const seen = new Set<string>();

    for (const operation of operations) {
        if (operation.kind === 'insert_end') {
            validateInsertedNodes(editor, operation.content);
            roots.push(...operation.content.map((node) => ({ node, ref: undefined })));
            continue;
        }
        if (operation.kind === 'replace_selection') {
            throw new Error('Selection replacement cannot be combined with block operations.');
        }
        if (!knownReferences.has(operation.ref)) {
            throw new Error(`Unknown document block reference: ${operation.ref}`);
        }
        if (seen.has(operation.ref)) throw new Error(`Block ${operation.ref} is edited more than once.`);
        const index = roots.findIndex((entry) => entry.ref === operation.ref);
        if (index < 0) throw new Error(`Block ${operation.ref} is no longer available.`);
        if (operation.kind === 'delete_block') {
            roots.splice(index, 1);
            seen.add(operation.ref);
            continue;
        }
        validateInsertedNodes(editor, operation.content);
        const inserted = operation.content.map((node) => ({ node, ref: undefined as string | undefined }));
        if (operation.kind === 'replace_block') roots.splice(index, 1, ...inserted);
        else if (operation.kind === 'insert_before') roots.splice(index, 0, ...inserted);
        else roots.splice(index + 1, 0, ...inserted);
        seen.add(operation.ref);
    }
    const candidate: JSONContent = {
        type: 'doc',
        content: roots.length ? roots.map((entry) => entry.node) : [{ type: 'paragraph' }],
    };
    editor.schema.nodeFromJSON(candidate);
    return candidate;
}

export function summarizeDocumentAiDiff(
    before: JSONContent,
    after: JSONContent
): DocumentAiDiffSummary {
    const left = before.content ?? [];
    const right = after.content ?? [];
    const entries: DocumentAiDiffSummary['entries'] = [];
    const count = Math.max(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
        const beforeNode = left[index];
        const afterNode = right[index];
        if (!beforeNode && afterNode) entries.push({ kind: 'added', after: textOf(afterNode) });
        else if (beforeNode && !afterNode) entries.push({ kind: 'removed', before: textOf(beforeNode) });
        else if (JSON.stringify(beforeNode) !== JSON.stringify(afterNode)) {
            entries.push({ kind: 'changed', before: textOf(beforeNode!), after: textOf(afterNode!) });
        }
    }
    return {
        added: entries.filter((entry) => entry.kind === 'added').length,
        removed: entries.filter((entry) => entry.kind === 'removed').length,
        changed: entries.filter((entry) => entry.kind === 'changed').length,
        entries: entries.slice(0, 32),
    };
}
