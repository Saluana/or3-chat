import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AppIcon from '../AppIcon.vue';

function mountIcon(props: { icon?: string; image?: string }) {
    return mount(AppIcon, {
        props,
        global: {
            stubs: {
                UIcon: {
                    props: ['name'],
                    template: '<span class="fallback-icon" :data-name="name" />',
                },
            },
        },
    });
}

describe('AppIcon', () => {
    it('renders a bounded lazy image and falls back after one load error', async () => {
        const wrapper = mountIcon({
            image: '/api/plugins/packages/acme/digest/assets/icon.webp',
            icon: 'i-lucide-puzzle',
        });
        const image = wrapper.get('img');
        expect(image.attributes()).toMatchObject({
            loading: 'lazy',
            decoding: 'async',
            draggable: 'false',
            alt: '',
        });

        await image.trigger('error');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.get('.fallback-icon').attributes('data-name')).toBe(
            'i-lucide-puzzle'
        );
    });

    it('allows a changed image source to try loading once', async () => {
        const wrapper = mountIcon({ image: '/first.png', icon: 'fallback' });
        await wrapper.get('img').trigger('error');
        await wrapper.setProps({ image: '/second.png' });
        expect(wrapper.get('img').attributes('src')).toBe('/second.png');
    });
});
