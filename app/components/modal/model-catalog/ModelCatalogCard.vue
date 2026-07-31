<script setup lang="ts">
import { computed } from 'vue';
import type { OpenRouterModel } from '~/core/auth/models-service';
import { useIcon } from '~/composables/useIcon';
import {
    formatPerMillion,
    formatTokenCount,
    getContextLength,
    getModelBadges,
    getModelProvider,
} from '~/utils/modelCatalog';
import ModelCatalogProviderLogo from './ModelCatalogProviderLogo.vue';

const props = defineProps<{
    model: OpenRouterModel;
    selected: boolean;
    favorite: boolean;
}>();

const emit = defineEmits<{
    (e: 'select'): void;
    (e: 'toggleFavorite'): void;
}>();

const provider = computed(() => getModelProvider(props.model));
const badges = computed(() => getModelBadges(props.model, 2));
const contextLength = computed(() => getContextLength(props.model));

const starIcon = useIcon('catalog.star');
const starFilledIcon = useIcon('catalog.star.filled');
</script>

<template>
    <div
        class="model-catalog-card group relative flex items-center gap-3 px-3 py-2.5 sm:px-4 sm:py-3 rounded-[var(--md-border-radius)] border cursor-pointer transition-colors duration-100"
        :class="
            selected
                ? 'border-[var(--md-primary)] bg-[color-mix(in_srgb,var(--md-primary)_7%,transparent)]'
                : 'border-[var(--md-border-color)] bg-[var(--md-surface)] hover:bg-[var(--md-surface-hover)]'
        "
        :data-model-id="model.id"
        :aria-selected="selected"
        role="option"
        tabindex="0"
        @click="emit('select')"
        @keydown.enter="emit('select')"
    >
        <ModelCatalogProviderLogo :slug="provider.slug" :size="36" tile />

        <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
                <span
                    class="font-medium text-sm truncate text-[var(--md-on-surface)]"
                    :title="model.name"
                    >{{ model.name }}</span
                >
                <UBadge
                    v-for="badge in badges"
                    :key="badge.label"
                    :color="badge.tone"
                    variant="subtle"
                    size="xs"
                    class="shrink-0 hidden min-[420px]:inline-flex"
                    >{{ badge.label }}</UBadge
                >
            </div>
            <div
                class="text-xs text-[var(--md-on-surface-variant)] truncate mt-0.5"
            >
                {{ provider.name }}
                <span class="opacity-60">·</span>
                {{ formatTokenCount(contextLength) }} context
            </div>
        </div>

        <div
            class="text-right text-xs leading-tight tabular-nums shrink-0 text-[var(--md-on-surface)]"
        >
            <div>
                {{ formatPerMillion(model.pricing?.prompt) }}
                <span class="text-[var(--md-on-surface-variant)] opacity-80"
                    >/ 1M in</span
                >
            </div>
            <div class="mt-0.5">
                {{ formatPerMillion(model.pricing?.completion) }}
                <span class="text-[var(--md-on-surface-variant)] opacity-80"
                    >/ 1M out</span
                >
            </div>
        </div>

        <button
            type="button"
            class="shrink-0 p-1 rounded transition"
            :class="
                favorite
                    ? 'text-amber-400 hover:text-amber-500'
                    : 'text-[var(--md-on-surface-variant)] opacity-40 hover:opacity-100 group-hover:opacity-70'
            "
            :aria-pressed="favorite"
            :title="favorite ? 'Remove from favorites' : 'Add to favorites'"
            @click.stop="emit('toggleFavorite')"
        >
            <UIcon
                :name="favorite ? starFilledIcon : starIcon"
                class="h-[18px] w-[18px]"
            />
        </button>
    </div>
</template>
