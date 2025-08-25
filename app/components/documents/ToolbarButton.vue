<template>
    <button
        class="retro-btn h-8 flex items-center justify-center gap-1 border-2 rounded-[4px] text-sm"
        :class="[
            active
                ? 'bg-primary/40 aria-[pressed=true]:outline'
                : 'opacity-80 hover:opacity-100',
            square ? 'aspect-square w-8 p-0' : 'px-2',
        ]"
        :title="label"
        :aria-pressed="active ? 'true' : 'false'"
        :aria-label="computedAriaLabel"
        type="button"
        @click="$emit('activate')"
    >
        <template v-if="text">{{ text }}</template>
        <template v-else-if="icon">
            <UIcon :name="icon" class="w-4 h-4" />
        </template>
    </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{
    icon?: string;
    active?: boolean;
    label?: string;
    text?: string;
}>();
defineEmits<{ (e: 'activate'): void }>();
const computedAriaLabel = computed(() => props.text || props.label || '');
const square = computed(
    () => !props.text || (props.text && props.text.length <= 2)
);
</script>

<style scoped>
button {
    font-family: inherit;
}
</style>
