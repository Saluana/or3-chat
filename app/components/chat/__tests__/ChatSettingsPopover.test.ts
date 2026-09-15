import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import ChatSettingsPopover from '../ChatSettingsPopover.vue';
import { useModelStore } from '~/composables/chat/useModelStore';
import type { OpenRouterModel } from '~/core/auth/models-service';

vi.mock('~/composables/useIcon', () => ({
    useIcon: (name: string) => ref(name),
}));

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ref({}),
}));

vi.mock('~/utils/chat/tools-public', () => ({
    useToolRegistry: () => ({
        listTools: ref([]),
        setEnabled: vi.fn(),
    }),
}));

const menuStub = {
    props: ['modelValue', 'items', 'disabled'],
    template: `
        <div class="menu-stub" v-bind="$attrs">
            <slot name="default" :open="false" />
            <div v-for="(item, index) in (items ?? [])" :key="index" class="menu-item">
                <slot name="item-leading" :item="item" :index="index" />
                <span class="menu-label">{{ item.label }}</span>
            </div>
            <slot name="empty" />
        </div>
    `,
};

function popoverItems(wrapper: ReturnType<typeof mountPopover>) {
    return wrapper.findAllComponents(menuStub).map((menu) => ({
        label: menu.props('modelValue') as string,
        items: (menu.props('items') ?? []) as Array<{
            value: string;
            label: string;
            description?: string;
        }>,
    }));
}

function mountPopover(props: Record<string, unknown> = {}) {
    return mount(ChatSettingsPopover, {
        props: {
            thinkingSupported: true,
            reasoningEfforts: ['low', 'medium', 'high'],
            model: 'deepseek/deepseek-chat',
            modelVariant: 'off',
            thinkingEnabled: false,
            reasoningEffort: undefined,
            ...props,
        },
        global: {
            stubs: {
                UButton: {
                    template:
                        '<button v-bind="$attrs" @click="$emit(\'click\')"><slot/></button>',
                },
                UIcon: { template: '<span class="uicon-stub" />' },
                USwitch: true,
                USelectMenu: menuStub,
            },
        },
    });
}

describe('ChatSettingsPopover options layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders Options/More headings with dropdown rows', () => {
        const wrapper = mountPopover();
        const text = wrapper.text();
        expect(text).toContain('Options');
        expect(text).toContain('More');
        expect(text).toContain('Model variant');
        expect(text).toContain('Thinking');
        // Rows show their current value and act as dropdown triggers.
        expect(wrapper.find('[aria-label="Model variant"]').exists()).toBe(
            true
        );
        expect(wrapper.find('[aria-label="Thinking level"]').exists()).toBe(
            true
        );
        const labels = popoverItems(wrapper).map((menu) => menu.label);
        expect(labels).toContain('off');
    });

    it('lists thinking levels ascending with descriptions', () => {
        const wrapper = mountPopover();
        const thinking = wrapper
            .findAllComponents(menuStub)
            .find((menu) => menu.props('items')?.[0]?.value === 'disabled');
        const items = thinking!.props('items') as Array<{
            label: string;
            description: string;
        }>;
        expect(items.map((item) => item.label)).toEqual([
            'Disabled',
            'Low',
            'Medium',
            'High',
        ]);
        for (const item of items) {
            expect(item.description.length).toBeGreaterThan(0);
        }
    });

    it('reflects the active thinking level', () => {
        const wrapper = mountPopover({
            thinkingEnabled: true,
            reasoningEffort: 'high',
        });
        expect(wrapper.find('[aria-label="Thinking level"]').text()).toContain(
            'High'
        );
    });

    it('hides the thinking row when the model does not support it', () => {
        const wrapper = mountPopover({ thinkingSupported: false });
        expect(wrapper.text()).not.toContain('Thinking');
        expect(wrapper.find('[aria-label="Thinking level"]').exists()).toBe(
            false
        );
    });

    it('offers favorites as the current-model dropdown', () => {
        const { favoriteModels } = useModelStore();
        favoriteModels.value = [
            {
                id: 'deepseek/deepseek-chat',
                name: 'deepseek/deepseek-chat',
            } as OpenRouterModel,
        ];
        try {
            const narrow = mountPopover({ containerWidth: 360 });
            const trigger = narrow.find('[aria-label="Current model"]');
            expect(trigger.exists()).toBe(true);
            expect(trigger.text()).toContain('deepseek/deepseek-chat');
            expect(trigger.text()).toContain('Current model for this chat');

            const modelMenu = narrow
                .findAllComponents(menuStub)
                .find((menu) =>
                    (menu.props('items') ?? []).some(
                        (item: { slug?: string }) => item.slug
                    )
                );
            expect(modelMenu).toBeTruthy();
            const items = modelMenu!.props('items') as Array<{
                value: string;
                slug: string;
            }>;
            expect(items).toHaveLength(1);
            // `~`-prefixed canonical slugs still resolve a provider logo.
            expect(items[0]!.slug).toBe('deepseek');
        } finally {
            favoriteModels.value = [];
        }
    });

    it('hides the current-model row on wide composers', () => {
        const wrapper = mountPopover({ containerWidth: 600 });
        expect(
            wrapper.find('[aria-label="Current model"]').exists()
        ).toBe(false);
    });
});
