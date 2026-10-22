import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { StreamMarkdown } from 'streamdown-vue';

// NOTE: Current observed behavior: StreamMarkdown (and underlying parser) STRIPS unknown
// custom elements written inline in raw HTML within markdown content (they do not appear
// in output). This test documents that baseline so when we intentionally allow
// <or3-image> later we can update expectations and detect regressions.

const SAMPLE_MD = `Here is some text before\n\n<or3-image hash="abc123def4567890abc123def4567890" alt="first"></or3-image>\n\nAnd another one: <or3-image hash="ffffffffffffffffffffffffffffffff" alt="second" data-extra="1"></or3-image>\n\nRegular **bold** markdown still works.`;

describe('StreamMarkdown XML / custom element handling', () => {
    it('renders inline and block math with the shared KaTeX renderer', async () => {
        const wrapper = mount(StreamMarkdown, {
            props: { content: 'Inline $$x^2$$.\n\n$$\n\\frac{1}{2}\n$$', parseIncompleteMarkdown: false },
        });
        try {
            await expect.poll(() => wrapper.findAll('.katex').length).toBe(2);
            expect(wrapper.findAll('math')).toHaveLength(2);
            expect(wrapper.find('.katex-display .katex').exists()).toBe(true);
            expect(wrapper.find('.katex-error').exists()).toBe(false);
            expect(wrapper.find('.katex-base').exists()).toBe(true);
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
