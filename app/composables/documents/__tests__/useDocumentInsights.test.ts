import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, shallowRef } from 'vue';
import { Editor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { useDocumentInsights } from '../useDocumentInsights';

afterEach(() => vi.useRealTimers());

describe('document insights', () => {
    it('counts rich text exactly, reuses unchanged blocks, and cancels deferred work on disposal', async () => {
        vi.useFakeTimers();
        const editor = new Editor({ extensions: [StarterKit, TableKit], content: {
            type: 'doc', content: [
                { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'My heading' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'hello', marks: [{ type: 'bold' }] },
                    { type: 'text', text: 'world' }, { type: 'hardBreak' }, { type: 'text', text: 'second line' }] },
                { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'table words' }] },
                ] }] }] },
            ],
        } });
        const editorRef = shallowRef<Editor | null>(editor);
        const scope = effectScope();
        const insights = scope.run(() => useDocumentInsights(editorRef))!;
        try {
            await vi.advanceTimersByTimeAsync(0);
            expect(insights.stats.value).toMatchObject({ words: 7, characters: 42, blocks: 3 });
            expect(insights.outline.value).toEqual([{ id: 'heading-0', level: 2, text: 'My heading', position: 0 }]);
            const unchanged = vi.spyOn(editor.state.doc.child(1), 'textBetween');
            editor.commands.setTextSelection(1);
            editor.commands.insertContent('new ');
            expect(insights.stats.value.words).toBe(7); // Outside the typing frame.
            await vi.advanceTimersByTimeAsync(150);
            expect(insights.stats.value.words).toBe(8);
            expect(insights.outline.value[0]?.text).toBe('new My heading');
            expect(unchanged).not.toHaveBeenCalled();
            unchanged.mockRestore();
            editor.commands.insertContent('pending ');
            scope.stop();
            await vi.advanceTimersByTimeAsync(1000);
            expect(insights.stats.value.words).toBe(8);
        } finally { scope.stop(); editor.destroy(); }
    });
});
