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
    fetchModels: vi.fn(),
    loadPolicy: vi.fn(),
    hidden: [] as string[],
}));

vi.mock('~/composables/chat/useModelStore', () => ({
    useModelStore: () => ({
        catalog: store.catalog,
        favoriteModels: store.favorites,
        recentModelIds: store.recent,
        loadRecentModels: vi.fn(async () => {}),
        getFavoriteModels: vi.fn(async () => store.favorites.value),
        fetchModels: store.fetchModels,
        addFavoriteModel: store.addFavorite,
        removeFavoriteModel: store.removeFavorite,
    }),
}));

vi.mock('~/composables/chat/useWorkspaceModels', () => ({
    useWorkspaceModels: () => ({
        policy: ref({ hidden: store.hidden, pinned: [] }),
        load: store.loadPolicy,
    }),
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

function mountPage(props: Record<string, unknown> = {}, attachTo?: HTMLElement) {
    return mount(ChatSettingsModelsPage, {
        attachTo,
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
        store.hidden = ['hidden/model'];
        store.fetchModels.mockImplementation(async () => store.catalog.value);
        store.loadPolicy.mockImplementation(async () => {});
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
        // The platform names the credential that will be billed.
        expect(current.find('.settings-page-row-description').text()).toBe('OpenRouter · Vision · Tools');
    });

    it('shows the billing platform for direct OpenAI models', async () => {
        store.catalog.value = [model('@openai/gpt-5', { name: 'GPT-5 (OpenAI key)' } as Partial<OpenRouterModel>)];
        store.favorites.value = [];
        const wrapper = mountPage();
        await flushPromises();
        expect(wrapper.find('.settings-page-row-description').text()).toBe('OpenAI · Text');
    });

    it('keeps saved favorites pickable when the catalog is empty', async () => {
        const saved = store.favorites.value[0]!;
        store.catalog.value = [];
        store.favorites.value = [saved, model('hidden/model')];
        const wrapper = mountPage();
        await flushPromises();
        // Workspace visibility still applies to the fallback list.
        expect(rowIds(wrapper)).toEqual(['anthropic/claude-sonnet']);
        expect(wrapper.text()).not.toContain('Loading models');
    });

    it('stops loading and says so when the catalog is unavailable', async () => {
        store.catalog.value = [];
        store.favorites.value = [];
        store.fetchModels.mockImplementation(async () => { throw new Error('offline'); });
        const wrapper = mountPage();
        expect(wrapper.text()).toContain('Loading models');
        await flushPromises();
        expect(wrapper.text()).not.toContain('Loading models');
        expect(wrapper.text()).toContain('Models are unavailable right now.');
    });

    it('refreshes workspace model policy when the page opens', async () => {
        mountPage();
        await flushPromises();
        expect(store.loadPolicy).toHaveBeenCalledTimes(1);
        expect(store.loadPolicy).toHaveBeenCalledWith();
    });

    it('explains empty filtered views instead of rendering a blank list', async () => {
        store.favorites.value = [];
        const wrapper = mountPage();
        await flushPromises();
        await wrapper.findAll('.settings-page-chip')[1]!.trigger('click');
        expect(rowIds(wrapper)).toEqual([]);
        expect(wrapper.text()).toContain('No favorite models yet');
        // The bar never acts on a model the list no longer shows.
        expect(wrapper.find('.settings-page-use').exists()).toBe(false);

        await wrapper.findAll('.settings-page-chip')[0]!.trigger('click');
        menuItem(wrapper, 'Free').onUpdateChecked!(true);
        await flushPromises();
        expect(wrapper.text()).toContain('No models match.');
    });

    it('returns focus to the details button after leaving model details', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const wrapper = mountPage({}, host);
        await flushPromises();
        await wrapper.find('[data-model-id="google/gemini-pro"] .settings-page-row-main').trigger('click');
        const details = wrapper.find('[data-model-id="google/gemini-pro"] [aria-label="Model details"]');
        await details.trigger('click');
        await wrapper.setProps({ detailId: 'google/gemini-pro' });
        await wrapper.setProps({ detailId: null });
        await flushPromises();
        expect(document.activeElement).toBe(details.element);
        wrapper.unmount();
        host.remove();
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

    it('names the switch in the bar and puts actions on the highlighted row only', async () => {
        const wrapper = mountPage();
        await flushPromises();
        const inUse = wrapper.find('.settings-page-use');
        expect(inUse.text()).toBe('Using gpt-4o');
        expect(inUse.attributes('disabled')).toBeDefined();
        expect(wrapper.findAll('[aria-label="Model details"]')).toHaveLength(1);

        const gemini = wrapper.find('[data-model-id="google/gemini-pro"]');
        await gemini.find('.settings-page-row-main').trigger('click');
        // The status gives way to a button that says what it will do.
        const use = wrapper.find('.settings-page-use');
        expect(use.text()).toBe('Switch to gemini-pro');
        expect(gemini.find('[aria-label="Model details"]').exists()).toBe(true);
        expect(wrapper.findAll('[aria-label="Model details"]')).toHaveLength(1);
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
