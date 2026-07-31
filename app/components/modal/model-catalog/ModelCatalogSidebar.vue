<script setup lang="ts">
import { computed, ref } from 'vue';
import { useIcon } from '~/composables/useIcon';
import type {
    CapabilityFilter,
    CatalogCategoryEntry,
    ProviderCount,
} from '~/utils/modelCatalog';
import ModelCatalogProviderLogo from './ModelCatalogProviderLogo.vue';

const props = withDefaults(
    defineProps<{
        scope: 'all' | 'favorites';
        totalCount: number;
        favoritesCount: number;
        providers: ProviderCount[];
        selectedProvider: string | null;
        categories: CatalogCategoryEntry[];
        selectedCapability: CapabilityFilter;
    }>(),
    {}
);

const emit = defineEmits<{
    (e: 'update:scope', value: 'all' | 'favorites'): void;
    (e: 'selectProvider', slug: string | null): void;
    (e: 'selectCapability', key: CapabilityFilter): void;
}>();

const PROVIDERS_COLLAPSED = 8;
const expanded = ref(false);

const visibleProviders = computed(() =>
    expanded.value
        ? props.providers
        : props.providers.slice(0, PROVIDERS_COLLAPSED)
);

const hasMoreProviders = computed(
    () => props.providers.length > PROVIDERS_COLLAPSED
);

const allIcon = useIcon('catalog.all');
const starIcon = useIcon('catalog.star');
const chevronDown = useIcon('ui.chevron.down');
const chevronUp = useIcon('ui.chevron.up');

const itemBase =
    'w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-[calc(var(--md-border-radius)*0.75)] text-sm transition-colors duration-100 cursor-pointer';
const itemIdle =
    'text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)]';
const itemActive =
    'bg-[color-mix(in_srgb,var(--md-primary)_10%,transparent)] text-[var(--md-primary)] font-medium';

function navItemClass(active: boolean) {
    return [itemBase, active ? itemActive : itemIdle];
}

const countClass =
    'ml-auto text-xs tabular-nums text-[var(--md-on-surface-variant)]';

function toggleProvider(slug: string) {
    emit('selectProvider', props.selectedProvider === slug ? null : slug);
}
</script>

<template>
    <nav class="flex flex-col gap-0.5 text-left" aria-label="Catalog filters">
        <button
            type="button"
            :class="navItemClass(scope === 'all' && !selectedProvider)"
            @click="
                emit('update:scope', 'all');
                emit('selectProvider', null);
            "
        >
            <UIcon :name="allIcon" class="h-4 w-4 shrink-0" />
            <span class="truncate">All models</span>
            <span :class="countClass">{{ totalCount }}</span>
        </button>
        <button
            type="button"
            :class="navItemClass(scope === 'favorites')"
            @click="emit('update:scope', 'favorites')"
        >
            <UIcon :name="starIcon" class="h-4 w-4 shrink-0" />
            <span class="truncate">Favorites</span>
            <span :class="countClass">{{ favoritesCount }}</span>
        </button>

        <div
            class="mt-4 mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--md-on-surface-variant)]"
        >
            Providers
        </div>
        <div class="flex flex-col gap-0.5">
            <button
                v-for="p in visibleProviders"
                :key="p.slug"
                type="button"
                :class="navItemClass(selectedProvider === p.slug)"
                @click="toggleProvider(p.slug)"
            >
                <ModelCatalogProviderLogo :slug="p.slug" :size="17" />
                <span class="truncate">{{ p.info.name }}</span>
                <span :class="countClass">{{ p.count }}</span>
            </button>
            <button
                v-if="hasMoreProviders"
                type="button"
                :class="[
                    itemBase,
                    itemIdle,
                    'text-[var(--md-on-surface-variant)]',
                ]"
                @click="expanded = !expanded"
            >
                <UIcon
                    :name="expanded ? chevronUp : chevronDown"
                    class="h-4 w-4 shrink-0"
                />
                <span class="truncate text-[13px]">{{
                    expanded
                        ? 'Show fewer'
                        : `View all providers (${providers.length})`
                }}</span>
            </button>
        </div>

        <div
            class="mt-4 mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--md-on-surface-variant)]"
        >
            Categories
        </div>
        <div class="flex flex-col gap-0.5">
            <button
                v-for="cat in categories"
                :key="cat.key"
                type="button"
                :class="navItemClass(selectedCapability === cat.key)"
                @click="
                    emit(
                        'selectCapability',
                        selectedCapability === cat.key ? 'all' : cat.key
                    )
                "
            >
                <UIcon :name="cat.icon" class="h-4 w-4 shrink-0" />
                <span class="truncate">{{ cat.label }}</span>
                <span :class="countClass">{{ cat.count }}</span>
            </button>
        </div>
    </nav>
</template>
