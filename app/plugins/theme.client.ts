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
                if (tag === 'th') {
                    return `<${tag} class="h-10 px-2 text-left align-middle font-medium [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] sticky top-0 z-[5] bg-secondary/20 py-2 text-sm text-foreground first:pl-4">${
                        cell.text || ''
                    }</${tag}>`;
                } else {
                    return `<${tag} class="p-2 [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] min-w-8 max-w-[40ch] overflow-hidden text-ellipsis align-top text-sm first:pl-4 last:max-w-[65ch]">${
                        cell.text || ''
                    }</${tag}>`;
                }
            })
            .join('');

    const thead = headers.length
        ? `<thead class="bg-[var(--md-surface-container-lowest)]">
  <tr>${buildRow(headers, 'th')}</tr>
</thead>`
        : '';
    const bodyRows = (token.rows || [])
        .map(
            (row: any[], rIdx: number) =>
                `<tr class="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted [thead_&]:hover:bg-transparent ${
                    rIdx % 2 === 1
                        ? 'bg-[var(--md-surface-container-lowest)]/60'
                        : ''
                }">${buildRow(row, 'td')}</tr>`
        )
        .join('');
    const tbody = `<tbody>${bodyRows}</tbody>`;
    return `<div class="relative  w-full overflow-hidden rounded-[3px] border-2 border-[var(--md-inverse-surface)] retro-shadow bg-[var(--md-surface-container-low)]/30">
  <div class="overflow-auto z-[1] scrollbar-transparent max-h-[60vh] relative pb-0">
    <table class="w-full caption-bottom text-sm my-0!">${thead}${tbody}</table>
  </div>
  <div role="caption" class="text-sm text-muted-foreground relative z-[5] mt-0 flex w-full flex-row justify-between rounded-[3px] bg-secondary/20 p-1 text-right"><button class="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-4 [&amp;_svg]:shrink-0 hover:bg-muted/40 hover:text-foreground disabled:hover:bg-transparent disabled:hover:text-foreground/50 h-8 rounded-md px-3 text-xs" type="button" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-expand size-4"><path d="m21 21-6-6m6 6v-4.8m0 4.8h-4.8"></path><path d="M3 16.2V21m0 0h4.8M3 21l6-6"></path><path d="M21 7.8V3m0 0h-4.8M21 3l-6 6"></path><path d="M3 7.8V3m0 0h4.8M3 3l6 6"></path></svg><span class="sr-only">Expand all cells</span></button><div class="flex items-center gap-2"><button class="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-4 [&amp;_svg]:shrink-0 hover:bg-muted/40 hover:text-foreground disabled:hover:bg-transparent disabled:hover:text-foreground/50 h-8 rounded-md text-xs p-2 transition-opacity duration-200" type="button" data-state="closed" id="radix-_r_1o_" aria-haspopup="menu" aria-expanded="false" style="user-select: none;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download h-3 w-3"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg></button><button class="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-4 [&amp;_svg]:shrink-0 hover:bg-muted/40 hover:text-foreground disabled:hover:bg-transparent disabled:hover:text-foreground/50 h-8 rounded-md text-xs p-2 transition-opacity duration-200" type="button" data-state="closed" style="user-select: none;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy h-3 w-3"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button></div></div>
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
