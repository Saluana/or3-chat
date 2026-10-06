import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { IconRegistry } from '~/theme/_shared/icon-registry';
import { useIcon } from '~/composables/useIcon';
import ColorPaletteSection from '~/components/dashboard/theme/ColorPaletteSection.vue';
import ModelCatalog from '~/components/modal/ModelCatalog.vue';

const activeTheme = ref('first');
const registry = new IconRegistry();
vi.mock('#app', () => ({ useNuxtApp: () => ({ $iconRegistry: registry }) }));
vi.mock('~/composables/useThemeResolver', () => ({
    useThemeResolver: () => ({ activeTheme }),
    useThemeOverrides: () => computed(() => ({})),
}));
vi.mock('~/core/theme/useUserThemeOverrides', () => ({
    useUserThemeOverrides: () => ({ overrides: ref({ colors: { enabled: false } }), set: vi.fn() }),
}));
vi.mock('~/core/search/useModelSearch', () => ({
    useModelSearch: () => ({ query: ref(''), results: ref([]), ready: ref(true) }),
}));
vi.mock('~/composables/chat/useModelStore', () => ({
    useModelStore: () => ({ favoriteModels: ref([]), catalog: ref([]), fetchModels: async () => {}, getFavoriteModels: async () => [], refreshModels: async () => {}, addFavoriteModel: vi.fn(), removeFavoriteModel: vi.fn() }),
}));

const iconStub = defineComponent({ props: { name: String }, setup: (props) => () => h('i', { 'data-icon': props.name }) });
const stubs = {
    UIcon: iconStub,
    AppModal: defineComponent({ setup: (_, { slots }) => () => h('main', slots.default?.()) }),
    UButton: defineComponent({ props: { icon: String }, setup: (props, { slots }) => () => h('button', [props.icon ? h('i', { 'data-icon': props.icon }) : null, slots.default?.()]) }),
    UInput: defineComponent({ props: { modelValue: String, icon: String }, emits: ['update:modelValue'], setup: (props, { emit }) => () => h('label', [h('i', { 'data-icon': props.icon }), h('input', { value: props.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) })]) }),
    USelect: true, USelectMenu: true, UPopover: true, UTooltip: true, UColorPicker: true,
    ModelCatalogSidebar: true, ModelCatalogCard: true, ModelCatalogDetail: true, Or3Scroll: true,
};

beforeEach(() => {
    for (const theme of ['first', 'second']) registry.registerTheme(theme, {
        'ui.chevron.right': `${theme}:chevron-right`, 'ui.check': `${theme}:check`,
        'ui.refresh': `${theme}:refresh`, 'catalog.vision': `${theme}:vision`,
    });
    activeTheme.value = 'first';
    registry.setActiveTheme('first');
    vi.stubGlobal('useIcon', useIcon);
});
afterEach(() => vi.unstubAllGlobals());

describe('mounted theme icon consumers', () => {
    it.each([
        ['palette', ColorPaletteSection, {}, 'chevron-right'],
        ['catalog', ModelCatalog, { showModal: true }, 'refresh'],
    ] as const)('updates %s icons across a theme change without remounting', async (_name, component, props, icon) => {
        const wrapper = mount(component, { props, global: { stubs, directives: { theme: {} } } });
        try {
            await flushPromises();
            const instance = wrapper.vm.$.uid;
            expect(wrapper.find(`[data-icon="first:${icon}"]`).exists()).toBe(true);
            if (_name === 'catalog') {
                expect(wrapper.find('[data-icon="first:vision"]').exists()).toBe(true);
                await wrapper.find('input').setValue('unchanged query');
            }
            activeTheme.value = 'second';
            registry.setActiveTheme('second');
            await nextTick();
            expect(wrapper.vm.$.uid).toBe(instance);
            expect(wrapper.find(`[data-icon="second:${icon}"]`).exists()).toBe(true);
            expect(wrapper.find(`[data-icon="first:${icon}"]`).exists()).toBe(false);
            if (_name === 'catalog') {
                expect(wrapper.find('[data-icon="second:vision"]').exists()).toBe(true);
                expect((wrapper.find('input').element as HTMLInputElement).value).toBe('unchanged query');
            }
        } finally { wrapper.unmount(); }
    });
});
