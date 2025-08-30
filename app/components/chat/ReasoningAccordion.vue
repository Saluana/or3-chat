<template>
    <!--
    Reusable reasoning display component.
    Requirements: R2 (display), R4 (streaming), R5 (reusable), NFR4 (accessible), NFR6 (no layout shift)
  -->
    <div v-if="visible" class="reasoning-wrap">
        <button
            class="reasoning-toggle"
            @click="expanded = !expanded"
            :aria-expanded="expanded"
            :aria-controls="`reasoning-${id}`"
            type="button"
        >
            <span v-if="!pending || content">
                {{
                    expanded
                        ? expandedLabel || 'Hide reasoning'
                        : collapsedLabel || 'Show reasoning'
                }}
            </span>
            <span v-else>Thinking…</span>
            <span
                v-if="!expanded && content && !streaming"
                class="count text-xs opacity-70 ml-2"
            >
                ({{ charCount }} chars)
            </span>
            <span v-if="streaming" class="pulse ml-2" aria-hidden="true"></span>
        </button>
        <transition name="fade">
            <pre
                v-show="expanded"
                :id="`reasoning-${id}`"
                class="reasoning-box text-black dark:text-white font-[inherit] text-wrap max-h-[300px] overflow-x-hidden overflow-y-auto bg-[var(--md-surface-container-low)] border-2 border-[var(--md-inverse-surface)] mt-2"
                tabindex="0"
                v-text="content"
            ></pre>
        </transition>
        <slot name="footer" />
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

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
</script>

<style scoped>
.reasoning-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-mono, 'VT323', 'IBM Plex Mono', monospace);
    font-size: 13px;
    padding: 4px 8px;
    border: 2px solid var(--md-inverse-surface);
    background: linear-gradient(
        180deg,
        var(--md-surface-container-high),
        var(--md-surface-container-low)
    );
    border-radius: 4px;
    box-shadow: 2px 2px 0 0 var(--md-inverse-surface);
    min-height: 32px;
    cursor: pointer;
    transition: all 0.2s ease;
}

.reasoning-toggle:hover {
    background: linear-gradient(
        180deg,
        var(--md-surface-container-low),
        var(--md-surface-container-high)
    );
}

.reasoning-toggle:focus {
    outline: 2px solid var(--md-inverse-primary);
    outline-offset: 2px;
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

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.3s ease, max-height 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
    max-height: 0;
}

.fade-enter-to,
.fade-leave-from {
    opacity: 1;
    max-height: 300px;
}
</style>
