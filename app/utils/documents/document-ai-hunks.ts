import type { Editor, JSONContent } from '@tiptap/core';
import type {
    DocumentAiFrozenSnapshot,
    DocumentAiOperation,
} from './document-ai-operations';

export type DocumentAiHunkStatus = 'pending' | 'accepted' | 'discarded';

export type DocumentAiHunkKind =
    | 'replace'
    | 'remove'
    | 'add';

export interface DocumentAiHunk {
    id: string;
    /** Stable 1-based order from the original proposal (never a block ref). */
    number: number;
    op: DocumentAiOperation;
    status: DocumentAiHunkStatus;
    /** Human-readable title for UI — never exposes internal block refs. */
    label: string;
    kind: DocumentAiHunkKind;
    /** Full before text for review (may be long). */
    beforePreview: string;
    /** Full after text for review (may be long). */
    afterPreview: string;
}

export interface DocumentAiHunkAnchor {
    /** Widget insertion position in the live document. */
    widgetPos: number;
    /** -1 = before the position, 1 = after. */
    side: -1 | 1;
    /** Optional live range to highlight (replace/delete targets). */
    nodeRange: { from: number; to: number } | null;
}

/** Soft cap so a single hunk cannot explode UI memory. */
const MAX_PREVIEW_CHARS = 100_000;

function textOf(node: JSONContent): string {
    if (typeof node.text === 'string') return node.text;
    return (node.content ?? []).map(textOf).join(node.type === 'paragraph' ? '' : '\n');
}

export function clipDocumentAiPreview(value: string, max = 160): string {
    const trimmed = value.trim();
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, max - 1)}…`;
}

function fullPreview(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length <= MAX_PREVIEW_CHARS) return trimmed;
    return `${trimmed.slice(0, MAX_PREVIEW_CHARS - 1)}…`;
}

function contentPreview(nodes: JSONContent[]): string {
    return fullPreview(nodes.map(textOf).join('\n\n'));
}

function firstLineTitle(text: string, fallback: string): string {
    const line = text.trim().split(/\n/u)[0]?.replace(/\s+/gu, ' ') ?? '';
    if (!line) return fallback;
    return clipDocumentAiPreview(line, 52);
}

function kindForOperation(operation: DocumentAiOperation): DocumentAiHunkKind {
    switch (operation.kind) {
        case 'delete_block':
            return 'remove';
        case 'insert_before':
        case 'insert_after':
        case 'insert_end':
            return 'add';
        case 'replace_selection':
        case 'replace_block':
            return 'replace';
        default: {
            const _exhaustive: never = operation;
            return _exhaustive;
        }
    }
}

export function describeDocumentAiOperation(
    operation: DocumentAiOperation,
    snapshot: DocumentAiFrozenSnapshot,
): { label: string; kind: DocumentAiHunkKind; beforePreview: string; afterPreview: string } {
    const kind = kindForOperation(operation);
    switch (operation.kind) {
        case 'replace_selection': {
            const before = fullPreview(snapshot.selection?.text ?? '');
            const after = contentPreview(operation.content);
            return {
                kind,
                label: firstLineTitle(after || before, 'Updated selection'),
                beforePreview: before,
                afterPreview: after,
            };
        }
        case 'replace_block': {
            const block = snapshot.blocks.find((entry) => entry.ref === operation.ref);
            const before = fullPreview(block?.text ?? '');
            const after = contentPreview(operation.content);
            return {
                kind,
                label: firstLineTitle(after || before, 'Updated paragraph'),
                beforePreview: before,
                afterPreview: after,
            };
        }
        case 'delete_block': {
            const block = snapshot.blocks.find((entry) => entry.ref === operation.ref);
            const before = fullPreview(block?.text ?? '');
            return {
                kind,
                label: firstLineTitle(before, 'Removed paragraph'),
                beforePreview: before,
                afterPreview: '',
            };
        }
        case 'insert_before':
        case 'insert_after':
        case 'insert_end': {
            const after = contentPreview(operation.content);
            return {
                kind,
                label: firstLineTitle(after, 'Added content'),
                beforePreview: '',
                afterPreview: after,
            };
        }
        default: {
            const _exhaustive: never = operation;
            return _exhaustive;
        }
    }
}

export function createDocumentAiHunks(
    operations: readonly DocumentAiOperation[],
    snapshot: DocumentAiFrozenSnapshot,
): DocumentAiHunk[] {
    return operations.map((op, index) => {
        const described = describeDocumentAiOperation(op, snapshot);
        return {
            id: `change-${index + 1}`,
            number: index + 1,
            op,
            status: 'pending',
            label: described.label,
            kind: described.kind,
            beforePreview: described.beforePreview,
            afterPreview: described.afterPreview,
        };
    });
}

/**
 * Simulate accepted ops against freeze refs so remaining pending ops can be
 * anchored in the live document after earlier accepts shifted block indices.
 */
export function projectFreezeRootsAfterOps(
    snapshot: DocumentAiFrozenSnapshot,
    appliedOps: readonly DocumentAiOperation[],
): Array<{ ref?: string }> {
    const roots: Array<{ ref?: string }> = (snapshot.content.content ?? []).map((_, index) => ({
        ref: snapshot.blocks[index]?.ref,
    }));

    for (const operation of appliedOps) {
        if (operation.kind === 'replace_selection') continue;
        if (operation.kind === 'insert_end') {
            for (let i = 0; i < operation.content.length; i += 1) {
                roots.push({ ref: undefined });
            }
            continue;
        }
        const index = roots.findIndex((entry) => entry.ref === operation.ref);
        if (index < 0) continue;
        if (operation.kind === 'delete_block') {
            roots.splice(index, 1);
            continue;
        }
        const inserted = operation.content.map(() => ({ ref: undefined as string | undefined }));
        if (operation.kind === 'replace_block') roots.splice(index, 1, ...inserted);
        else if (operation.kind === 'insert_before') roots.splice(index, 0, ...inserted);
        else roots.splice(index + 1, 0, ...inserted);
    }
    return roots;
}

export function findLiveTopLevelRange(
    editor: Editor,
    topLevelIndex: number,
): { from: number; to: number } | null {
    let from = -1;
    let to = -1;
    editor.state.doc.forEach((node, pos, index) => {
        if (index !== topLevelIndex) return;
        from = pos;
        to = pos + node.nodeSize;
    });
    if (from < 0) return null;
    return { from, to };
}

/** Map a frozen block ref to a live ProseMirror block range (pre-accept only). */
export function findFrozenBlockRange(
    editor: Editor,
    snapshot: DocumentAiFrozenSnapshot,
    ref: string,
): { from: number; to: number } | null {
    const block = snapshot.blocks.find((entry) => entry.ref === ref);
    if (!block) return null;
    return findLiveTopLevelRange(editor, block.index);
}

/**
 * Resolve where a pending hunk should render after zero or more accepted ops
 * have already been applied to the live editor.
 */
export function resolveHunkAnchor(
    editor: Editor,
    snapshot: DocumentAiFrozenSnapshot,
    acceptedOps: readonly DocumentAiOperation[],
    operation: DocumentAiOperation,
): DocumentAiHunkAnchor | null {
    const docSize = editor.state.doc.content.size;

    if (operation.kind === 'replace_selection') {
        if (!snapshot.selection || acceptedOps.length) return null;
        return {
            widgetPos: snapshot.selection.from,
            side: -1,
            nodeRange: null,
        };
    }

    if (operation.kind === 'insert_end') {
        return {
            widgetPos: Math.max(1, docSize - 1),
            side: 1,
            nodeRange: null,
        };
    }

    const roots = projectFreezeRootsAfterOps(snapshot, acceptedOps);
    const index = roots.findIndex((entry) => entry.ref === operation.ref);
    if (index < 0) return null;
    const range = findLiveTopLevelRange(editor, index);
    if (!range) return null;

    switch (operation.kind) {
        case 'insert_before':
            return { widgetPos: range.from, side: -1, nodeRange: null };
        case 'insert_after':
            return { widgetPos: range.to, side: 1, nodeRange: null };
        case 'replace_block':
        case 'delete_block':
            return {
                widgetPos: range.from,
                side: -1,
                nodeRange: range,
            };
        default: {
            const _exhaustive: never = operation;
            return _exhaustive;
        }
    }
}

export function pendingDocumentAiOperations(
    hunks: readonly DocumentAiHunk[],
): DocumentAiOperation[] {
    return hunks.filter((hunk) => hunk.status === 'pending').map((hunk) => hunk.op);
}

export function acceptedDocumentAiOperations(
    hunks: readonly DocumentAiHunk[],
): DocumentAiOperation[] {
    return hunks.filter((hunk) => hunk.status === 'accepted').map((hunk) => hunk.op);
}
