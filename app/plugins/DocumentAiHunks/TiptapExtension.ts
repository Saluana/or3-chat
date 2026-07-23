import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { DocumentAiHunk } from '~/utils/documents/document-ai-hunks';
import type { DocumentAiFrozenSnapshot } from '~/utils/documents/document-ai-operations';
import {
    acceptedDocumentAiOperations,
    clipDocumentAiPreview,
    resolveHunkAnchor,
} from '~/utils/documents/document-ai-hunks';

export interface DocumentAiHunksStorage {
    hunks: DocumentAiHunk[];
    snapshot: DocumentAiFrozenSnapshot | null;
    activeHunkId: string | null;
    onAcceptHunk: ((hunkId: string) => void) | null;
    onDiscardHunk: ((hunkId: string) => void) | null;
    onFocusHunk: ((hunkId: string) => void) | null;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        documentAiHunks: {
            setDocumentAiHunks: (payload: {
                hunks: DocumentAiHunk[];
                snapshot: DocumentAiFrozenSnapshot | null;
                activeHunkId?: string | null;
            }) => ReturnType;
            clearDocumentAiHunks: () => ReturnType;
            setDocumentAiHunkHandlers: (payload: {
                onAcceptHunk?: ((hunkId: string) => void) | null;
                onDiscardHunk?: ((hunkId: string) => void) | null;
                onFocusHunk?: ((hunkId: string) => void) | null;
            }) => ReturnType;
            setActiveDocumentAiHunk: (hunkId: string | null) => ReturnType;
        };
    }
}

const pluginKey = new PluginKey('documentAiHunks');
const PREVIEW_CLIP = 280;

function emptyStorage(): DocumentAiHunksStorage {
    return {
        hunks: [],
        snapshot: null,
        activeHunkId: null,
        onAcceptHunk: null,
        onDiscardHunk: null,
        onFocusHunk: null,
    };
}

function makeButton(className: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return button;
}

function makePane(
    variant: 'before' | 'after',
    text: string,
    expanded: boolean,
): HTMLElement {
    const pane = document.createElement('div');
    pane.className = `document-ai-hunk-pane is-${variant}`;
    const mark = document.createElement('span');
    mark.className = 'document-ai-hunk-pane-mark';
    mark.textContent = variant === 'before' ? '−' : '+';
    mark.setAttribute('aria-hidden', 'true');
    const stack = document.createElement('div');
    stack.className = 'document-ai-hunk-pane-stack';
    const label = document.createElement('span');
    label.className = 'document-ai-hunk-pane-label';
    label.textContent = variant === 'before' ? 'Removed' : 'Added';
    const body = document.createElement('div');
    body.className = 'document-ai-hunk-pane-text';
    body.textContent = expanded ? text : clipDocumentAiPreview(text, PREVIEW_CLIP);
    stack.append(label, body);
    pane.append(mark, stack);
    return pane;
}

function buildMarkerChip(
    hunk: DocumentAiHunk,
    displayNumber: number,
    active: boolean,
    onFocus: ((id: string) => void) | null,
): HTMLElement {
    const root = document.createElement('button');
    root.type = 'button';
    root.className = `document-ai-change-marker${active ? ' is-active' : ''}`;
    root.dataset.hunkId = hunk.id;
    root.contentEditable = 'false';
    root.setAttribute('aria-label', `Change ${displayNumber}: ${hunk.label}`);
    root.textContent = String(displayNumber);
    root.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onFocus?.(hunk.id);
    });
    return root;
}

function buildReviewCard(
    hunk: DocumentAiHunk,
    displayNumber: number,
    onAccept: ((id: string) => void) | null,
    onDiscard: ((id: string) => void) | null,
): HTMLElement {
    const root = document.createElement('div');
    root.className = 'document-ai-hunk is-active';
    root.dataset.hunkId = hunk.id;
    root.contentEditable = 'false';

    const header = document.createElement('div');
    header.className = 'document-ai-hunk-header';
    const badge = document.createElement('span');
    badge.className = 'document-ai-hunk-badge';
    badge.textContent = String(displayNumber);
    const title = document.createElement('strong');
    title.className = 'document-ai-hunk-title';
    title.textContent = hunk.label;
    header.append(badge, title);

    const body = document.createElement('div');
    body.className = 'document-ai-hunk-body is-collapsed';

    const beforeFull = hunk.beforePreview;
    const afterFull = hunk.afterPreview;
    const needsExpand = beforeFull.length > PREVIEW_CLIP || afterFull.length > PREVIEW_CLIP;
    let expanded = false;

    if (beforeFull) body.appendChild(makePane('before', beforeFull, false));
    if (afterFull) body.appendChild(makePane('after', afterFull, false));

    const actions = document.createElement('div');
    actions.className = 'document-ai-hunk-actions';

    if (needsExpand) {
        actions.appendChild(makeButton('document-ai-hunk-toggle', 'Show more', () => {
            expanded = !expanded;
            body.classList.toggle('is-collapsed', !expanded);
            body.classList.toggle('is-expanded', expanded);
            const toggle = actions.querySelector('.document-ai-hunk-toggle');
            if (toggle) toggle.textContent = expanded ? 'Show less' : 'Show more';
            const beforeText = body.querySelector('.is-before .document-ai-hunk-pane-text');
            const afterText = body.querySelector('.is-after .document-ai-hunk-pane-text');
            if (beforeText) {
                beforeText.textContent = expanded
                    ? beforeFull
                    : clipDocumentAiPreview(beforeFull, PREVIEW_CLIP);
            }
            if (afterText) {
                afterText.textContent = expanded
                    ? afterFull
                    : clipDocumentAiPreview(afterFull, PREVIEW_CLIP);
            }
        }));
    }

    actions.append(
        makeButton('document-ai-hunk-discard', 'Reject', () => onDiscard?.(hunk.id)),
        makeButton('document-ai-hunk-accept', 'Accept', () => onAccept?.(hunk.id)),
    );

    root.append(header, body, actions);
    return root;
}

function buildDecorations(
    storage: DocumentAiHunksStorage,
    editor: import('@tiptap/core').Editor,
): DecorationSet {
    if (!storage.snapshot || !storage.hunks.length) return DecorationSet.empty;
    const pending = storage.hunks.filter((hunk) => hunk.status === 'pending');
    if (!pending.length) return DecorationSet.empty;

    const acceptedOps = acceptedDocumentAiOperations(storage.hunks);
    const activeId = storage.activeHunkId ?? pending[0]?.id ?? null;
    const decorations: ReturnType<typeof Decoration.widget>[] = [];

    pending.forEach((hunk, index) => {
        const displayNumber = index + 1;
        const anchor = resolveHunkAnchor(
            editor,
            storage.snapshot!,
            acceptedOps,
            hunk.op,
        );
        if (!anchor) return;
        const { widgetPos, side, nodeRange } = anchor;
        if (widgetPos < 0 || widgetPos > editor.state.doc.content.size) return;
        const isActive = activeId === hunk.id;

        decorations.push(
            Decoration.widget(
                widgetPos,
                () => (isActive
                    ? buildReviewCard(
                        hunk,
                        displayNumber,
                        storage.onAcceptHunk,
                        storage.onDiscardHunk,
                    )
                    : buildMarkerChip(
                        hunk,
                        displayNumber,
                        false,
                        storage.onFocusHunk,
                    )),
                {
                    side,
                    key: `${hunk.id}:${isActive ? 'card' : 'marker'}`,
                },
            ),
        );

        if (nodeRange) {
            decorations.push(
                Decoration.node(nodeRange.from, nodeRange.to, {
                    class: [
                        'document-ai-hunk-target',
                        hunk.kind === 'remove' ? 'is-delete' : 'is-replace',
                        isActive ? 'is-active' : '',
                    ].filter(Boolean).join(' '),
                }),
            );
        }
    });

    return DecorationSet.create(editor.state.doc, decorations);
}

export const DocumentAiHunks = Extension.create({
    name: 'documentAiHunks',

    addStorage() {
        return emptyStorage();
    },

    addCommands() {
        return {
            setDocumentAiHunks: (payload) => ({ editor, tr }) => {
                editor.storage.documentAiHunks.hunks = payload.hunks;
                editor.storage.documentAiHunks.snapshot = payload.snapshot;
                if (payload.activeHunkId !== undefined) {
                    editor.storage.documentAiHunks.activeHunkId = payload.activeHunkId;
                } else {
                    editor.storage.documentAiHunks.activeHunkId =
                        payload.hunks.find((hunk) => hunk.status === 'pending')?.id ?? null;
                }
                tr.setMeta(pluginKey, { refresh: true });
                return true;
            },
            clearDocumentAiHunks: () => ({ editor, tr }) => {
                editor.storage.documentAiHunks = {
                    ...emptyStorage(),
                    onAcceptHunk: editor.storage.documentAiHunks.onAcceptHunk,
                    onDiscardHunk: editor.storage.documentAiHunks.onDiscardHunk,
                    onFocusHunk: editor.storage.documentAiHunks.onFocusHunk,
                };
                tr.setMeta(pluginKey, { refresh: true });
                return true;
            },
            setDocumentAiHunkHandlers: (payload) => ({ editor }) => {
                if (payload.onAcceptHunk !== undefined) {
                    editor.storage.documentAiHunks.onAcceptHunk = payload.onAcceptHunk;
                }
                if (payload.onDiscardHunk !== undefined) {
                    editor.storage.documentAiHunks.onDiscardHunk = payload.onDiscardHunk;
                }
                if (payload.onFocusHunk !== undefined) {
                    editor.storage.documentAiHunks.onFocusHunk = payload.onFocusHunk;
                }
                return true;
            },
            setActiveDocumentAiHunk: (hunkId) => ({ editor, tr }) => {
                editor.storage.documentAiHunks.activeHunkId = hunkId;
                tr.setMeta(pluginKey, { refresh: true });
                return true;
            },
        };
    },

    addProseMirrorPlugins() {
        const extension = this;
        return [
            new Plugin({
                key: pluginKey,
                state: {
                    init: () => DecorationSet.empty,
                    apply(tr, set, _old, state) {
                        const storage = extension.editor.storage.documentAiHunks as DocumentAiHunksStorage;
                        if (tr.getMeta(pluginKey)?.refresh || tr.docChanged) {
                            return buildDecorations(storage, extension.editor);
                        }
                        void state;
                        return set.map(tr.mapping, tr.doc);
                    },
                },
                props: {
                    decorations(state) {
                        return pluginKey.getState(state);
                    },
                },
            }),
        ];
    },
});
