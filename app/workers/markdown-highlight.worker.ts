/// <reference lib="webworker" />
import { loadRegisteredShikiLanguage, useShikiHighlighter } from 'streamdown-vue/shiki';
import '../utils/stream-markdown-languages';
import type { HighlightRequest, HighlightResponse } from '../utils/markdown/highlight-worker-pool';

const context = self as unknown as DedicatedWorkerGlobalScope;
context.onmessage = async (event: MessageEvent<HighlightRequest>) => {
    const { id, code, language, theme } = event.data;
    try {
        const highlighter = await useShikiHighlighter();
        if (!highlighter.getLoadedLanguages().includes(language)) {
            await loadRegisteredShikiLanguage(language);
        }
        const options = typeof theme === 'string' ? { theme } : { themes: theme };
        const html = highlighter.codeToHtml(code, { lang: language, ...options });
        context.postMessage({ id, html } satisfies HighlightResponse);
    } catch {
        // Never echo message contents or provider data in worker errors.
        context.postMessage({ id, failed: true } satisfies HighlightResponse);
    }
};
