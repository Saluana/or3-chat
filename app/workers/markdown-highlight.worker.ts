/// <reference lib="webworker" />
import { createStreamingHighlighter, loadRegisteredShikiLanguage, useShikiHighlighter } from 'streamdown-vue/shiki';
import '../utils/stream-markdown-languages';
import type { HighlightWorkerMessage, HighlightResponse } from '../utils/markdown/highlight-worker-pool';

const context = self as unknown as DedicatedWorkerGlobalScope;
const blocks = new Map<number, { highlight?: ReturnType<typeof createStreamingHighlighter> }>();
context.onmessage = async (event: MessageEvent<HighlightWorkerMessage>) => {
    if ('release' in event.data) {
        blocks.delete(event.data.release);
        return;
    }
    const { id, blockId, code, language, theme } = event.data;
    const block = blocks.get(blockId) ?? {};
    blocks.set(blockId, block);
    try {
        const highlighter = await useShikiHighlighter();
        if (!highlighter.getLoadedLanguages().includes(language)) {
            await loadRegisteredShikiLanguage(language);
        }
        // A release can arrive while a lazy grammar is loading. Complete the
        // protocol reply without restoring state owned by an unmounted block.
        if (blocks.get(blockId) !== block) {
            context.postMessage({ id, failed: true } satisfies HighlightResponse);
            return;
        }
        block.highlight ??= createStreamingHighlighter(highlighter);
        const html = block.highlight({ code, language, theme });
        context.postMessage({ id, html } satisfies HighlightResponse);
    } catch {
        // Never echo message contents or provider data in worker errors.
        context.postMessage({ id, failed: true } satisfies HighlightResponse);
    }
};
