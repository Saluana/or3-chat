import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import ReasoningAccordion from '../ReasoningAccordion.vue';

vi.mock('~/composables/useThemeResolver', () => ({ useThemeOverrides: () => ref({}) }));
vi.mock('~/composables/useIcon', () => ({ useIcon: () => ref('test-icon') }));

describe('reasoning disclosure', () => {
    it('keeps collapsed reasoning out of keyboard and assistive navigation until expanded', async () => {
        const wrapper = mount(ReasoningAccordion, { props: { content: 'Reasoning detail' } });
        const toggle = wrapper.get('button');
        const content = wrapper.get(`#${toggle.attributes('aria-controls')}`);
        expect(toggle.attributes('aria-expanded')).toBe('false');
        expect(content.attributes('aria-hidden')).toBe('true');
        expect(content.attributes('tabindex')).toBe('-1');
        await toggle.trigger('click');
        expect(toggle.attributes('aria-expanded')).toBe('true');
        expect(content.attributes('aria-hidden')).toBe('false');
        expect(content.attributes('tabindex')).toBe('0');
        await toggle.trigger('click');
        expect(content.attributes('aria-hidden')).toBe('true');
        expect(content.attributes('tabindex')).toBe('-1');
        wrapper.unmount();
    });
});
