<template>
    <div
        :class="[label + '-header']"
        class="w-full h-10 flex items-center justify-between gap-2 rounded-[var(--md-border-radius)] px-0.5 cursor-default sb-group-header"
    >
        <button
            type="button"
            class="min-w-0 flex-1 h-full flex items-center gap-2 px-1.5 rounded-[var(--md-border-radius)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] transition-colors group text-left"
            @click="emit('toggle')"
        >
            <span
                class="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--md-on-surface-variant)] group-hover:text-[color:var(--md-on-surface)] transition-colors sb-group-header-label"
            >
                {{ label }}
            </span>
            <UIcon
                :name="iconChevronRight"
                class="w-3.5 h-3.5 text-[color:var(--md-on-surface-variant)]/70 group-hover:text-[color:var(--md-on-surface)] transition-all duration-200 sb-group-header-icon"
                :class="!collapsed ? 'rotate-90' : ''"
            />
        </button>
        <button
            v-if="actionLabel"
            type="button"
            class="shrink-0 text-[11px] font-semibold text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/8 px-2 py-1 rounded-lg sb-group-header-action"
            @click="emit('action')"
        >
            {{ actionLabel }}
        </button>
    </div>
</template>

<script setup lang="ts">
import { useIcon } from '~/composables/useIcon';

defineProps<{
    label: string;
    collapsed: boolean;
    actionLabel?: string;
}>();

const emit = defineEmits<{
    (e: 'toggle'): void;
    (e: 'action'): void;
}>();

const iconChevronRight = useIcon('ui.chevron.right');
</script>
