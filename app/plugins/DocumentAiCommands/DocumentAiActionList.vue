<template>
    <div class="action-menu" data-context="document" aria-label="Suggested prompts">
        <div v-if="items.length" class="action-sections" role="listbox" :aria-activedescendant="`document-ai-action-${selectedIndex}`">
            <section v-for="section in sections" :key="section.source" class="action-section">
                <span class="section-label">{{ section.label }}</span>
                <button
                    v-for="item in section.items"
                    :id="`document-ai-action-${flatIndex(item)}`"
                    :key="`${item.source}:${item.id}`"
                    type="button"
                    role="option"
                    :aria-selected="flatIndex(item) === selectedIndex"
                    :class="{ selected: flatIndex(item) === selectedIndex }"
                    @mouseenter="selectedIndex = flatIndex(item)"
                    @click="command(item)"
                >
                    <span class="action-copy">
                        <strong>{{ item.label }}</strong>
                        <small>{{ item.prompt }}</small>
                    </span>
                    <UBadge v-if="item.defaultScope" color="neutral" variant="soft" size="xs">{{ item.defaultScope }}</UBadge>
                </button>
            </section>
            <footer><kbd>↑↓</kbd> navigate <kbd>↵</kbd> select <kbd>esc</kbd> close</footer>
        </div>
        <div v-else class="empty-state">
            <strong>No suggested prompts</strong>
            <span>Add one in Document AI settings.</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { DocumentAiPromptAction } from './slashCommandExtension';

const props = defineProps<{
    items: DocumentAiPromptAction[];
    command: (item: DocumentAiPromptAction) => void;
}>();
const selectedIndex = ref(0);
const sections = computed(() => [
    { source: 'saved' as const, label: 'Saved prompts', items: props.items.filter((item) => item.source === 'saved') },
    { source: 'plugin' as const, label: 'Plugin prompts', items: props.items.filter((item) => item.source === 'plugin') },
].filter((section) => section.items.length));

function flatIndex(item: DocumentAiPromptAction) {
    return props.items.indexOf(item);
}
function select(index: number) {
    const item = props.items[index];
    if (item) props.command(item);
}
function onKeyDown({ event }: { event: KeyboardEvent }) {
    if (!props.items.length) return false;
    if (event.key === 'ArrowUp') {
        selectedIndex.value = (selectedIndex.value - 1 + props.items.length) % props.items.length;
        return true;
    }
    if (event.key === 'ArrowDown') {
        selectedIndex.value = (selectedIndex.value + 1) % props.items.length;
        return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
        select(selectedIndex.value);
        return true;
    }
    return false;
}
watch(() => props.items, () => { selectedIndex.value = 0; });
defineExpose({ onKeyDown });
</script>

<style scoped>
.action-menu {
    width: min(25rem, 88dvw);
    max-height: min(23rem, 60dvh);
    overflow: auto;
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
    background: var(--md-surface);
    box-shadow: 0 16px 42px rgb(0 0 0 / 16%);
}
.action-section { display: grid; gap: 0.2rem; padding: 0.5rem; }
.action-section + .action-section { border-top: var(--md-border-width) solid var(--md-border-color); }
.section-label { padding: 0.2rem 0.35rem; color: var(--md-on-surface-variant); font-size: 0.62rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
button { width: 100%; display: flex; align-items: center; gap: 0.65rem; padding: 0.6rem 0.7rem; border: 0; border-radius: var(--md-border-radius); color: var(--md-on-surface); background: transparent; text-align: left; cursor: pointer; }
button:hover, button.selected { background: var(--md-surface-container-high); }
.action-copy { min-width: 0; flex: 1; display: grid; gap: 0.1rem; }
.action-copy strong, .action-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.action-copy strong { font-size: 0.76rem; }
.action-copy small { color: var(--md-on-surface-variant); font-size: 0.66rem; }
footer { display: flex; gap: 0.35rem; align-items: center; padding: 0.5rem 0.75rem; border-top: var(--md-border-width) solid var(--md-border-color); color: var(--md-on-surface-variant); font-size: 0.6rem; }
kbd { padding: 0.1rem 0.25rem; border-radius: 0.25rem; background: var(--md-surface-container-high); font: inherit; }
.empty-state { display: grid; gap: 0.15rem; padding: 1rem; }
.empty-state span { color: var(--md-on-surface-variant); font-size: 0.68rem; }
</style>
