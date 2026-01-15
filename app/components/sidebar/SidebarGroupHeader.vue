<template>
    <button
        :class="[label + '-header']"
        class="w-full h-11 flex items-center justify-between hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] transition-colors group rounded-[var(--md-border-radius)] mx-1 cursor-pointer sb-group-header"
        style="width: calc(100% - 8px)"
        @click="emit('toggle')"
    >
        <span
            class="text-[12px] font-semibold text-[color:var(--md-on-surface-variant)]/80 group-hover:text-[color:var(--md-on-surface)] transition-colors sb-group-header-label"
        >
            {{ label }}
        </span>
        <UIcon
            :name="iconChevronRight"
            class="w-4 h-4 text-[color:var(--md-on-surface-variant)]/70 group-hover:text-[color:var(--md-on-surface)] transition-all duration-200 sb-group-header-icon"
            :class="!collapsed ? 'rotate-90' : ''"
        />
    </button>
</template>

<script setup lang="ts">
import { useIcon } from '~/composables/useIcon';

defineProps<{
    label: string;
    collapsed: boolean;
}>();

const emit = defineEmits<{
    (e: 'toggle'): void;
}>();

const iconChevronRight = useIcon('ui.chevron.right');
</script>
