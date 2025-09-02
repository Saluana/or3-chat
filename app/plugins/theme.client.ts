import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import css from 'highlight.js/lib/languages/css';

// Register only needed languages to keep bundle smaller
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('python', python);
hljs.registerLanguage('html', xml); // alias
hljs.registerLanguage('rust', rust); // alias
hljs.registerLanguage('css', css); // alias

// Configure marked with highlight.js
marked.use(
    markedHighlight({
        highlight(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch (_) {
                    /* fallthrough */
                }
            }
            return hljs.highlightAuto(code).value;
        },
    }) as any
);

// Retro table renderer (simplified): horizontal scroll, sticky header, single wrapped description column
const retroRenderer = new marked.Renderer();
retroRenderer.table = function (token: any) {
    const headers = token.header || [];

    const buildRow = (cells: any[], tag: 'th' | 'td') =>
        cells
            .map((cell: any, i: number) => {
                const content = cell.text || '';
                // Use only divs and flex to compose table cells.
                // min-w ensures horizontal scrolling when needed; flex-1 lets columns grow.
                const base = 'min-w-[160px] flex-1 px-3 py-2';
                if (tag === 'th') {
                    return `<div role="columnheader" class="${base} font-medium text-left">${content}</div>`;
                } else {
                    return `<div role="cell" class="${base} text-left">${content}</div>`;
                }
            })
            .join('');

    // Header: sticky so it remains visible during vertical scroll.
    const thead = headers.length
        ? `<div class="flex sticky top-0 z-10 bg-[var(--md-surface-container-lowest)] border-b border-[var(--md-inverse-surface)]">
            ${buildRow(headers, 'th')}
          </div>`
        : '';

    // Body rows: each row is a flex container matching header columns.
    const bodyRows = (token.rows || [])
        .map(
            (row: any[], rIdx: number) =>
                `<div class="flex ${
                    rIdx % 2 === 1
                        ? 'bg-[var(--md-surface-container-lowest)]/60'
                        : ''
                }">
                    ${buildRow(row, 'td')}
                 </div>`
        )
        .join('');

    // Outer wrapper provides horizontal scrolling (flex-only layout, no table elements).
    return `<div class="relative w-full overflow-x-auto min-w-0 not-prose! rounded-[3px] border-2 border-[var(--md-inverse-surface)] retro-shadow bg-[var(--md-surface-container-low)]/30">
                <div class="min-w-full inline-flex flex-col">
                    ${thead}
                    ${bodyRows}
                </div>
            </div>`;
};
marked.use({ renderer: retroRenderer });

export default defineNuxtPlugin((nuxtApp) => {
    const THEME_CLASSES = [
        'light',
        'dark',
        'light-high-contrast',
        'dark-high-contrast',
        'light-medium-contrast',
        'dark-medium-contrast',
    ];

    const storageKey = 'theme';
    const root = document.documentElement;

    const getSystemPref = () =>
        window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';

    // Inject HLJS theme styles (light/dark) and toggle via disabled attr for fast switching
    // We load both once to avoid FOUC on subsequent toggles.
    let hlLightStyle: HTMLStyleElement | null = null;
    let hlDarkStyle: HTMLStyleElement | null = null;
    const ensureHighlightStyles = async () => {
        if (!hlLightStyle) {
            const lightCss = await import('highlight.js/styles/github.css?raw');
            hlLightStyle = document.createElement('style');
            hlLightStyle.id = 'hljs-theme-light';
            hlLightStyle.textContent = lightCss.default || (lightCss as any);
            document.head.appendChild(hlLightStyle);
        }
        if (!hlDarkStyle) {
            const darkCss = await import(
                'highlight.js/styles/github-dark.css?raw'
            );
            hlDarkStyle = document.createElement('style');
            hlDarkStyle.id = 'hljs-theme-dark';
            hlDarkStyle.textContent = darkCss.default || (darkCss as any);
            document.head.appendChild(hlDarkStyle);
        }
    };

    const setHighlightVariant = (themeName: string) => {
        const dark = themeName.startsWith('dark');
        if (hlLightStyle && hlDarkStyle) {
            hlLightStyle.disabled = dark; // disable light when dark
            hlDarkStyle.disabled = !dark; // disable dark when light
        }
    };

    const apply = (name: string) => {
        for (const cls of THEME_CLASSES) root.classList.remove(cls);
        root.classList.add(name);
        // (async but fire & forget) ensure styles then toggle
        ensureHighlightStyles().then(() => setHighlightVariant(name));
    };

    const read = () => localStorage.getItem(storageKey) as string | null;

    let current = read() || getSystemPref();
    apply(current);

    const set = (name: string) => {
        current = name;
        localStorage.setItem(storageKey, name);
        apply(name);
    };

    const toggle = () => set(current === 'dark' ? 'light' : 'dark');

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
        if (!read()) {
            current = e.matches ? 'dark' : 'light';
            apply(current);
        }
    };
    media.addEventListener('change', onChange);

    nuxtApp.hook('app:beforeMount', () => {
        current = read() || getSystemPref();
        apply(current);
    });

    // Cleanup for HMR in dev so we don't stack listeners
    if (import.meta.hot) {
        import.meta.hot.dispose(() =>
            media.removeEventListener('change', onChange)
        );
    }

    nuxtApp.provide('theme', {
        set,
        toggle,
        get: () => current,
        system: getSystemPref,
    });

    // Provide markdown renderer with syntax highlighting
    nuxtApp.provide('markdown', {
        render: (src: string) => marked.parse(src) as string,
        marked,
    });
});
