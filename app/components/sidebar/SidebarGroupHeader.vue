<template>
    <button
        class="w-full h-11 flex items-center justify-between px-4 hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] transition-colors group rounded-[var(--md-border-radius)] mx-1"
        style="width: calc(100% - 8px);"
        @click="emit('toggle')"
    >
        <span class="text-[11px] font-bold uppercase tracking-wider text-[color:var(--md-on-surface-variant)] group-hover:text-[color:var(--md-on-surface)] transition-colors">
            {{ label }}
        </span>
        <UIcon
            :name="collapsed ? iconChevronRight : iconChevronDown"
            class="w-4 h-4 text-[color:var(--md-on-surface-variant)] group-hover:text-[color:var(--md-on-surface)] transition-colors"
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
const iconChevronDown = useIcon('ui.chevron.down');
</script>
