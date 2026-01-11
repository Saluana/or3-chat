<template>
    <button
        class="w-full flex items-center gap-3 px-3 min-h-[52px] group relative transition-colors duration-200 rounded-[var(--md-border-radius)] mx-1 mb-1 bg-[color:var(--md-surface-variant)]/30 border border-[color:var(--md-border-color)]/50 shadow-[0_1px_0_rgba(15,23,42,0.04)] hover:bg-[color:var(--md-surface-variant)]/45 hover:border-[color:var(--md-border-color)]/70 active:bg-[color:var(--md-surface-variant)]/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--md-primary)]/30"
        style="width: calc(100% - 8px);"
        :aria-label="label"
        @click="emit('select')"
    >
        <div
            class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-[color:var(--md-primary)]/10 text-[color:var(--md-primary)]"
        >
            <UIcon :name="icon" class="w-5 h-5" />
        </div>
        <div class="flex-1 min-w-0 text-left">
            <div class="text-[13px] font-semibold text-[color:var(--md-on-surface)]">
                {{ label }}
            </div>
            <div
                v-if="description"
                class="text-[11px] text-[color:var(--md-on-surface-variant)]"
            >
                {{ description }}
            </div>
        </div>
        <UIcon
            :name="iconChevronRight"
            class="w-4 h-4 text-[color:var(--md-on-surface-variant)] group-hover:text-[color:var(--md-on-surface)] transition-colors"
        />
    </button>
</template>

<script setup lang="ts">
import { useIcon } from '~/composables/useIcon';

defineProps<{
    label: string;
    description?: string;
    icon: string;
}>();

const emit = defineEmits<{
    (e: 'select'): void;
}>();

const iconChevronRight = useIcon('ui.chevron.right');
</script>
