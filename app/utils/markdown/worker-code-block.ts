import { defineComponent, h, onBeforeUnmount } from 'vue';
import { CodeBlock } from 'streamdown-vue';
import { createHighlightWorkerPool, type HighlightInput } from './highlight-worker-pool';

// The pool owns no worker until a mounted block requests highlighting, and
// terminates it when its last component lease is released.
const pool = createHighlightWorkerPool(() => new Worker(
    new URL('../../workers/markdown-highlight.worker.ts', import.meta.url),
    { type: 'module' },
));
if (import.meta.hot) import.meta.hot.dispose(() => pool.dispose());

export const WorkerCodeBlock = defineComponent({
    name: 'WorkerCodeBlock',
    extends: CodeBlock,
    inheritAttrs: false,
    setup(props, { attrs, slots }) {
        // SSR renders the library's plain code and never acquires a worker lease.
        const lease = typeof window === 'undefined' ? undefined : pool.acquire();
        onBeforeUnmount(() => lease?.release());
        const highlight = (input: HighlightInput) => lease?.highlight(input)
            ?? Promise.reject(new Error('Syntax highlighting unavailable'));
        return () => h(CodeBlock, { ...props, ...attrs, highlight }, slots);
    },
});
