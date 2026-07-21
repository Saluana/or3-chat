<script setup lang="ts">
import { computed } from 'vue';
import type { OpenRouterModel } from '~/core/auth/models-service';
import { useIcon } from '~/composables/useIcon';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { buildThemeOverrideProps } from '~/composables/ui/themeOverrideProps';
import {
    formatModalities,
    formatPerMillion,
    formatReleaseDate,
    formatTokenCount,
    getBestForTags,
    getCapabilities,
    getContextLength,
    getModelBadges,
    getModelProvider,
} from '~/utils/modelCatalog';
import ModelCatalogProviderLogo from './ModelCatalogProviderLogo.vue';

const props = defineProps<{
    model: OpenRouterModel;
    favorite: boolean;
}>();

const emit = defineEmits<{
    (e: 'toggleFavorite'): void;
    (e: 'use'): void;
}>();

const provider = computed(() => getModelProvider(props.model));
const capabilities = computed(() => getCapabilities(props.model));
const badges = computed(() => getModelBadges(props.model, 3));
const bestFor = computed(() => getBestForTags(props.model));
const contextLength = computed(() => getContextLength(props.model));
const maxOutput = computed(
    () => props.model.top_provider?.max_completion_tokens ?? 0
);
const released = computed(() => formatReleaseDate(props.model.created));
const openRouterUrl = computed(
    () => `https://openrouter.ai/${props.model.id}`
);

const cacheRead = computed(() => props.model.pricing?.input_cache_read);
const cacheWrite = computed(() => props.model.pricing?.input_cache_write);
const hasCachePricing = computed(
    () =>
        (cacheRead.value != null && Number(cacheRead.value) > 0) ||
        (cacheWrite.value != null && Number(cacheWrite.value) > 0)
);

interface CapabilityChip {
    key: string;
    label: string;
    icon: string;
}

const capabilityChips = computed<CapabilityChip[]>(() => {
    const chips: CapabilityChip[] = [
        {
            key: 'text',
            label: 'Text',
            icon: useIcon('catalog.text').value,
        },
    ];
    if (capabilities.value.vision)
        chips.push({
            key: 'vision',
            label: 'Vision',
            icon: useIcon('catalog.vision').value,
        });
    if (capabilities.value.tools)
        chips.push({
            key: 'tools',
            label: 'Tool use',
            icon: useIcon('catalog.tools').value,
        });
    if (capabilities.value.json)
        chips.push({
            key: 'json',
            label: 'JSON',
            icon: useIcon('catalog.json').value,
        });
    if (capabilities.value.reasoning)
        chips.push({
            key: 'reasoning',
            label: 'Reasoning',
            icon: useIcon('catalog.reasoning').value,
        });
    if (capabilities.value.imageOutput)
        chips.push({
            key: 'image',
            label: 'Image out',
            icon: useIcon('catalog.image').value,
        });
    return chips;
});

const starIcon = useIcon('catalog.star');
const starFilledIcon = useIcon('catalog.star.filled');
const infoIcon = useIcon('catalog.info');
const externalIcon = useIcon('catalog.external');
const contextIcon = useIcon('catalog.context');
const calendarIcon = useIcon('catalog.calendar');
const modalityIcon = useIcon('catalog.text');
const sparklesIcon = useIcon('catalog.sparkles');

const useModelOverrides = useThemeOverrides({
    component: 'button',
    context: 'modal',
    identifier: 'model-catalog.use-model',
    isNuxtUI: true,
});
const useModelButtonProps = computed(() =>
    buildThemeOverrideProps(useModelOverrides.value, {
        baseClass: 'flex-1 justify-center',
    })
);

const favoriteOverrides = useThemeOverrides({
    component: 'button',
    context: 'modal',
    identifier: 'model-catalog.favorite',
    isNuxtUI: true,
});
const favoriteButtonProps = computed(() =>
    buildThemeOverrideProps(favoriteOverrides.value, {
        baseClass: 'justify-center',
    })
);

const rowLabelClass =
    'flex items-center gap-2 text-[13px] text-[var(--md-on-surface-variant)]';
const rowValueClass =
    'text-[13px] font-medium text-[var(--md-on-surface)] text-right tabular-nums';
</script>

<template>
    <div class="flex flex-col gap-5">
        <!-- Header -->
        <div class="flex items-start gap-3.5">
            <ModelCatalogProviderLogo :slug="provider.slug" :size="52" tile />
            <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-2">
                    <h3
                        class="font-semibold text-[15px] leading-tight text-[var(--md-on-surface)] break-words"
                    >
                        {{ model.name }}
                    </h3>
                    <button
                        type="button"
                        class="shrink-0 p-1 -m-1 rounded transition"
                        :class="
                            favorite
                                ? 'text-amber-400 hover:text-amber-500'
                                : 'text-[var(--md-on-surface-variant)] opacity-50 hover:opacity-100'
                        "
                        :aria-pressed="favorite"
                        :title="
                            favorite
                                ? 'Remove from favorites'
                                : 'Add to favorites'
                        "
                        @click="emit('toggleFavorite')"
                    >
                        <UIcon
                            :name="favorite ? starFilledIcon : starIcon"
                            class="h-5 w-5"
                        />
                    </button>
                </div>
                <div
                    class="text-[13px] text-[var(--md-on-surface-variant)] mt-0.5"
                >
                    {{ provider.name }}
                </div>
                <div v-if="badges.length" class="flex flex-wrap gap-1 mt-1.5">
                    <UBadge
                        v-for="badge in badges"
                        :key="badge.label"
                        :color="badge.tone"
                        variant="subtle"
                        size="xs"
                        >{{ badge.label }}</UBadge
                    >
                </div>
            </div>
        </div>

        <!-- Description -->
        <p
            v-if="model.description"
            class="text-[13px] leading-relaxed text-[var(--md-on-surface-variant)] line-clamp-4 m-0"
            :title="model.description"
        >
            {{ model.description }}
        </p>

        <!-- Best for -->
        <div>
            <div
                class="text-xs font-semibold uppercase tracking-wider text-[var(--md-on-surface-variant)] mb-2"
            >
                Best for
            </div>
            <div class="flex flex-wrap gap-1.5">
                <span
                    v-for="tag in bestFor"
                    :key="tag"
                    class="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-[var(--md-surface-container-high)] text-[var(--md-on-surface)]"
                    >{{ tag }}</span
                >
            </div>
        </div>

        <div class="h-px bg-[var(--md-border-color)] opacity-50" />

        <!-- Specs -->
        <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
                <span :class="rowLabelClass">
                    <UIcon :name="contextIcon" class="h-4 w-4" />
                    Context length
                </span>
                <span :class="rowValueClass"
                    >{{ formatTokenCount(contextLength) }} tokens</span
                >
            </div>
            <div
                v-if="maxOutput"
                class="flex items-center justify-between gap-3"
            >
                <span :class="rowLabelClass">
                    <UIcon :name="sparklesIcon" class="h-4 w-4" />
                    Max output
                </span>
                <span :class="rowValueClass"
                    >{{ formatTokenCount(maxOutput) }} tokens</span
                >
            </div>
            <div class="flex items-center justify-between gap-3">
                <span :class="rowLabelClass">
                    <UIcon :name="modalityIcon" class="h-4 w-4" />
                    Modalities
                </span>
                <span :class="rowValueClass">{{ formatModalities(model) }}</span>
            </div>
            <div class="flex items-start justify-between gap-3">
                <span :class="rowLabelClass">
                    <UIcon :name="sparklesIcon" class="h-4 w-4" />
                    Capabilities
                </span>
                <div class="flex flex-wrap justify-end gap-1.5">
                    <span
                        v-for="chip in capabilityChips"
                        :key="chip.key"
                        class="inline-flex items-center gap-1 text-xs text-[var(--md-on-surface-variant)]"
                    >
                        <UIcon :name="chip.icon" class="h-3.5 w-3.5" />
                        {{ chip.label }}
                    </span>
                </div>
            </div>
            <div
                v-if="released"
                class="flex items-center justify-between gap-3"
            >
                <span :class="rowLabelClass">
                    <UIcon :name="calendarIcon" class="h-4 w-4" />
                    Released
                </span>
                <span :class="rowValueClass">{{ released }}</span>
            </div>
        </div>

        <div class="h-px bg-[var(--md-border-color)] opacity-50" />

        <!-- Pricing -->
        <div>
            <div
                class="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[var(--md-on-surface-variant)] mb-2.5"
            >
                <span>Pricing</span>
                <span class="font-normal normal-case tracking-normal"
                    >Per 1M tokens</span
                >
            </div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                    <div
                        class="text-xs text-[var(--md-on-surface-variant)] mb-0.5"
                    >
                        Input
                    </div>
                    <div
                        class="text-sm font-semibold tabular-nums text-[var(--md-on-surface)]"
                    >
                        {{ formatPerMillion(model.pricing?.prompt) }}
                    </div>
                </div>
                <div>
                    <div
                        class="text-xs text-[var(--md-on-surface-variant)] mb-0.5"
                    >
                        Output
                    </div>
                    <div
                        class="text-sm font-semibold tabular-nums text-[var(--md-on-surface)]"
                    >
                        {{ formatPerMillion(model.pricing?.completion) }}
                    </div>
                </div>
                <template v-if="hasCachePricing">
                    <div>
                        <div
                            class="text-xs text-[var(--md-on-surface-variant)] mb-0.5"
                        >
                            Cache read
                        </div>
                        <div
                            class="text-sm font-semibold tabular-nums text-[var(--md-on-surface)]"
                        >
                            {{ formatPerMillion(cacheRead) }}
                        </div>
                    </div>
                    <div>
                        <div
                            class="text-xs text-[var(--md-on-surface-variant)] mb-0.5"
                        >
                            Cache write
                        </div>
                        <div
                            class="text-sm font-semibold tabular-nums text-[var(--md-on-surface)]"
                        >
                            {{ formatPerMillion(cacheWrite) }}
                        </div>
                    </div>
                </template>
            </div>
            <a
                :href="openRouterUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 mt-3 text-[13px] text-[var(--md-primary)] hover:underline"
            >
                Learn more
                <UIcon :name="externalIcon" class="h-3.5 w-3.5" />
            </a>
        </div>

        <!-- Note -->
        <div
            class="flex gap-2.5 items-start rounded-[var(--md-border-radius)] bg-[var(--md-surface-container-low)] px-3 py-2.5"
        >
            <UIcon
                :name="infoIcon"
                class="h-4 w-4 mt-px shrink-0 text-[var(--md-primary)]"
            />
            <p
                class="text-xs leading-relaxed text-[var(--md-on-surface-variant)] m-0"
            >
                You pay only for the tokens you use. Prices are updated
                regularly from OpenRouter.
            </p>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-2 pt-1">
            <UButton
                v-bind="favoriteButtonProps"
                :icon="favorite ? starFilledIcon : starIcon"
                :variant="favorite ? 'soft' : 'outline'"
                color="neutral"
                size="sm"
                @click="emit('toggleFavorite')"
            >
                {{ favorite ? 'Favorited' : 'Favorite' }}
            </UButton>
            <UButton
                v-bind="useModelButtonProps"
                color="primary"
                size="sm"
                @click="emit('use')"
            >
                Use model
            </UButton>
        </div>
    </div>
</template>
