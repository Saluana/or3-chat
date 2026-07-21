import { computed, onScopeDispose, readonly, ref, watch, type Ref } from 'vue';
import type { Editor } from '@tiptap/vue-3';

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

function countWords(text: string): number {
    const normalized = text.trim();
    if (!normalized) return 0;
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
        return [...segmenter.segment(normalized)].filter((part) => part.isWordLike).length;
    }
    return normalized.split(/\s+/u).length;
}

export function useDocumentInsights(editor: Ref<Editor | null>) {
    const outline = ref<DocumentOutlineItem[]>([]);
    const activeOutlineId = ref<string>();
    const words = ref(0);
    const characters = ref(0);
    const blocks = ref(0);
    const serializedBytes = ref(0);
    let frame = 0;
    let attachedEditor: Editor | null = null;

    function recompute() {
        frame = 0;
        const current = editor.value;
        if (!current) return;
        const nextOutline: DocumentOutlineItem[] = [];
        let topLevelBlocks = 0;
        current.state.doc.forEach(() => { topLevelBlocks += 1; });
        current.state.doc.descendants((node, position) => {
            if (node.type.name !== 'heading') return;
            const level = Number(node.attrs.level);
            if (level < 1 || level > 3) return;
            nextOutline.push({
                id: `heading-${position}`,
                level: level as 1 | 2 | 3,
                text: node.textContent.trim() || 'Untitled section',
                position,
            });
        });
        const selectionPosition = current.state.selection.from;
        activeOutlineId.value = [...nextOutline]
            .reverse()
            .find((item) => item.position <= selectionPosition)?.id;
        outline.value = nextOutline;
        const text = current.state.doc.textContent;
        words.value = countWords(text);
        characters.value = text.length;
        blocks.value = topLevelBlocks;
    }

    function schedule() {
        if (frame || typeof requestAnimationFrame === 'undefined') {
            if (!frame) recompute();
            return;
        }
        frame = requestAnimationFrame(recompute);
    }

    function detach() {
        if (!attachedEditor) return;
        attachedEditor.off('transaction', schedule);
        attachedEditor = null;
    }

    const stop = watch(editor, (nextEditor) => {
        detach();
        attachedEditor = nextEditor;
        attachedEditor?.on('transaction', schedule);
        schedule();
    }, { immediate: true });

    onScopeDispose(() => {
        stop();
        detach();
        if (frame) cancelAnimationFrame(frame);
    });

    const stats = computed<DocumentStats>(() => ({
        words: words.value,
        characters: characters.value,
        blocks: blocks.value,
        readingMinutes: words.value ? Math.max(1, Math.ceil(words.value / 200)) : 0,
        serializedBytes: serializedBytes.value,
    }));

    function scrollTo(item: DocumentOutlineItem) {
        const current = editor.value;
        if (!current) return;
        current.chain().focus().setTextSelection(item.position + 1).scrollIntoView().run();
    }

    return {
        outline: readonly(outline),
        activeOutlineId: readonly(activeOutlineId),
        stats,
        scrollTo,
        setSerializedSize: (size: number) => { serializedBytes.value = Math.max(0, size); },
        refresh: schedule,
    };
}
