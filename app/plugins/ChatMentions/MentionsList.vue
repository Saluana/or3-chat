<template>
    <div class="mentions-dropdown">
        <template v-if="items.length">
            <!-- Documents Group -->
            <template v-if="documentItems.length">
                <div class="mentions-group-title">📄 Documents</div>
                <button
                    v-for="(item, index) in documentItems"
                    :key="`doc-${item.id}`"
                    :class="{ 'is-selected': index === selectedIndex }"
                    class="mentions-item"
                    @click="selectItem(index)"
                >
                    <div class="mentions-item-label">{{ item.label }}</div>
                </button>
            </template>

            <!-- Chats Group -->
            <template v-if="chatItems.length">
                <div class="mentions-group-title" :class="{ 'with-border': documentItems.length }">
                    💬 Chats
                </div>
                <button
                    v-for="(item, index) in chatItems"
                    :key="`chat-${item.id}`"
                    :class="{ 'is-selected': documentItems.length + index === selectedIndex }"
                    class="mentions-item"
                    @click="selectItem(documentItems.length + index)"
                >
                    <div class="mentions-item-label">{{ item.label }}</div>
                </button>
            </template>
        </template>
        <div v-else class="mentions-empty">No results</div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface MentionItem {
    id: string;
    source: 'document' | 'chat';
    label: string;
    subtitle?: string;
}

const props = defineProps<{
    items: MentionItem[];
    command: (item: MentionItem) => void;
}>();

const selectedIndex = ref(0);

const documentItems = computed(() =>
    props.items.filter((i) => i.source === 'document').slice(0, 5)
);

const chatItems = computed(() =>
    props.items.filter((i) => i.source === 'chat').slice(0, 5)
);

watch(
    () => props.items,
    () => {
        selectedIndex.value = 0;
    }
);

function onKeyDown({ event }: { event: KeyboardEvent }) {
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
    selectedIndex.value =
        (selectedIndex.value + props.items.length - 1) % props.items.length;
}

function downHandler() {
    selectedIndex.value = (selectedIndex.value + 1) % props.items.length;
}

function enterHandler() {
    selectItem(selectedIndex.value);
}

function selectItem(index: number) {
    const item = props.items[index];
    if (item) {
        props.command(item);
    }
}

defineExpose({
    onKeyDown,
});
</script>

<style scoped>
.mentions-dropdown {
    background: white;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
    max-height: 300px;
    overflow-y: auto;
    min-width: 280px;
    padding: 0.5rem 0;
}

.mentions-group-title {
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.mentions-group-title.with-border {
    border-top: 1px solid #e5e7eb;
    padding-top: 0.875rem;
    margin-top: 0.5rem;
}

.mentions-item {
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    background: transparent;
    border: none;
    transition: background 0.15s ease;
    display: block;
}

.mentions-item:hover {
    background: #f3f4f6;
}

.mentions-item.is-selected {
    background: #f3f4f6;
}

.mentions-item-label {
    font-size: 0.875rem;
    color: #111827;
    font-weight: 500;
}

.mentions-empty {
    padding: 1rem 0.75rem;
    text-align: center;
    color: #9ca3af;
    font-size: 0.875rem;
}
</style>
