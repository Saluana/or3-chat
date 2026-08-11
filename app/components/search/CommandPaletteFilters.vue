<template>
    <div
        class="or3-palette-filters shrink-0 flex items-center gap-1 sm:gap-1.5 overflow-x-auto px-2.5 py-1.5 sm:px-4 sm:py-2 border-b border-[color:var(--md-border-color)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%_-_28px),transparent_100%)]"
        role="group"
        aria-label="Filter results by category"
    >
        <button
            v-for="chip in chips"
            :key="chip.id ?? 'all'"
            type="button"
            class="or3-palette-chip shrink-0 inline-flex items-center gap-1 sm:gap-1.5 h-6 sm:h-7 px-2 sm:px-2.5 rounded-full border text-[11px] sm:text-[12px] leading-none whitespace-nowrap transition-colors duration-[var(--app-motion-duration-fast,100ms)] ease-[var(--app-motion-easing-standard,ease)] focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)]"
            :class="
                chip.id === activeCategoryId ||
                (!activeCategoryId && chip.id === null)
                    ? 'border-[color:var(--md-primary)] bg-[color-mix(in_srgb,var(--md-primary)_12%,transparent)] text-[color:var(--md-primary)] font-medium'
                    : 'border-[color:var(--md-border-color)] text-[color:var(--md-on-surface-variant)] hover:bg-[color:var(--md-surface-hover)] hover:text-[color:var(--md-on-surface)]'
            "
            :aria-pressed="
                chip.id === activeCategoryId ||
                (!activeCategoryId && chip.id === null)
            "
            @click="emit('select', chip.id)"
        >
            <UIcon v-if="chip.icon" :name="chip.icon" class="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            {{ chip.label }}
        </button>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useIcon } from '~/composables/useIcon';
import type { PaletteCategory } from '~/core/search/command-palette/types';
import { usePaletteIcons } from './usePaletteIcons';

const props = defineProps<{
    categories: readonly PaletteCategory[];
    activeCategoryId?: string;
}>();

const emit = defineEmits<{
    (e: 'select', categoryId: string | null): void;
}>();

interface Chip {
    id: string | null;
    label: string;
    icon?: string;
}

const allIcon = useIcon('palette.recent');
const { categoryIcons, fallbackIcon } = usePaletteIcons();

const chips = computed<Chip[]>(() => [
    { id: null, label: 'All', icon: allIcon.value },
    ...props.categories.map((category) => ({
        id: category.id,
        label: category.label,
        // Prefer themeable tokens so chips restyle with the active theme.
        icon:
            categoryIcons.value[category.id] ??
            category.icon ??
            fallbackIcon.value,
    })),
]);
</script>
