<template>
    <div
        class="w-[480px] max-h-[60dvh] bg-[var(--md-surface)] flex flex-col rounded-[3px] border-2 border-[var(--md-inverse-surface)] retro-shadow"
    >
        <!-- Search & Filters Header -->
        <div
            class="sticky top-0 bg-[var(--md-surface)] border-b-2 border-[var(--md-outline)] p-3 z-10"
        >
            <UInput
                v-model="searchTerm"
                icon="pixelarticons:search"
                placeholder="Search documents or chats..."
                class="w-full"
                @keydown="handleSearchKeydown"
            />

            <div class="flex gap-2 mt-2">
                <UButton
                    :color="showDocuments ? 'primary' : 'neutral'"
                    :variant="showDocuments ? 'solid' : 'soft'"
                    size="sm"
                    @click="toggleSource('document')"
                    class="flex-1"
                >
                    <template #leading>
                        <UIcon name="pixelarticons:notes" />
                    </template>
                    Docs
                </UButton>
                <UButton
                    :color="showChats ? 'primary' : 'neutral'"
                    :variant="showChats ? 'solid' : 'soft'"
                    size="sm"
                    @click="toggleSource('chat')"
                    class="flex-1"
                >
                    <template #leading>
                        <UIcon name="pixelarticons:message-text" />
                    </template>
                    Chats
                </UButton>
            </div>
        </div>

        <!-- Results List -->
        <div
            class="flex-1 overflow-y-auto overflow-x-hidden"
            role="listbox"
            :aria-activedescendant="
                flatItems.length ? `mention-item-${selectedIndex}` : undefined
            "
            v-if="flatItems.length"
        >
            <template v-for="section in sections" :key="section.key">
                <div
                    v-if="section.items.length"
                    class="py-2"
                    :class="{
                        'border-t-2 border-[var(--md-outline)] mt-2':
                            section.key !== sections[0]?.key,
                    }"
                >
                    <!-- Section Header -->
                    <div class="flex items-center gap-2 px-3 pb-2">
                        <span>{{ section.icon }}</span>
                        <span
                            class="text-xs font-semibold text-[var(--md-on-surface-variant)] uppercase tracking-wider"
                        >
                            {{ section.title }}
                        </span>
                    </div>

                    <!-- Section Items -->
                    <UButton
                        v-for="(item, idx) in section.items"
                        :key="`${section.key}-${item.id}`"
                        :id="`mention-item-${flatIndex(section, idx)}`"
                        :variant="'basic'"
                        color="neutral"
                        size="sm"
                        block
                        :ui="{
                            base: 'border-none! transition-none!',
                        }"
                        :class="[
                            'justify-start text-left px-3 py-2',
                            {
                                'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]':
                                    flatIndex(section, idx) === selectedIndex,
                            },
                        ]"
                        :aria-selected="
                            flatIndex(section, idx) === selectedIndex
                        "
                        role="option"
                        @click="selectItem(flatIndex(section, idx))"
                    >
                        <div class="flex items-center gap-2 w-full">
                            <UIcon
                                v-if="section.key === 'recommended'"
                                :name="
                                    item.source === 'document'
                                        ? 'pixelarticons:notes'
                                        : 'pixelarticons:message-text'
                                "
                                class="w-4 h-4 text-[var(--md-on-surface-variant)]"
                            />
                            <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                                <div
                                    class="text-sm font-medium text-[var(--md-on-surface)] truncate"
                                >
                                    {{ item.label }}
                                </div>
                                <div
                                    v-if="item.subtitle"
                                    class="text-xs text-[var(--md-on-surface-variant)] truncate"
                                >
                                    {{ item.subtitle }}
                                </div>
                            </div>
                        </div>
                    </UButton>
                </div>
            </template>
        </div>

        <!-- Empty State -->
        <div
            v-else
            class="flex-1 flex flex-col items-center justify-center p-6 text-center"
        >
            <div class="text-[var(--md-on-surface-variant)] text-sm">
                No results
                <template v-if="!showDocuments || !showChats">
                    <br />Try enabling another source.
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface MentionItem {
    id: string;
    source: 'document' | 'chat';
    label: string;
    subtitle?: string;
    score?: number;
}

const props = defineProps<{
    items: MentionItem[];
    command: (item: MentionItem) => void;
}>();

const searchTerm = ref('');
const showDocuments = ref(true);
const showChats = ref(true);
const selectedIndex = ref(0);

const normalizedSearch = computed(() => searchTerm.value.trim().toLowerCase());
const isSearching = computed(() => normalizedSearch.value.length > 0);

const filteredBySource = computed(() =>
    props.items.filter((item) => {
        if (item.source === 'document' && !showDocuments.value) return false;
        if (item.source === 'chat' && !showChats.value) return false;
        return true;
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
            icon: '🔎',
            items: recommendedItems.value,
        });
    }
    if (!isSearching.value && documentItems.value.length) {
        list.push({
            key: 'documents',
            title: 'Documents',
            icon: '📄',
            items: documentItems.value,
        });
    }
    if (!isSearching.value && chatItems.value.length) {
        list.push({
            key: 'chats',
            title: 'Chats',
            icon: '💬',
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

function toggleSource(source: 'document' | 'chat') {
    if (source === 'document') {
        if (showDocuments.value && !showChats.value) return;
        showDocuments.value = !showDocuments.value;
        return;
    }
    if (showChats.value && !showDocuments.value) return;
    showChats.value = !showChats.value;
}

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
    // Scroll the selected item into view
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

<style scoped></style>
