<script setup lang="ts">
import { modelIdentity, modelPrices } from '~~/shared/ai/model-catalog';
import { computed } from 'vue';
import type { OpenRouterModel } from '~/core/auth/models-service';
import { useIcon } from '~/composables/useIcon';
import {
    formatModelName,
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
    (e: 'use'): void;
    (e: 'toggleFavorite'): void;
}>();

const hasPricing = computed(() => { const prices = modelPrices(props.model); return prices.input !== null && prices.output !== null; });
const identity = computed(() => modelIdentity(props.model));
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
        role="listitem"
        @click="emit('select')"
    >
        <ModelCatalogProviderLogo :slug="provider.slug" :size="36" tile />

        <button type="button" class="min-w-0 flex-1 text-left rounded focus-visible:outline focus-visible:outline-[var(--md-primary)]" :aria-label="`Details for ${formatModelName(model.name)}`" :aria-current="selected ? 'true' : undefined" @click.stop="emit('select')">
            <div class="flex items-start gap-1.5 sm:items-center">
                <span
                    class="font-medium text-sm min-w-0 max-sm:line-clamp-2 sm:truncate break-words text-[var(--md-on-surface)]"
                    :title="model.name"
                    >{{ formatModelName(model.name) }}</span
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
                {{ identity.platformName }}
                <span class="opacity-60">·</span>
                {{ formatTokenCount(contextLength) }} context
            </div>

            <p v-if="!hasPricing" class="sm:hidden text-xs text-[var(--md-on-surface-variant)]">Price unavailable</p>
            <div v-if="hasPricing" class="sm:hidden mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs leading-tight tabular-nums text-[var(--md-on-surface)]">
                <span class="whitespace-nowrap">{{ formatPerMillion(model.pricing?.prompt) }} <span class="text-[var(--md-on-surface-variant)]">/ 1M in</span></span>
                <span class="whitespace-nowrap">{{ formatPerMillion(model.pricing?.completion) }} <span class="text-[var(--md-on-surface-variant)]">/ 1M out</span></span>
            </div>
        </button>

        <span v-if="!hasPricing" class="text-xs text-[var(--md-on-surface-variant)] max-sm:hidden">Price unavailable</span>
        <!-- Desktop pricing: compact right column -->
        <div
            v-if="hasPricing"
            class="hidden sm:block text-right text-xs leading-tight tabular-nums shrink-0 text-[var(--md-on-surface)]"
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

        <UButton type="button" color="neutral" variant="soft" size="sm" aria-label="Use model" @click.stop="emit('use')">Use</UButton>
        <button
            type="button"
            class="shrink-0 min-w-9 min-h-9 flex items-center justify-center rounded transition self-start sm:self-center"
            :class="
                favorite
                    ? 'text-amber-400 hover:text-amber-500'
                    : 'text-[var(--md-on-surface-variant)] opacity-40 hover:opacity-100 group-hover:opacity-70'
            "
            :aria-label="favorite ? 'Remove from favorites' : 'Add to favorites'"
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
