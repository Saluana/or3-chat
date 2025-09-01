import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';

// Register only needed languages to keep bundle smaller
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('python', python);

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
