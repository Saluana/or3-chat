import { defineComponent, h, onBeforeUnmount, ref, watch } from 'vue';
import { CodeBlock } from 'streamdown-vue';
import { createHighlightWorkerPool, type HighlightInput } from './highlight-worker-pool';
import { useCachedViewActivity } from '~/composables/core/useCachedViewActivity';

// The pool owns no worker until a mounted block requests highlighting, and
// terminates it after its last visible component lease has idled.
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
        let lease: ReturnType<typeof pool.acquire> | undefined;
        const active = useCachedViewActivity();
        let disposed = false;
        let pending = 0;
        let needsRefresh = false;
        const renderKey = ref(0);
        const release = () => {
            needsRefresh ||= pending > 0;
            lease?.release();
            lease = undefined;
        };
        onBeforeUnmount(() => { disposed = true; release(); });
        watch(active, (visible) => {
            if (!visible) { release(); return; }
            if (disposed || typeof window === 'undefined') return;
            lease = pool.acquire();
            // CodeBlock watches code/theme, not the highlight callback. Only
            // remount interrupted/changed blocks; completed HTML stays intact.
            if (needsRefresh) {
                needsRefresh = false;
                renderKey.value++;
            }
        }, { immediate: true, flush: 'sync' });
        const highlight = async (input: HighlightInput) => {
            if (!active.value || disposed || !lease) {
                if (!disposed) needsRefresh = true;
                throw new Error('Syntax highlighting unavailable');
            }
            pending++;
            try {
                return await lease.highlight(input);
            } finally {
                pending--;
            }
        };
        return () => h(CodeBlock, { ...props, ...attrs, key: renderKey.value, highlight }, slots);
    },
});
