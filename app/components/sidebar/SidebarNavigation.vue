<template>
    <div class="px-3 py-2">
        <div class="flex h-8 rounded-[var(--md-border-radius)] bg-[color:var(--md-surface-variant)]/50 p-1 gap-1">
            <button
                v-for="option in options"
                :key="option.id"
                class="flex-1 px-2 text-[11px] font-bold rounded-[var(--md-border-radius)] transition-all duration-200 relative"
                :class="[
                    modelValue === option.id 
                        ? 'bg-[color:var(--md-primary-container)] text-[color:var(--md-on-primary-container)] shadow-sm' 
                        : 'text-[color:var(--md-on-surface-variant)] hover:text-[color:var(--md-on-surface)] hover:bg-[var(--md-surface-hover)]'
                ]"
                @click="emit('update:modelValue', option.id)"
            >
                {{ option.label }}
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
export interface NavOption {
    id: string;
    label: string;
}

defineProps<{
    modelValue: string;
    options: NavOption[];
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
}>();
</script>
