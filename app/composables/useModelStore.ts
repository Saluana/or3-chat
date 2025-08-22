import { kv } from '~/db';
import modelsService, {
    type OpenRouterModel,
    type PriceBucket,
} from '~/utils/models-service';

export function useModelStore() {
    const favoriteModels = ref<OpenRouterModel[]>([]);
    const catalog = ref<OpenRouterModel[]>([]);

    const searchQuery = ref('');
    const filters = ref<{
        input?: string[];
        output?: string[];
        minContext?: number;
        parameters?: string[];
        price?: PriceBucket;
    }>({});

    async function fetchModels(opts?: { force?: boolean; ttlMs?: number }) {
        const list = await modelsService.fetchModels(opts);

        catalog.value = list;
        return list;
    }

    async function addFavoriteModel(model: OpenRouterModel) {
        favoriteModels.value.push(model);
        kv.set('models', JSON.stringify(favoriteModels.value));
    }

    async function removeFavoriteModel(model: OpenRouterModel) {
        favoriteModels.value = favoriteModels.value.filter(
            (m) => m.id !== model.id
        );
        kv.set('models', JSON.stringify(favoriteModels.value));
    }

    async function clearFavoriteModels() {
        favoriteModels.value = [];
        kv.set('models', JSON.stringify(favoriteModels.value));
    }

    async function getFavoriteModels() {
        const modelsJson = await kv.get('models');
        if (modelsJson && typeof modelsJson === 'string') {
            favoriteModels.value = JSON.parse(modelsJson);
        } else {
            favoriteModels.value = [];
        }

        return favoriteModels.value;
    }

    return {
        favoriteModels,
        catalog,
        fetchModels,
        getFavoriteModels,
        addFavoriteModel,
        removeFavoriteModel,
        clearFavoriteModels,
    };
}
