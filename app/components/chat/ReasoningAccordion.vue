<template>
    <!--
    Reusable reasoning display component.
    Requirements: R2 (display), R4 (streaming), R5 (reusable), NFR4 (accessible), NFR6 (no layout shift)
  -->
    <div id="reasoning-accordion-root" v-if="visible" class="reasoning-wrap">
        <button
            id="btn-reasoning-toggle"
            :class="[
                'reasoning-toggle retro-reasoning-toggle',
                toggleButtonProps?.class || '',
            ]"
            :data-theme-target="toggleButtonProps?.['data-theme-target']"
            :data-theme-matches="toggleButtonProps?.['data-theme-matches']"
            @click="expanded = !expanded"
            :aria-expanded="expanded"
            :aria-controls="`reasoning-${id}`"
            type="button"
        >
            <UIcon :name="useIcon('chat.reasoning').value" class="mr-1" />
            <span class="reasoning-toggle-text" v-if="!pending || content">
                {{
                    expanded
                        ? expandedLabel || 'Hide reasoning'
                        : collapsedLabel || 'Show reasoning'
                }}
            </span>
            <span
                v-else
                class="reasoning-toggle-loading inline-flex items-center gap-1"
            >
                <LoadingGenerating style="width: 120px; min-height: 28px" />
            </span>
            <span
                v-if="!expanded && content && !streaming"
                class="reasoning-count count text-xs opacity-70 ml-2"
            >
                ({{ charCount }} chars)
            </span>
            <span v-if="streaming" class="pulse ml-2" aria-hidden="true"></span>
        </button>
        <pre
            :id="`reasoning-${id}`"
            :class="[
                'reasoning-box text-black dark:text-white font-[inherit] text-wrap overflow-x-hidden flex flex-col items-start gap-1 bg-(--md-surface-container-low) text-start p-1 border-(--md-inverse-surface) rounded-sm',
                'transition-all duration-200 ease-in-out',
                expanded
                    ? 'opacity-100 max-h-72 mt-2 overflow-y-auto px-3'
                    : 'opacity-0 max-h-0 p-0 mt-0 overflow-hidden pointer-events-none',
            ]"
            tabindex="0"
            v-text="content"
        ></pre>
        <slot name="footer" />
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import LoadingGenerating from './LoadingGenerating.vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';

interface Props {
    content?: string;
    streaming?: boolean;
    pending?: boolean;
    collapsedLabel?: string;
    expandedLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
    streaming: false,
    pending: false,
    collapsedLabel: 'Show reasoning',
    expandedLabel: 'Hide reasoning',
});

const expanded = ref(false);
const id = Math.random().toString(36).substr(2, 9);

const visible = computed(() => !!props.content || props.pending);
const charCount = computed(() => (props.content || '').length);

// Theme overrides for reasoning toggle button
const toggleButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.reasoning-toggle',
        isNuxtUI: false,
    });

    return overrides.value;
});
</script>

<style scoped>
.reasoning-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 16px;
    padding: 4px 8px;
    min-height: 32px;
    cursor: pointer;
    transition: all 0.2s ease;
}

.pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--md-primary);
    animation: pulse 1.2s infinite ease-in-out;
}

@keyframes pulse {
    0%,
    100% {
        opacity: 0.25;
    }
    50% {
        opacity: 1;
    }
}

/* Vue transition classes removed in favor of Tailwind utility transitions */
</style>
