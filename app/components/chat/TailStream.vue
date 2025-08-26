<template>
    <div
        v-if="active && hasContent"
        class="px-3 py-2 whitespace-pre-wrap font-mono text-sm transition-opacity duration-300"
        :class="{ 'opacity-70': finalized && !isStreaming }"
    >
        <slot>{{ displayText }}</slot>
        <span v-if="showCaret" class="animate-pulse">▌</span>
    </div>
</template>

<script setup lang="ts">
/**
 * TailStream component
 * Requirement: 3.2 streaming tail UI extracted
 * Renders the incremental streaming text from useTailStream composable.
 */
import { computed, watchEffect } from 'vue';
import {
    useTailStream,
    type TailStreamController,
    type UseTailStreamOptions,
} from '../../composables/useTailStream';

const props = defineProps<{
    controller?: TailStreamController; // externally managed controller (optional)
    options?: UseTailStreamOptions; // options if internal controller created
    active?: boolean;
    finalized?: boolean; // parent can signal finalization animation point
}>();

const internal = props.controller || useTailStream(props.options);
const displayText = internal.displayText;
const isStreaming = internal.isStreaming;
const hasContent = computed(() => !!displayText.value.length);
const showCaret = computed(() => isStreaming.value && props.active !== false);

// Finalization side-effect (Task 3.3): can be extended for sound or confetti.
watchEffect(() => {
    if (props.finalized && !isStreaming.value) {
        // Minimal hook: currently handled via opacity class binding above.
    }
});
</script>

<style scoped>
/* Retro caret blink via animate-pulse (Tailwind). Customize if needed. */
</style>
