import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { StreamMarkdown, useShikiHighlighter } from '~/utils/stream-markdown';

// NOTE: Current observed behavior: StreamMarkdown (and underlying parser) STRIPS unknown
// custom elements written inline in raw HTML within markdown content (they do not appear
// in output). This test documents that baseline so when we intentionally allow
// <or3-image> later we can update expectations and detect regressions.

const SAMPLE_MD = `Here is some text before\n\n<or3-image hash="abc123def4567890abc123def4567890" alt="first"></or3-image>\n\nAnd another one: <or3-image hash="ffffffffffffffffffffffffffffffff" alt="second" data-extra="1"></or3-image>\n\nRegular **bold** markdown still works.`;

describe('StreamMarkdown XML / custom element handling', () => {
    it('loads syntax grammars on first use while retaining alias highlighting and plain fallback', async () => {
        const highlighter = await useShikiHighlighter();
        // Warming the renderer must not initialize grammars for unseen fences.
        expect(highlighter.getLoadedLanguages()).toHaveLength(0);
        const wrapper = mount(StreamMarkdown, {
            props: {
                content: '```ts\nconst answer = 42;\n```',
                parseIncompleteMarkdown: false,
                shikiTheme: { light: 'github-light', dark: 'github-dark' },
            },
        });
        try {
            await expect.poll(() => wrapper.find('pre.shiki').exists()).toBe(true);
            expect(wrapper.find('pre code').text()).toBe('const answer = 42;');
            expect(highlighter.getLoadedLanguages()).toContain('typescript');
            expect(highlighter.getLoadedLanguages()).not.toContain('python');

            await wrapper.setProps({ content: '```py\nprint("answer")\n```' });
            await expect.poll(() => highlighter.getLoadedLanguages().includes('python')).toBe(true);
            await expect.poll(() => wrapper.find('pre.shiki code').text()).toBe('print("answer")');

            await wrapper.setProps({ content: '```unknown-language\n<script>literal</script>\n```' });
            await expect.poll(() => wrapper.find('pre code').text()).toBe('<script>literal</script>');
            expect(wrapper.find('pre.shiki').exists()).toBe(false);
            expect(wrapper.find('script').exists()).toBe(false);
        } finally {
            wrapper.unmount();
        }
    });

    it('renders math and keeps completed formulas unchanged while later text streams', async () => {
        const content = 'Inline $$x^2$$.\n\n$$\n\\frac{1}{2}\n$$\n\nLater text';
        const wrapper = mount(StreamMarkdown, {
            props: { content, parseIncompleteMarkdown: false },
        });
        try {
            await expect.poll(() => wrapper.findAll('.katex').length).toBe(2);
            expect(wrapper.findAll('math')).toHaveLength(2);
            expect(wrapper.find('.katex-display .katex').exists()).toBe(true);
            expect(wrapper.find('.katex-error').exists()).toBe(false);
            expect(wrapper.find('.katex-base').exists()).toBe(true);
            await wrapper.setProps({ parseIncompleteMarkdown: true });
            const formula = wrapper.find('.katex').element;
            const mutations: MutationRecord[] = [];
            const observer = new MutationObserver(records => mutations.push(...records));
            observer.observe(formula, { subtree: true, attributes: true, childList: true, characterData: true });
            try {
                for (const suffix of [' continues', ' continues with **bold**', ' continues with **bold** output.']) {
                    await wrapper.setProps({ content: content + suffix });
                }
                expect(wrapper.find('.katex').element).toBe(formula);
                expect(mutations, 'streaming later text must not rewrite settled math attributes').toHaveLength(0);
            } finally {
                observer.disconnect();
            }
            expect(wrapper.find('.katex .mord.mathnormal').exists()).toBe(true);
            await wrapper.setProps({ content: content.replace('x^2', 'x^3'), parseIncompleteMarkdown: false });
            expect(wrapper.find('.katex annotation').text()).toBe('x^3');
        } finally {
            wrapper.unmount();
        }
    });

    it('currently strips custom <or3-image> tags (document baseline)', () => {
        const wrapper = mount({
            render() {
                return h(StreamMarkdown as any, {
                    content: SAMPLE_MD,
                    // Provide minimal required props if any new versions require them.
                    // allowed-image-prefixes left default; custom element not affected.
                });
            },
        });

        const html = wrapper.html();
        // The custom tags should NOT appear (stripped); assert absence.
        expect(html).not.toMatch(/<or3-image/);
        // Ensure regular markdown formatting occurred (bold -> <strong ...>bold</strong>) still works
        expect(html).toContain('<strong');
        expect(html).toMatch(/bold[\s]*<\/strong>/);
    });

});
