import { createHighlighterCore } from 'shiki/core';
import githubLight from '@shikijs/themes/github-light';
import githubDark from '@shikijs/themes/github-dark';
import typescript from '@shikijs/langs/typescript';

export async function measureEngine(kind) {
    const start = performance.now();
    const engine = kind === 'wasm'
        ? (await import('shiki/engine/oniguruma')).createOnigurumaEngine(import('shiki/wasm'))
        : (await import('shiki/engine/javascript')).createJavaScriptRegexEngine();
    const highlighter = await createHighlighterCore({
        engine, themes: [githubLight, githubDark], langs: [typescript],
    });
    const initialized = performance.now();
    const code = 'export function calculate(values: number[]): number {\n  return values.map(value => value * 2).reduce((sum, value) => sum + value, 0);\n}';
    const html = highlighter.codeToHtml(code, { lang: 'ts', themes: { light: 'github-light', dark: 'github-dark' } });
    const first = performance.now();
    highlighter.codeToHtml(code, { lang: 'ts', themes: { light: 'github-light', dark: 'github-dark' } });
    const warm = performance.now();
    highlighter.dispose();
    return { kind, initializeMs: initialized - start, firstHighlightMs: first - initialized, warmHighlightMs: warm - first, totalMs: warm - start, html };
}
