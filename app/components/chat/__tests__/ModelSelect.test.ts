import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, shallowMount } from '@vue/test-utils';
import { ref } from 'vue';
import ModelSelect from '../ModelSelect.vue';
import ModelVariantSelect from '../ModelVariantSelect.vue';
import type { OpenRouterModel } from '~/core/auth/models-service';

const favorites = ref<OpenRouterModel[]>([]);

vi.mock('~/composables/chat/useModelStore', () => ({
    useModelStore: () => ({
        catalog: ref([]),
        favoriteModels: favorites,
        fetchModels: vi.fn().mockResolvedValue([]),
        getFavoriteModels: vi.fn().mockResolvedValue([]),
    }),
}));

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ref({}),
}));

vi.mock('~/composables/useIcon', () => ({
    // Echo the token so assertions can verify per-variant wiring.
    useIcon: (name: string) => ref(name),
}));

function model(id: string): OpenRouterModel {
    return { id, name: id } as OpenRouterModel;
}

const iconStub = {
    props: ['name'],
    template: '<span class="uicon-stub" :data-name="name" />',
};

// Projects the leading/item-leading slots so the logo wiring is observable
// without mounting the full floating menu.
const menuStub = {
    props: ['modelValue', 'items'],
    template: `
        <div class="menu-stub">
            <slot name="leading" />
            <div v-for="(item, index) in (items ?? [])" :key="index" class="menu-item">
                <slot name="item-leading" :item="item" :index="index" />
                <span class="menu-label">{{ item.label }}</span>
            </div>
        </div>
    `,
};

describe('ModelSelect provider logos', () => {
    beforeEach(() => {
        favorites.value = [
            model('deepseek/deepseek-chat'),
            model('~z-ai/glm-4'),
            model('acme-corp/mystery-1'),
        ];
    });

    function mountPicker(selected: string) {
        return mount(ModelSelect, {
            props: { model: selected },
            global: {
                stubs: {
                    USelectMenu: menuStub,
                    UIcon: iconStub,
                },
            },
        });
    }

    it('shows the provider brand glyph next to the selected model', () => {
        const wrapper = mountPicker('deepseek/deepseek-chat');
        const leading = wrapper.find('.menu-stub .uicon-stub');
        expect(leading.attributes('data-name')).toBe('simple-icons:deepseek');
    });

    it('derives a logo per favorite, tolerating upstream ~ prefixes', () => {
        const wrapper = mountPicker('deepseek/deepseek-chat');
        const rows = wrapper.findAll('.menu-item');
        expect(rows).toHaveLength(3);
        // deepseek -> brand glyph
        expect(
            rows[0]!.find('.uicon-stub').attributes('data-name')
        ).toBe('simple-icons:deepseek');
        // ~z-ai -> stripped to the z-ai monogram tile
        expect(rows[1]!.find('.uicon-stub').exists()).toBe(false);
        expect(rows[1]!.text()).toContain('Z');
        // unknown provider -> monogram fallback, never blank
        expect(rows[2]!.find('.uicon-stub').exists()).toBe(false);
        expect(rows[2]!.text()).toContain('A');
    });
});

describe('ModelVariantSelect', () => {
    it('passes four labeled options with descriptions and icons', () => {
        const wrapper = shallowMount(ModelVariantSelect, {
            props: { modelValue: 'nitro' },
            global: { stubs: { USelectMenu: menuStub, UIcon: iconStub } },
        });
        const menu = wrapper.findComponent(menuStub);
        const items = menu.props('items') as Array<{
            value: string;
            label: string;
            description: string;
            icon: string;
        }>;
        expect(items.map((item) => item.value)).toEqual([
            'off',
            'online',
            'nitro',
            'floor',
        ]);
        for (const item of items) {
            expect(item.label.length).toBeGreaterThan(0);
            expect(item.description.length).toBeGreaterThan(0);
            expect(item.icon.length).toBeGreaterThan(0);
        }
        expect(
            items.find((item) => item.value === 'nitro')?.icon
        ).toBe('chat.variant.nitro');
    });

    it('falls back to the off icon when no value is bound', () => {
        const wrapper = mount(ModelVariantSelect, {
            global: { stubs: { USelectMenu: menuStub, UIcon: iconStub } },
        });
        expect(
            wrapper.find('.menu-stub .uicon-stub').attributes('data-name')
        ).toBe('chat.variant.off');
    });
});
