import { registerShikiLanguages } from 'streamdown-vue';

// Keep the renderer's language registry and fallback behavior, but initialize
// local grammars only when a fence uses them. The default entry otherwise
// loads every local grammar together on the first code block (or docs warmup).
// This module stays behind the existing lazy message/documentation boundaries.
registerShikiLanguages([
    { id: 'typescript', aliases: ['ts'], lazy: true, loader: () => import('@shikijs/langs/typescript') },
    { id: 'tsx', lazy: true, loader: () => import('@shikijs/langs/tsx') },
    { id: 'javascript', aliases: ['js'], lazy: true, loader: () => import('@shikijs/langs/javascript') },
    { id: 'jsx', lazy: true, loader: () => import('@shikijs/langs/jsx') },
    { id: 'json', lazy: true, loader: () => import('@shikijs/langs/json') },
    { id: 'bash', lazy: true, loader: () => import('@shikijs/langs/bash') },
    { id: 'shell', aliases: ['shellscript', 'shellsession', 'sh', 'zsh'], lazy: true, loader: () => import('@shikijs/langs/shellscript') },
    { id: 'python', aliases: ['py'], lazy: true, loader: () => import('@shikijs/langs/python') },
    { id: 'diff', lazy: true, loader: () => import('@shikijs/langs/diff') },
    { id: 'markdown', aliases: ['md'], lazy: true, loader: () => import('@shikijs/langs/markdown') },
    { id: 'vue', lazy: true, loader: () => import('@shikijs/langs/vue') },
    { id: 'html', lazy: true, loader: () => import('@shikijs/langs/html') },
    { id: 'css', lazy: true, loader: () => import('@shikijs/langs/css') },
    { id: 'go', lazy: true, loader: () => import('@shikijs/langs/go') },
    { id: 'rust', lazy: true, loader: () => import('@shikijs/langs/rust') },
    { id: 'yaml', aliases: ['yml'], lazy: true, loader: () => import('@shikijs/langs/yaml') },
]);

export { StreamMarkdown, useShikiHighlighter } from 'streamdown-vue';
