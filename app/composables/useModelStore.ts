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

    const KV_KEY = 'favorite_models';

    async function persist() {
        try {
            await kv.set(KV_KEY, JSON.stringify(favoriteModels.value));
        } catch (e) {
            console.warn('[useModelStore] persist favorites failed', e);
        }
    }

    async function addFavoriteModel(model: OpenRouterModel) {
        if (favoriteModels.value.some((m) => m.id === model.id)) return; // dedupe
        favoriteModels.value.push(model);
        await persist();
    }

    async function removeFavoriteModel(model: OpenRouterModel) {
        favoriteModels.value = favoriteModels.value.filter(
            (m) => m.id !== model.id
        );
        await persist();
    }

    async function clearFavoriteModels() {
        favoriteModels.value = [];
        await persist();
    }

    async function getFavoriteModels() {
        try {
            const record: any = await kv.get(KV_KEY);
            const raw = record?.value;
            if (raw && typeof raw === 'string') {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    favoriteModels.value = parsed;
                } else {
                    favoriteModels.value = [];
                }
            } else {
                favoriteModels.value = [];
            }
        } catch {
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
