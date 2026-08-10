<template>
    <div
        class="suggestion-panel"
        data-context="mentions"
    >
        <!-- Tab Filter Pills -->
        <div class="suggestion-header">
            <div class="tab-pills">
                <button
                    :class="['tab-pill', { active: activeTab === 'all' }]"
                    @click="activeTab = 'all'"
                >
                    Recent
                </button>
                <button
                    :class="['tab-pill', { active: activeTab === 'chat' }]"
                    @click="activeTab = 'chat'"
                >
                    Chats
                </button>
                <button
                    :class="['tab-pill', { active: activeTab === 'document' }]"
                    @click="activeTab = 'document'"
                >
                    Docs
                </button>
            </div>

            <!-- Search Input -->
            <div class="search-wrap">
                <UIcon
                    :name="useIcon('ui.search').value"
                    class="search-icon"
                />
                <input
                    ref="searchInputRef"
                    v-model="searchTerm"
                    type="text"
                    placeholder="Search mentions..."
                    class="search-input"
                    @keydown="handleSearchKeydown"
                />
            </div>
        </div>

        <!-- Results List -->
        <div
            v-if="flatItems.length"
            class="suggestion-scroll"
            role="listbox"
            :aria-activedescendant="
                flatItems.length ? `mention-item-${selectedIndex}` : undefined
            "
        >
            <template v-for="section in sections" :key="section.key">
                <div
                    v-if="section.items.length"
                    class="suggestion-section"
                    :class="{
                        'has-border': section.key !== sections[0]?.key,
                    }"
                >
                    <!-- Section Header -->
                    <div class="section-label">
                        <UIcon
                            :name="section.icon"
                            class="section-label-icon"
                        />
                        <span>{{ section.title }}</span>
                    </div>

                    <!-- Section Items -->
                    <button
                        v-for="(item, idx) in section.items"
                        :key="`${section.key}-${item.id}`"
                        :id="`mention-item-${flatIndex(section, idx)}`"
                        type="button"
                        role="option"
                        :aria-selected="flatIndex(section, idx) === selectedIndex"
                        :class="[
                            'suggestion-item',
                            {
                                'is-selected':
                                    flatIndex(section, idx) === selectedIndex,
                            },
                        ]"
                        :style="{ animationDelay: `${flatIndex(section, idx) * 20}ms` }"
                        @click="selectItem(flatIndex(section, idx))"
                        @mouseenter="selectedIndex = flatIndex(section, idx)"
                    >
                        <!-- Icon circle -->
                        <div class="item-icon-circle">
                            <UIcon
                                :name="
                                    item.source === 'document'
                                        ? useIcon('ui.notes').value
                                        : useIcon('ui.chat').value
                                "
                                class="item-icon"
                            />
                        </div>

                        <!-- Text -->
                        <div class="item-text">
                            <div class="item-title">{{ item.label }}</div>
                            <div v-if="item.subtitle" class="item-subtitle">
                                {{ item.subtitle }}
                            </div>
                        </div>

                        <!-- Meta -->
                        <div class="item-meta">
                            <span class="item-type">{{ item.source === 'document' ? 'Doc' : 'Chat' }}</span>
                            <span v-if="item.timestamp" class="item-time">{{ item.timestamp }}</span>
                        </div>
                    </button>
                </div>
            </template>
        </div>

        <!-- Empty State -->
        <div
            v-else
            class="suggestion-empty"
        >
            <UIcon
                :name="useIcon('ui.search').value"
                class="empty-icon"
            />
            <p class="empty-title">No results</p>
            <p v-if="activeTab !== 'all' || searchTerm" class="empty-hint">
                Try a different search or switch tabs
            </p>
        </div>

        <!-- Footer Hints -->
        <div class="suggestion-footer">
            <div class="footer-hints hidden md:flex">
                <span class="hint-group">
                    <kbd class="hint-key">↑↓</kbd>
                    <span class="hint-label">to navigate</span>
                </span>
                <span class="hint-group">
                    <kbd class="hint-key">↵</kbd>
                    <span class="hint-label">to select</span>
                </span>
            </div>
            <div class="footer-action">
                <span class="hint-label">Type <strong>@</strong> to create a reference</span>
                <UIcon :name="useIcon('ui.sparkles').value" class="footer-sparkle" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useIcon } from '~/composables/useIcon';

interface MentionItem {
    id: string;
    source: 'document' | 'chat';
    label: string;
    subtitle?: string;
    score?: number;
    timestamp?: string;
}

const props = defineProps<{
    items: MentionItem[];
    command: (item: MentionItem) => void;
}>();

const searchTerm = ref('');
const activeTab = ref<'all' | 'chat' | 'document'>('all');
const selectedIndex = ref(0);
const searchInputRef = ref<HTMLInputElement | null>(null);

const normalizedSearch = computed(() => searchTerm.value.trim().toLowerCase());
const isSearching = computed(() => normalizedSearch.value.length > 0);

const filteredBySource = computed(() =>
    props.items.filter((item) => {
        if (activeTab.value === 'all') return true;
        return item.source === activeTab.value;
    })
);

const filteredItems = computed(() => {
    if (!normalizedSearch.value) return filteredBySource.value;
    return filteredBySource.value.filter((item) =>
        item.label.toLowerCase().includes(normalizedSearch.value)
    );
});

const recommendedItems = computed(() => {
    if (!isSearching.value) return [];
    const scored = filteredItems.value.filter(
        (item) => typeof item.score === 'number'
    );
    if (!scored.length) return [];
    return [...scored]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 5);
});

const documentItems = computed(() =>
    filteredItems.value.filter((i) => i.source === 'document').slice(0, 5)
);

const chatItems = computed(() =>
    filteredItems.value.filter((i) => i.source === 'chat').slice(0, 5)
);

type SectionBucket = {
    key: string;
    title: string;
    icon: string;
    items: MentionItem[];
};

const sections = computed<SectionBucket[]>(() => {
    const list: SectionBucket[] = [];
    if (recommendedItems.value.length) {
        list.push({
            key: 'recommended',
            title: 'Search Results',
            icon: useIcon('ui.search').value,
            items: recommendedItems.value,
        });
    }
    if (!isSearching.value && documentItems.value.length) {
        list.push({
            key: 'documents',
            title: 'Documents',
            icon: useIcon('ui.notes.multiple').value,
            items: documentItems.value,
        });
    }
    if (!isSearching.value && chatItems.value.length) {
        list.push({
            key: 'chats',
            title: 'Chats',
            icon: useIcon('ui.chat').value,
            items: chatItems.value,
        });
    }
    return list;
});

const flatItems = computed(() =>
    sections.value.flatMap((section) => section.items)
);

watch(
    flatItems,
    (items) => {
        selectedIndex.value = items.length ? 0 : -1;
    },
    { immediate: true }
);

watch(activeTab, () => {
    nextTick(() => {
        searchInputRef.value?.focus();
    });
});

function flatIndex(section: SectionBucket, idx: number) {
    let count = 0;
    for (const s of sections.value) {
        if (s === section) {
            return count + idx;
        }
        count += s.items.length;
    }
    return idx;
}

function handleSearchKeydown(event: KeyboardEvent) {
    if (!flatItems.value.length) {
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        downHandler();
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        upHandler();
    } else if (event.key === 'Enter') {
        event.preventDefault();
        enterHandler();
    }
}

function onKeyDown({ event }: { event: KeyboardEvent }) {
    if (!flatItems.value.length) return false;

    if (event.key === 'ArrowUp') {
        upHandler();
        return true;
    }

    if (event.key === 'ArrowDown') {
        downHandler();
        return true;
    }

    if (event.key === 'Enter') {
        enterHandler();
        return true;
    }

    return false;
}

function upHandler() {
    const total = flatItems.value.length;
    if (!total) return;
    selectedIndex.value = (selectedIndex.value + total - 1) % total;
    scrollToSelected();
}

function downHandler() {
    const total = flatItems.value.length;
    if (!total) return;
    selectedIndex.value = (selectedIndex.value + 1) % total;
    scrollToSelected();
}

function scrollToSelected() {
    const element = document.getElementById(
        `mention-item-${selectedIndex.value}`
    );
    if (element) {
        element.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth',
        });
    }
}

function enterHandler() {
    selectItem(selectedIndex.value);
}

function selectItem(index: number) {
    const item = flatItems.value[index];
    if (item) {
        props.command(item);
    }
}

defineExpose({
    onKeyDown,
});
</script>

<style scoped>
/* ── Panel ─────────────────────────────────────────────────────── */
.suggestion-panel {
    width: 85dvw;
    max-width: 480px;
    max-height: 60dvh;
    background: var(--md-surface);
    border: var(--md-border-width) solid var(--md-outline-variant);
    border-radius: var(--md-border-radius-large);
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

/* ── Header ────────────────────────────────────────────────────── */
.suggestion-header {
    padding: 12px 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--md-surface);
    border-bottom: var(--md-border-width-subtle) solid var(--md-outline-variant);
    flex-shrink: 0;
}

/* ── Tab Pills ─────────────────────────────────────────────────── */
.tab-pills {
    display: flex;
    gap: 6px;
}

.tab-pill {
    padding: 5px 14px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 500;
    color: var(--md-on-surface-variant);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    line-height: 1.4;
}

.tab-pill:hover {
    background: var(--md-surface-container-high);
    color: var(--md-on-surface);
}

.tab-pill.active {
    background: var(--md-primary);
    color: var(--md-on-primary);
}

/* ── Search ────────────────────────────────────────────────────── */
.search-wrap {
    position: relative;
    display: flex;
    align-items: center;
}

.search-icon {
    position: absolute;
    left: 10px;
    width: 16px;
    height: 16px;
    color: var(--md-on-surface-variant);
    opacity: 0.6;
    pointer-events: none;
}

.search-input {
    width: 100%;
    padding: 7px 10px 7px 32px;
    border-radius: var(--md-border-radius-small);
    border: var(--md-border-width) solid var(--md-outline-variant);
    background: var(--md-surface-container-low);
    color: var(--md-on-surface);
    font-size: 13px;
    line-height: 1.4;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.search-input::placeholder {
    color: var(--md-on-surface-variant);
    opacity: 0.55;
}

.search-input:focus {
    border-color: var(--md-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--md-primary) 15%, transparent);
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

.suggestion-section.has-border {
    border-top: 1px solid var(--md-outline-variant);
    margin-top: 2px;
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

.item-time {
    font-size: 11px;
    color: var(--md-on-surface-variant);
    opacity: 0.55;
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

.empty-icon {
    width: 28px;
    height: 28px;
    color: var(--md-on-surface-variant);
    opacity: 0.35;
    margin-bottom: 4px;
}

.empty-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--md-on-surface-variant);
    opacity: 0.8;
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

.footer-action {
    display: inline-flex;
    align-items: center;
    gap: 5px;
}

.footer-action .hint-label strong {
    color: var(--md-primary);
    font-weight: 600;
}

.footer-sparkle {
    width: 12px;
    height: 12px;
    color: var(--md-primary);
    opacity: 0.6;
}

@media (max-width: 480px) {
    .suggestion-panel {
        width: 92dvw;
        max-width: none;
    }

    .suggestion-footer {
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
    }
}
</style>
