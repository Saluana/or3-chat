<template>
    <div
        class="suggestion-panel"
        data-context="workflow"
    >
        <!-- Empty state -->
        <div
            v-if="items.length === 0"
            class="suggestion-empty"
        >
            <div class="empty-icon-circle">
                <UIcon
                    name="tabler:binary-tree-2"
                    class="empty-icon"
                />
            </div>
            <p class="empty-title">No workflows found</p>
            <p class="empty-hint">Create a workflow to use slash commands</p>
        </div>

        <!-- Workflow list -->
        <div
            v-else
            class="suggestion-scroll"
            role="listbox"
            :aria-activedescendant="`workflow-item-${selectedIndex}`"
        >
            <div class="suggestion-section">
                <div class="section-label">
                    <UIcon
                        name="tabler:binary-tree-2"
                        class="section-label-icon"
                    />
                    <span>Workflows</span>
                </div>

                <button
                    v-for="(item, idx) in items"
                    :key="item.id"
                    :id="`workflow-item-${idx}`"
                    type="button"
                    role="option"
                    :aria-selected="idx === selectedIndex"
                    :class="[
                        'suggestion-item',
                        {
                            'is-selected': idx === selectedIndex,
                        },
                    ]"
                    :style="{ animationDelay: `${idx * 20}ms` }"
                    @click="selectItem(idx)"
                    @mouseenter="selectedIndex = idx"
                >
                    <!-- Icon circle -->
                    <div class="item-icon-circle">
                        <UIcon
                            name="tabler:binary-tree-2"
                            class="item-icon"
                        />
                    </div>

                    <!-- Text -->
                    <div class="item-text">
                        <div class="item-title">{{ item.label }}</div>
                        <div class="item-subtitle">{{ formatTime(item.updatedAt) }}</div>
                    </div>

                    <!-- Meta -->
                    <div class="item-meta">
                        <span class="item-type">Workflow</span>
                    </div>
                </button>
            </div>
        </div>

        <!-- Footer Hints -->
        <div
            v-if="items.length > 0"
            class="suggestion-footer"
        >
            <div class="footer-hints">
                <span class="hint-group">
                    <kbd class="hint-key">↑↓</kbd>
                    <span class="hint-label">to navigate</span>
                </span>
                <span class="hint-group">
                    <kbd class="hint-key">↵</kbd>
                    <span class="hint-label">to select</span>
                </span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { WorkflowItem } from './useWorkflowSlashCommands';

const props = defineProps<{
    items: WorkflowItem[];
    command: (item: WorkflowItem) => void;
}>();

const selectedIndex = ref(0);

// Format relative time from Unix timestamp (seconds)
function formatTime(timestamp: number): string {
    if (!timestamp) return '';

    const now = Date.now();
    const diff = now - timestamp * 1000;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
}

// Select item at index
function selectItem(index: number) {
    const item = props.items[index];
    if (item) {
        props.command(item);
    }
}

// Handle keyboard navigation
function onKeyDown({ event }: { event: KeyboardEvent }) {
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedIndex.value =
            (selectedIndex.value - 1 + props.items.length) % props.items.length;
        scrollToSelected();
        return true;
    }

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedIndex.value = (selectedIndex.value + 1) % props.items.length;
        scrollToSelected();
        return true;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectItem(selectedIndex.value);
        return true;
    }

    return false;
}

function scrollToSelected() {
    const element = document.getElementById(
        `workflow-item-${selectedIndex.value}`
    );
    if (element) {
        element.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth',
        });
    }
}

// Reset selection when items change
watch(
    () => props.items,
    () => {
        selectedIndex.value = 0;
    }
);

defineExpose({
    onKeyDown,
});
</script>

<style scoped>
/* ── Panel ─────────────────────────────────────────────────────── */
.suggestion-panel {
    width: 320px;
    max-height: 340px;
    background: var(--md-surface);
    border: 1px solid var(--md-outline-variant);
    border-radius: var(--md-border-radius);
    box-shadow:
        0 4px 6px -1px rgb(0 0 0 / 0.1),
        0 2px 4px -2px rgb(0 0 0 / 0.1),
        0 10px 15px -3px rgb(0 0 0 / 0.05);
    display: flex;
    flex-direction: column;
    overflow: hidden;

    animation: panel-in 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes panel-in {
    from {
        opacity: 0;
        transform: translateY(6px) scale(0.985);
    }
    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

/* ── Scroll area ───────────────────────────────────────────────── */
.suggestion-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
}

.suggestion-scroll::-webkit-scrollbar {
    width: 5px;
}

.suggestion-scroll::-webkit-scrollbar-track {
    background: transparent;
}

.suggestion-scroll::-webkit-scrollbar-thumb {
    background: var(--md-outline-variant);
    border-radius: 9999px;
}

/* ── Section ───────────────────────────────────────────────────── */
.suggestion-section {
    padding: 6px 0;
}

.section-label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--md-on-surface-variant);
    opacity: 0.75;
}

.section-label-icon {
    width: 14px;
    height: 14px;
}

/* ── Item ──────────────────────────────────────────────────────── */
.suggestion-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.08s ease;
    border-radius: 0;

    animation: item-in 140ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes item-in {
    from {
        opacity: 0;
        transform: translateX(-6px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

.suggestion-item:hover,
.suggestion-item.is-selected {
    background: var(--md-surface-container-high);
}

.item-icon-circle {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--md-surface-container-high);
    color: var(--md-primary);
    transition: background 0.12s ease, color 0.12s ease;
}

.suggestion-item:hover .item-icon-circle,
.suggestion-item.is-selected .item-icon-circle {
    background: var(--md-primary);
    color: var(--md-on-primary);
}

.item-icon {
    width: 16px;
    height: 16px;
}

.item-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.item-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--md-on-surface);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.35;
}

.item-subtitle {
    font-size: 12px;
    color: var(--md-on-surface-variant);
    opacity: 0.75;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.35;
}

.item-meta {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    min-width: 44px;
}

.item-type {
    font-size: 11px;
    font-weight: 500;
    color: var(--md-on-surface-variant);
    opacity: 0.7;
}

/* ── Empty ─────────────────────────────────────────────────────── */
.suggestion-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    text-align: center;
    gap: 6px;

    animation: panel-in 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.empty-icon-circle {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--md-surface-container-high);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4px;
}

.empty-icon {
    width: 22px;
    height: 22px;
    color: var(--md-on-surface-variant);
    opacity: 0.45;
}

.empty-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--md-on-surface-variant);
    opacity: 0.85;
    margin: 0;
}

.empty-hint {
    font-size: 12px;
    color: var(--md-on-surface-variant);
    opacity: 0.55;
    margin: 0;
}

/* ── Footer ────────────────────────────────────────────────────── */
.suggestion-footer {
    padding: 8px 12px;
    border-top: 1px solid var(--md-outline-variant);
    background: var(--md-surface-container-low);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-shrink: 0;
}

.footer-hints {
    display: flex;
    align-items: center;
    gap: 12px;
}

.hint-group {
    display: inline-flex;
    align-items: center;
    gap: 5px;
}

.hint-key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--md-surface-container-high);
    border: 1px solid var(--md-outline-variant);
    font-size: 10px;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    color: var(--md-on-surface-variant);
    line-height: 1.4;
}

.hint-label {
    font-size: 11px;
    color: var(--md-on-surface-variant);
    opacity: 0.65;
}
</style>
