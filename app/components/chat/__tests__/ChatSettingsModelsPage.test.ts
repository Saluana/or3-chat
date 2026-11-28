import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import ChatSettingsModelsPage from '../ChatSettingsModelsPage.vue';
import type { OpenRouterModel } from '~/core/auth/models-service';

const store = vi.hoisted(() => ({
    catalog: null as unknown as import('vue').Ref<OpenRouterModel[]>,
    favorites: null as unknown as import('vue').Ref<OpenRouterModel[]>,
    recent: null as unknown as import('vue').Ref<string[]>,
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
}));

vi.mock('~/composables/chat/useModelStore', () => ({
    useModelStore: () => ({
        catalog: store.catalog,
        favoriteModels: store.favorites,
        recentModelIds: store.recent,
        loadRecentModels: vi.fn(async () => {}),
        getFavoriteModels: vi.fn(async () => store.favorites.value),
        fetchModels: vi.fn(async () => store.catalog.value),
        addFavoriteModel: store.addFavorite,
        removeFavoriteModel: store.removeFavorite,
    }),
}));

vi.mock('~/composables/chat/useWorkspaceModels', () => ({
    useWorkspaceModels: () => ({ policy: ref({ hidden: ['hidden/model'], pinned: [] }) }),
}));

// Search ranking belongs to useModelSearch's own suite; with no query the
// page lists the catalog directly.
vi.mock('~/core/search/useModelSearch', () => ({
    useModelSearch: () => ({ query: ref(''), results: ref([]), ready: ref(true) }),
}));

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ref({}),
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: (name: string) => ref(name),
}));

function model(id: string, extra: Partial<OpenRouterModel> = {}): OpenRouterModel {
    return {
        id,
        name: id.split('/')[1]!,
        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
        supported_parameters: [],
        pricing: { prompt: '0.000001', completion: '0.000002' },
        ...extra,
    } as OpenRouterModel;
}

const menuStub = {
    name: 'UDropdownMenu',
    props: ['items'],
    template: '<div class="menu-stub"><slot /></div>',
};

function mountPage(props: Record<string, unknown> = {}) {
    return mount(ChatSettingsModelsPage, {
        props: { selectedModel: 'openai/gpt-4o', detailId: null, ...props },
        global: {
            directives: { theme: {} },
            stubs: {
                UInput: { template: '<input v-bind="$attrs" />' },
                UButton: {
                    props: ['icon'],
                    template: '<button v-bind="$attrs" :data-icon="icon"><slot /></button>',
                },
                UIcon: { template: '<span class="uicon-stub" />' },
                UDropdownMenu: menuStub,
                ModelCatalogProviderLogo: { template: '<span />' },
                ModelCatalogDetail: {
                    name: 'ModelCatalogDetail',
                    props: ['model', 'favorite'],
                    emits: ['use', 'toggleFavorite'],
                    template: '<div class="detail-stub">{{ model.id }}</div>',
                },
            },
        },
    });
}

function headings(wrapper: ReturnType<typeof mountPage>) {
    return wrapper.findAll('.settings-page-heading').map((heading) => heading.text());
}

function rowIds(wrapper: ReturnType<typeof mountPage>) {
    return wrapper.findAll('.settings-page-row').map((row) => row.attributes('data-model-id'));
}

function menuItem(wrapper: ReturnType<typeof mountPage>, label: string) {
    const groups = wrapper.findComponent(menuStub).props('items') as Array<
        Array<{ label: string; onUpdateChecked?: (checked: boolean) => void; onSelect?: () => void }>
    >;
    return groups.flat().find((item) => item.label === label)!;
}

describe('ChatSettingsModelsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        store.catalog = ref([
            model('openai/gpt-4o', {
                architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
                supported_parameters: ['tools'],
            } as Partial<OpenRouterModel>),
            model('anthropic/claude-sonnet'),
            model('google/gemini-pro', {
                architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            } as Partial<OpenRouterModel>),
            model('mistral/mistral-medium'),
            model('hidden/model'),
            model('openai/text-embedding-3', {
                architecture: { input_modalities: ['text'], output_modalities: ['embeddings'] },
            } as Partial<OpenRouterModel>),
        ]);
        store.favorites = ref([store.catalog.value[1]!]);
        store.recent = ref(['google/gemini-pro', 'anthropic/claude-sonnet']);
    });

    it('groups favorites, recent, and remaining chat models without counts', async () => {
        const wrapper = mountPage();
        await flushPromises();
        expect(headings(wrapper)).toEqual(['Favorites', 'Recent', 'All models']);
        // Favorites are not repeated under Recent; hidden and embedding models are omitted.
        expect(rowIds(wrapper)).toEqual([
            'anthropic/claude-sonnet',
            'google/gemini-pro',
            'openai/gpt-4o',
            'mistral/mistral-medium',
        ]);
        const current = wrapper.find('[data-model-id="openai/gpt-4o"] .settings-page-row-main');
        expect(current.attributes('aria-current')).toBe('true');
        expect(current.text()).toContain('Vision · Tools');
    });

    it('highlights a tapped row and uses it on a second tap', async () => {
        const wrapper = mountPage();
        await flushPromises();
        const current = wrapper.find('[data-model-id="openai/gpt-4o"] .settings-page-row-main');
        // The model in use starts highlighted, and tapping it does nothing more.
        expect(current.attributes('aria-pressed')).toBe('true');
        await current.trigger('click');
        expect(wrapper.emitted('select')).toBeUndefined();

        const gemini = wrapper.find('[data-model-id="google/gemini-pro"] .settings-page-row-main');
        await gemini.trigger('click');
        expect(gemini.attributes('aria-pressed')).toBe('true');
        expect(current.attributes('aria-pressed')).toBe('false');
        expect(wrapper.emitted('select')).toBeUndefined();
        await gemini.trigger('click');
        expect(wrapper.emitted('select')).toEqual([['google/gemini-pro']]);
    });

    it('offers only All and Favorites scopes and lists favorites flat', async () => {
        const wrapper = mountPage();
        const scopes = wrapper.findAll('.settings-page-chip');
        expect(scopes.map((chip) => chip.text())).toEqual(['All', 'Favorites']);
        await scopes[1]!.trigger('click');
        expect(scopes[1]!.attributes('aria-pressed')).toBe('true');
        expect(headings(wrapper)).toEqual([]);
        expect(rowIds(wrapper)).toEqual(['anthropic/claude-sonnet']);
    });

    it('filters and sorts from the filter menu and clears the filter from its chip', async () => {
        const wrapper = mountPage();
        menuItem(wrapper, 'Vision').onUpdateChecked!(true);
        menuItem(wrapper, 'Name').onUpdateChecked!(true);
        await flushPromises();
        expect(rowIds(wrapper)).toEqual(['google/gemini-pro', 'openai/gpt-4o']);
        expect(wrapper.find('[aria-label="Filter and sort models (active)"]').exists()).toBe(true);

        await wrapper.find('[aria-label="Remove Vision filter"]').trigger('click');
        expect(rowIds(wrapper)).toHaveLength(4);
        menuItem(wrapper, 'Reset').onSelect!();
        await flushPromises();
        expect(wrapper.find('[aria-label="Filter and sort models"]').exists()).toBe(true);
        expect(headings(wrapper)).toEqual(['Favorites', 'Recent', 'All models']);
    });

    it('acts on the highlighted model from the action bar', async () => {
        const wrapper = mountPage();
        await flushPromises();
        const inUse = wrapper.find('.settings-page-use');
        expect(inUse.text()).toBe('In use');
        expect(inUse.attributes('disabled')).toBeDefined();

        await wrapper.find('[data-model-id="google/gemini-pro"] .settings-page-row-main').trigger('click');
        // "In use" is a status; another highlighted model gets the real action.
        const use = wrapper.find('.settings-page-use');
        expect(use.text()).toBe('Use model');
        await wrapper.find('[aria-label="Add to favorites"]').trigger('click');
        expect(store.addFavorite).toHaveBeenCalledWith(store.catalog.value[2]);
        await wrapper.find('[aria-label="Model details"]').trigger('click');
        expect(wrapper.emitted('open-detail')).toEqual([['google/gemini-pro']]);
        await use.trigger('click');
        expect(wrapper.emitted('select')).toEqual([['google/gemini-pro']]);
    });

    it('shows details in place and uses or favorites the model from there', async () => {
        const wrapper = mountPage({ detailId: 'google/gemini-pro' });
        const detail = wrapper.findComponent({ name: 'ModelCatalogDetail' });
        expect(detail.props('favorite')).toBe(false);
        detail.vm.$emit('toggleFavorite');
        expect(store.addFavorite).toHaveBeenCalledWith(store.catalog.value[2]);
        detail.vm.$emit('use');
        expect(wrapper.emitted('select')).toEqual([['google/gemini-pro']]);
    });

    it('renders a bounded window and extends it on request', async () => {
        store.catalog.value = Array.from({ length: 95 }, (_, index) => model(`maker/model-${index}`));
        store.favorites.value = [];
        store.recent.value = [];
        const wrapper = mountPage();
        await flushPromises();
        expect(rowIds(wrapper)).toHaveLength(40);
        await wrapper.findAll('button').find((button) => button.text() === 'Show more models')!.trigger('click');
        expect(rowIds(wrapper)).toHaveLength(80);
    });
});
