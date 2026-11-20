import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import AdminNavLinks from '../AdminNavLinks.vue';

describe('admin navigation headings', () => {
    it('labels the desktop and mobile groups with their own headings', () => {
        const props = {
            activePath: '/admin',
            links: [{ label: 'Home', to: '/admin', icon: '', section: 'Overview' }],
        };
        const wrapper = mount(defineComponent({
            render: () => [
                h(AdminNavLinks, props),
                h(AdminNavLinks, { ...props, density: 'mobile' }),
            ],
        }), { global: { stubs: ['NuxtLink', 'UIcon'] } });

        try {
            const groups = wrapper.findAll('section');
            const ids = groups.map(group => group.get('h2').attributes('id'));
            expect(new Set(ids).size).toBe(2);
            expect(groups.map(group => group.attributes('aria-labelledby'))).toEqual(ids);
        } finally {
            wrapper.unmount();
        }
    });
});
