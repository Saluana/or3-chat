import { computed, onScopeDispose, readonly, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import { useEventListener } from '@vueuse/core';
import type { Editor } from '@tiptap/vue-3';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

export interface DocumentOutlineItem {
    id: string;
    level: 1 | 2 | 3;
    text: string;
    position: number;
}

export interface DocumentStats {
    words: number;
    characters: number;
    blocks: number;
    readingMinutes: number;
    serializedBytes: number;
}

let wordSegmenter: Intl.Segmenter | undefined;

function countWords(text: string): number {
    const normalized = text.trim();
    if (!normalized) return 0;
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
        const segmenter = wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
        let words = 0;
        for (const part of segmenter.segment(normalized)) {
            if (part.isWordLike) words += 1;
        }
        return words;
    }
    return normalized.split(/\s+/u).length;
}

/** Headings at or above this offset from the viewport top count as the section being read. */
const READING_LINE_PX = 96;

export function useDocumentInsights(
    editor: Ref<Editor | null>,
    enabled: MaybeRefOrGetter<boolean> = true,
    viewport?: MaybeRefOrGetter<HTMLElement | null | undefined>,
) {
    const outline = ref<DocumentOutlineItem[]>([]);
    const activeOutlineId = ref<string>();
    const words = ref(0);
    const characters = ref(0);
    const blocks = ref(0);
    const serializedBytes = ref(0);
    let frame = 0;
    let scrollFrame = 0;
    // Scrolling follows the reading position until the caret moves again.
    let followScroll = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendingSince = 0;
    let attachedEditor: Editor | null = null;
    let scheduledDocument: ProseMirrorNode | null = null;
    type NodeMetrics = { words: number; characters: number; headings: Omit<DocumentOutlineItem, 'id'>[] };
    // Transactions retain unchanged immutable nodes. Reuse their text analysis
    // instead of segmenting the entire document after each keystroke.
    const metrics = new WeakMap<ProseMirrorNode, NodeMetrics>();

    function analyze(node: ProseMirrorNode): NodeMetrics {
        const cached = metrics.get(node);
        if (cached) return cached;
        const result: NodeMetrics = { words: 0, characters: 0, headings: [] };
        if (node.isTextblock) {
            result.words = countWords(node.textBetween(0, node.content.size, '\n', '\n'));
            result.characters = node.textContent.length;
            const level = Number(node.attrs.level);
            if (node.type.name === 'heading' && level >= 1 && level <= 3) {
                result.headings.push({ level: level as 1 | 2 | 3,
                    text: node.textContent.trim() || 'Untitled section', position: 0 });
            }
        } else {
            if (node.isLeaf) result.characters = node.textContent.length;
            node.forEach((child, offset) => {
                const childMetrics = analyze(child);
                result.words += childMetrics.words;
                result.characters += childMetrics.characters;
                for (const heading of childMetrics.headings) {
                    result.headings.push({ ...heading, position: heading.position + offset + 1 });
                }
            });
        }
        metrics.set(node, result);
        return result;
    }

    function updateActiveHeading() {
        frame = 0;
        if (followScroll) {
            updateActiveHeadingFromScroll();
            return;
        }
        const current = editor.value;
        if (!current) return;
        const selectionPosition = current.state.selection.from;
        let nextActiveId: string | undefined;
        for (const item of outline.value) {
            if (item.position > selectionPosition) break;
            nextActiveId = item.id;
        }
        activeOutlineId.value = nextActiveId;
    }

    // While reading, follow the heading at the top of the viewport rather than
    // the caret, which stays wherever the reader last clicked.
    function updateActiveHeadingFromScroll() {
        scrollFrame = 0;
        const current = editor.value;
        const element = toValue(viewport);
        if (!current || !element || !outline.value.length) return;
        const bounds = element.getBoundingClientRect();
        // At the end, the last sections may be too short to reach the reading
        // line; count every heading already on screen.
        const atEnd = element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
        const line = atEnd ? bounds.bottom : bounds.top + element.clientTop + READING_LINE_PX;
        let nextActiveId: string | undefined;
        for (const item of outline.value) {
            const heading = current.view.nodeDOM(item.position);
            if (!(heading instanceof HTMLElement)) continue;
            if (heading.getBoundingClientRect().top > line) break;
            nextActiveId = item.id;
        }
        activeOutlineId.value = nextActiveId;
    }

    function onViewportScroll() {
        if (!toValue(enabled) || scrollFrame) return;
        followScroll = true;
        scrollFrame = requestAnimationFrame(updateActiveHeadingFromScroll);
    }

    function recompute() {
        timer = undefined;
        pendingSince = 0;
        const current = editor.value;
        if (!current) return;
        const doc = current.state.doc;
        const result = analyze(doc);
        outline.value = result.headings.map(heading => {
            const position = heading.position - 1; // The document itself has no opening token.
            return { ...heading, position, id: `heading-${position}` };
        });
        words.value = result.words;
        characters.value = result.characters;
        blocks.value = doc.childCount;
        updateActiveHeading();
    }

    function schedule(event?: { transaction?: Transaction }) {
        if (!toValue(enabled)) return;
        if (event?.transaction?.selectionSet) followScroll = false;
        const doc = editor.value?.state.doc ?? null;
        if (doc !== scheduledDocument) {
            const initial = scheduledDocument === null;
            scheduledDocument = doc;
            if (timer !== undefined) clearTimeout(timer);
            pendingSince ||= Date.now();
            // Statistics are nonurgent. Keep them outside the typing frame,
            // but publish at least once a second during continuous editing.
            timer = setTimeout(recompute, initial ? 0 : Math.max(0, Math.min(150, 1000 - (Date.now() - pendingSince))));
        }
        if (!frame && typeof requestAnimationFrame !== 'undefined') {
            frame = requestAnimationFrame(updateActiveHeading);
        } else if (typeof requestAnimationFrame === 'undefined') {
            updateActiveHeading();
        }
    }

    function detach() {
        attachedEditor?.off('transaction', schedule);
        attachedEditor = null;
        scheduledDocument = null;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        pendingSince = 0;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        if (scrollFrame) cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
    }

    if (viewport) useEventListener(viewport, 'scroll', onViewportScroll, { passive: true });

    const stop = watch([editor, () => toValue(enabled)], ([nextEditor, active]) => {
        detach();
        attachedEditor = active ? nextEditor : null;
        attachedEditor?.on('transaction', schedule);
        if (!nextEditor) {
            outline.value = [];
            activeOutlineId.value = undefined;
            words.value = characters.value = blocks.value = serializedBytes.value = 0;
        }
        schedule();
    }, { immediate: true });

    onScopeDispose(() => {
        stop();
        detach();
    });

    const stats = computed<DocumentStats>(() => ({
        words: words.value,
        characters: characters.value,
        blocks: blocks.value,
        readingMinutes: words.value ? Math.max(1, Math.ceil(words.value / 200)) : 0,
        serializedBytes: serializedBytes.value,
    }));

    function scrollTo(item: DocumentOutlineItem, viewport?: HTMLElement) {
        const current = editor.value;
        if (!current) return;
        // Caret scrolling only guarantees visibility and can leave the heading
        // behind the composer. Align the heading in this pane's scroll viewport.
        current.chain().focus(undefined, { scrollIntoView: false }).setTextSelection(item.position + 1).run();
        const heading = current.view.nodeDOM(item.position);
        if (!viewport || !(heading instanceof HTMLElement)) return;
        viewport.scrollTo({
            top: viewport.scrollTop + heading.getBoundingClientRect().top
                - viewport.getBoundingClientRect().top - viewport.clientTop - 24,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
    }

    return {
        outline: readonly(outline),
        activeOutlineId: readonly(activeOutlineId),
        stats,
        scrollTo,
        setSerializedSize: (size: number) => { serializedBytes.value = Math.max(0, size); },
        refresh: schedule,
        /** Publish stats now, e.g. after loading content, so the first frame is not empty. */
        flush() {
            if (!toValue(enabled)) return;
            if (timer !== undefined) clearTimeout(timer);
            scheduledDocument = editor.value?.state.doc ?? null;
            recompute();
        },
    };
}
